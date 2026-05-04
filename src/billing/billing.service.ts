import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import mongoose, { Connection, Types } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Billing, BillingDocument, BillingStatus } from './billing.schema';
import { MedicalEncounter, MedicalEncounterDocument } from 'src/patient/schema/medical-record.schema';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { CreditService } from 'src/wallet/credit/credit.service';
import { CoinService } from 'src/wallet/coin/coin.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
    @InjectModel(MedicalEncounter.name) private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
    private readonly creditService?: CreditService,
    private readonly coinService?: CoinService,
  ) {}

  private recomputeFinalPayable(billing: Pick<Billing, 'totalAmount' | 'insuranceAmount' | 'depositUsed' | 'creditUsed' | 'coinUsed'>) {
    // Recompute from stored base values only so apply-credit and apply-coin stay idempotent.
    const afterInsurance = (billing.totalAmount ?? 0) - (billing.insuranceAmount ?? 0);
    const afterDeposit = afterInsurance - (billing.depositUsed ?? 0);
    const afterCredit = afterDeposit - (billing.creditUsed ?? 0);
    const afterCoin = afterCredit - (billing.coinUsed ?? 0);

    return Math.max(0, Math.floor(afterCoin));
  }

  async createDraftBilling(visitId: string) {
    // enforce uniqueness: if billing exists, return it
    const existing = await this.billingModel.findOne({ visitId }).lean().exec();
    if (existing) {
      this.logger.log(`Billing already exists for visit ${visitId}`);
      return existing;
    }

    // Attempt to resolve appointment via MedicalEncounter or Visit
    const encounter = await this.medicalEncounterModel.findOne({ visitId: new Types.ObjectId(visitId) }).lean().exec();

    let appointmentId: Types.ObjectId | undefined;
    if (encounter?.appointmentId) {
      appointmentId = encounter.appointmentId as unknown as Types.ObjectId;
    } else {
      const visit = await this.visitModel.findById(visitId).lean().exec();
      if (visit?.appointmentId) appointmentId = visit.appointmentId as unknown as Types.ObjectId;
    }

    const appointment = appointmentId
      ? await this.appointmentModel.findById(appointmentId).lean().exec()
      : null;

    // consultationFee from config (preferred), fallback to appointment snapshot or 0
    const cfgConsult = Number(this.config.get('CONSULTATION_FEE'));
    const consultationFee = Number.isFinite(cfgConsult) && !Number.isNaN(cfgConsult)
      ? cfgConsult
      : (appointment?.consultationFee ?? 0);

    // medicationFee: try to sum from a Prescription model if available, otherwise 0
    let medicationFee = 0;
    try {
      const modelNames = this.connection.modelNames();
      if (modelNames.includes('Prescription')) {
        const Prescription = this.connection.model('Prescription') as any;
        const match: any = { visitId: new Types.ObjectId(visitId), isDispensed: true };
        const agg = await Prescription.aggregate([
          { $match: match },
          {
            $project: {
              amountComputed: {
                $cond: [
                  { $gt: [ { $ifNull: ['$amount', null] }, null ] },
                  '$amount',
                  {
                    $cond: [
                      { $and: [ { $gt: [ { $ifNull: ['$price', null] }, null ] }, { $gt: [ { $ifNull: ['$quantity', null] }, null ] } ] },
                      { $multiply: ['$price', '$quantity'] },
                      0,
                    ],
                  },
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$amountComputed' } } },
        ]).exec();

        if (agg && agg[0] && typeof agg[0].total === 'number') {
          medicationFee = agg[0].total;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to compute medicationFee for visit ${visitId}: ${String(err)}`);
      medicationFee = 0;
    }

    const totalAmount = consultationFee + medicationFee;

    const coverageRate = Number(this.config.get('INSURANCE_COVERAGE_RATE')) || 0;
    const paymentCategory = (appointment as any)?.paymentCategory as string | undefined;
    const isBHYT = paymentCategory === 'BHYT';

    const insuranceAmount = isBHYT ? totalAmount * coverageRate : 0;

    const depositUsed = (appointment as any)?.depositAmount ?? 0;

    const afterInsurance = totalAmount - insuranceAmount;
    const afterDeposit = afterInsurance - (depositUsed ?? 0);
    const finalPayable = Math.max(0, Math.floor(afterDeposit));

    const billing = await this.billingModel.create({
      visitId: new Types.ObjectId(visitId),
      consultationFee,
      medicationFee,
      totalAmount,
      insuranceAmount,
      depositUsed: depositUsed ?? 0,
      creditUsed: 0,
      coinUsed: 0,
      finalPayable,
      status: BillingStatus.DRAFT,
    } as any);

    this.logger.log(`Created draft billing for visit ${visitId} (billingId=${billing._id})`);
    return billing;
  }

  async applyCredit(billingId: string, creditToUse: number) {
    if (!mongoose.Types.ObjectId.isValid(billingId)) {
      throw new NotFoundException('Billing not found');
    }

    const billing = await this.billingModel.findById(billingId).exec();
    if (!billing) throw new NotFoundException('Billing not found');

    if (billing.status !== BillingStatus.DRAFT) {
      throw new BadRequestException('Credit can only be applied to DRAFT billing');
    }

    const normalized = Math.max(0, Math.floor(creditToUse || 0));
    if (normalized < 0) {
      throw new BadRequestException('creditToUse must be >= 0');
    }

    // Resolve patient from visit
    const visit = await this.visitModel.findById(billing.visitId).lean().exec();
    if (!visit || !visit.patientId) {
      throw new BadRequestException('Associated visit or patient not found');
    }

    const patientId = visit.patientId.toString();

    const remainingPayableBefore = Math.max(
      0,
      Math.floor(
        (billing.totalAmount ?? 0) -
          (billing.insuranceAmount ?? 0) -
          (billing.depositUsed ?? 0) -
          (billing.coinUsed ?? 0),
      ),
    );

    if (normalized > remainingPayableBefore) {
      throw new BadRequestException(`creditToUse cannot exceed remaining payable (${remainingPayableBefore})`);
    }

    // check patient credit balance
    if (this.creditService) {
      const balance = await this.creditService.getCreditBalance(patientId);
      if (balance < normalized) {
        throw new BadRequestException(`Insufficient credit. Balance: ${balance}`);
      }
    } else {
      this.logger.warn('CreditService not available; skipping balance check');
    }

    // Set (replace) creditUsed and recompute finalPayable from base values
    billing.creditUsed = normalized;

    billing.finalPayable = this.recomputeFinalPayable(billing);

    await billing.save();

    this.logger.log(`[APPLY_CREDIT] billing=${billingId} visit=${billing.visitId?.toString()} credit=${normalized}`);

    return billing;
  }

  async applyCoin(billingId: string, coinToUse: number) {
    if (!mongoose.Types.ObjectId.isValid(billingId)) {
      throw new NotFoundException('Billing not found');
    }

    const billing = await this.billingModel.findById(billingId).exec();
    if (!billing) {
      throw new NotFoundException('Billing not found');
    }

    if (billing.status !== BillingStatus.DRAFT) {
      throw new BadRequestException('Coin can only be applied to DRAFT billing');
    }

    const normalized = Math.max(0, Math.floor(coinToUse || 0));
    if (normalized < 0) {
      throw new BadRequestException('coinToUse must be >= 0');
    }

    const visit = await this.visitModel.findById(billing.visitId).lean().exec();
    if (!visit || !visit.patientId) {
      throw new BadRequestException('Associated visit or patient not found');
    }

    const patientId = visit.patientId.toString();

    const remainingPayableAfterCredit = Math.max(
      0,
      Math.floor(
        (billing.totalAmount ?? 0) -
          (billing.insuranceAmount ?? 0) -
          (billing.depositUsed ?? 0) -
          (billing.creditUsed ?? 0),
      ),
    );

    if (normalized > remainingPayableAfterCredit) {
      throw new BadRequestException(`coinToUse cannot exceed remaining payable (${remainingPayableAfterCredit})`);
    }

    if (this.coinService) {
      const balance = await this.coinService.getAvailableCoinBalance(patientId);
      if (balance < normalized) {
        throw new BadRequestException(`Insufficient coin. Balance: ${balance}`);
      }
    } else {
      this.logger.warn('CoinService not available; skipping balance check');
    }

    billing.coinUsed = normalized;
    billing.finalPayable = this.recomputeFinalPayable(billing);

    await billing.save();

    this.logger.log(`[APPLY_COIN] billing=${billingId} visit=${billing.visitId?.toString()} coin=${normalized}`);

    return billing;
  }

  async finalizeBilling(billingId: string) {
    if (!mongoose.Types.ObjectId.isValid(billingId)) {
      throw new NotFoundException('Billing not found');
    }

    const billing = await this.billingModel.findById(billingId).exec();
    if (!billing) {
      throw new NotFoundException('Billing not found');
    }

    // Idempotent finalize: when already FINALIZED, return current state without mutation.
    if (billing.status === BillingStatus.FINALIZED) {
      this.logger.log(`[FINALIZE_BILLING] no-op billing=${billingId} status=FINALIZED`);
      return billing;
    }

    if (billing.status !== BillingStatus.DRAFT) {
      throw new BadRequestException('Billing can only be finalized from DRAFT status');
    }

    if ((billing.finalPayable ?? 0) < 0) {
      throw new BadRequestException('finalPayable must be >= 0');
    }

    billing.status = BillingStatus.FINALIZED;
    await billing.save();

    this.logger.log(`[FINALIZE_BILLING] billing=${billingId} visit=${billing.visitId?.toString()}`);

    return billing;
  }
}
