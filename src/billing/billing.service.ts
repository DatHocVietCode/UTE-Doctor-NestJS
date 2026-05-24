import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose, { Connection, Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { WalletSummaryDto } from 'src/common/dto/wallet-summary.dto';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Medicine, MedicineDocument } from 'src/medicine/schema/medicine.schema';
import { MedicalEncounter, MedicalEncounterDocument } from 'src/patient/schema/medical-record.schema';
import { PaymentService } from 'src/payment/payment.service';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { WalletService } from 'src/wallet/wallet.service';
import { Billing, BillingDocument, BillingStatus, MedicationSource } from './billing.schema';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
    @InjectModel(MedicalEncounter.name) private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Medicine.name) private readonly medicineModel: Model<MedicineDocument>,
    @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
    private readonly paymentService: PaymentService,
    private readonly walletService: WalletService,
  ) {}

  private async resolveBillingPatientId(billingId: string) {
    const billing = await this.billingModel.findById(billingId).lean().exec();
    if (!billing) {
      throw new NotFoundException('Billing not found');
    }

    const visit = await this.visitModel.findById(billing.visitId).lean().exec();
    if (!visit || !visit.patientId) {
      throw new BadRequestException('Associated visit or patient not found');
    }

    return {
      billing,
      patientId: visit.patientId.toString(),
    };
  }

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

    // Populate medications[] from encounter prescriptions with price snapshots.
    // Each medication row represents potential billing item.
    // Receptionist can later adjust dispensedQty and source before finalization.
    const medications: any[] = [];
    let medicationFee = 0;
    try {
      const encounterForMeds = await this.medicalEncounterModel
        .findOne({ visitId: new Types.ObjectId(visitId) })
        .select('prescriptions')
        .lean()
        .exec();

      const prescriptions = encounterForMeds?.prescriptions ?? [];
      if (prescriptions.length > 0) {
        for (const item of prescriptions) {
          // Default: assume all prescribed quantity will be dispensed from clinic.
          const prescribedQty = typeof item?.prescribedQty === 'number' && item.prescribedQty > 0 ? item.prescribedQty : 1;
          const unitPrice = typeof item?.unitPriceSnapshot === 'number' ? Math.max(0, Math.floor(item.unitPriceSnapshot)) : 0;
          const lineTotal = prescribedQty * unitPrice;

          medications.push({
            medicineId: item?.medicineId ?? undefined,
            medicineName: item?.name ?? 'Unknown medicine',
            prescribedQty,
            dispensedQty: prescribedQty, // default: dispense all prescribed
            unitPrice,
            source: MedicationSource.CLINIC, // default: clinic supplies
            lineTotal,
          });

          medicationFee += lineTotal;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to populate medications for visit ${visitId}: ${String(err)}`);
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
      medications,
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

    const walletSummary = await this.walletService.getWalletSummaryByPatientId(patientId);
    if (walletSummary.availableCredit < normalized) {
      throw new BadRequestException(`Insufficient credit. Balance: ${walletSummary.availableCredit}`);
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

    const walletSummary = await this.walletService.getWalletSummaryByPatientId(patientId);
    if (walletSummary.availableCoins < normalized) {
      throw new BadRequestException(`Insufficient coin. Balance: ${walletSummary.availableCoins}`);
    }

    billing.coinUsed = normalized;
    billing.finalPayable = this.recomputeFinalPayable(billing);

    await billing.save();

    this.logger.log(`[APPLY_COIN] billing=${billingId} visit=${billing.visitId?.toString()} coin=${normalized}`);

    return billing;
  }

  async finalizeBilling(
    billingId: string,
    fulfillment?: { medications: Array<{ medicineId?: string; dispensedQty: number; source: MedicationSource }> },
  ) {
    if (!mongoose.Types.ObjectId.isValid(billingId)) {
      throw new NotFoundException('Billing not found');
    }

    const session = await this.billingModel.db.startSession();
    try {
      let finalizedBilling: BillingDocument | null = null;
      let payment = null as Awaited<ReturnType<PaymentService['createPaymentForBilling']>> | null;

      await session.withTransaction(async () => {
        const billing = await this.billingModel.findById(billingId).session(session).exec();
        if (!billing) {
          throw new NotFoundException('Billing not found');
        }

        if (billing.status !== BillingStatus.DRAFT && billing.status !== BillingStatus.FINALIZED) {
          throw new BadRequestException('Billing can only be finalized from DRAFT status');
        }

        if (billing.status === BillingStatus.DRAFT) {
          // If fulfillment input provided, apply receptionist-confirmed dispensing changes.
          if (fulfillment?.medications && fulfillment.medications.length > 0) {
            this.applyFulfillmentToMedications(billing, fulfillment.medications);
          }

          // Recompute medication fee and totals from final medications snapshot.
          billing.medicationFee = this.computeMedicationFeeFromMedications(billing.medications);
          billing.totalAmount = billing.consultationFee + billing.medicationFee;

          const coverageRate = Number(this.config.get('INSURANCE_COVERAGE_RATE')) || 0;
          const visit = await this.visitModel.findById(billing.visitId).session(session).lean().exec();
          if (visit?.appointmentId) {
            const appointment = await this.appointmentModel
              .findById(visit.appointmentId)
              .select('paymentCategory')
              .session(session)
              .lean()
              .exec();
            const paymentCategory = (appointment as any)?.paymentCategory as string | undefined;
            const isBHYT = paymentCategory === 'BHYT';
            billing.insuranceAmount = isBHYT ? billing.totalAmount * coverageRate : 0;
          }

          const afterInsurance = billing.totalAmount - billing.insuranceAmount;
          const afterDeposit = afterInsurance - (billing.depositUsed ?? 0);
          const afterCredit = afterDeposit - (billing.creditUsed ?? 0);
          const afterCoin = afterCredit - (billing.coinUsed ?? 0);
          billing.finalPayable = Math.max(0, Math.floor(afterCoin));

          billing.status = BillingStatus.FINALIZED;
          await billing.save({ session });
        }

        finalizedBilling = billing;
        payment = await this.paymentService.createPaymentForBilling(billingId, { session });
      });

      if (!finalizedBilling || !payment) {
        throw new BadRequestException('Billing finalization failed');
      }

      const finalizedBillingSnapshot = finalizedBilling as BillingDocument;
      const paymentSnapshot = payment as NonNullable<typeof payment>;

      this.logger.log(`[FINALIZE_BILLING] billing=${billingId} visit=${finalizedBillingSnapshot.visitId?.toString()}`);

      return {
        code: 'SUCCESS',
        message: 'Billing finalized',
        data: {
          billingId: finalizedBillingSnapshot._id.toString(),
          status: finalizedBillingSnapshot.status,
          paymentId: paymentSnapshot._id.toString(),
          paymentStatus: paymentSnapshot.status,
          amount: paymentSnapshot.amount,
          method: paymentSnapshot.method,
        },
      };
    } finally {
      await session.endSession();
    }
  }

  /**
   * Apply receptionist-confirmed fulfillment changes to billing medications.
   * Matches by medicineId and updates dispensedQty and source.
   * Recalculates lineTotal based on source and dispensedQty.
   */
  private applyFulfillmentToMedications(
    billing: BillingDocument,
    fulfillmentMeds: Array<{ medicineId?: string; dispensedQty: number; source: MedicationSource }>,
  ) {
    // Create a map of medicineId -> fulfillment for quick lookup.
    const fulfillmentMap = new Map<string | undefined, typeof fulfillmentMeds[0]>();
    for (const fMed of fulfillmentMeds) {
      const key = fMed.medicineId || undefined;
      fulfillmentMap.set(key, fMed);
    }

    // Apply fulfillment to each medication in billing.
    for (const med of billing.medications) {
      const medIdStr = med.medicineId?.toString();
      const fulfillment = fulfillmentMap.get(medIdStr) || fulfillmentMap.get(undefined);

      if (fulfillment) {
        med.dispensedQty = Math.max(0, Math.floor(fulfillment.dispensedQty));
        med.source = fulfillment.source;

        // Recalculate lineTotal:
        // If source is OUTSIDE_PURCHASE or dispensedQty is 0, lineTotal = 0.
        // Otherwise, lineTotal = dispensedQty * unitPrice.
        if (med.source === MedicationSource.OUTSIDE_PURCHASE || med.dispensedQty === 0) {
          med.lineTotal = 0;
        } else {
          med.lineTotal = med.dispensedQty * med.unitPrice;
        }
      }
    }
  }

  /**
   * Compute total medication fee from final medications[] array.
   * Sum of all lineTotal values.
   */
  private computeMedicationFeeFromMedications(medications: any[]): number {
    if (!medications || medications.length === 0) {
      return 0;
    }

    return Math.max(
      0,
      Math.floor(
        medications.reduce((sum, med) => {
          const lineTotal = typeof med?.lineTotal === 'number' ? Math.max(0, med.lineTotal) : 0;
          return sum + lineTotal;
        }, 0),
      ),
    );
  }

  async getWalletSummaryForBilling(billingId: string, performedBy?: string): Promise<DataResponse<WalletSummaryDto>> {
    if (!mongoose.Types.ObjectId.isValid(billingId)) {
      throw new NotFoundException('Billing not found');
    }

    const { billing, patientId } = await this.resolveBillingPatientId(billingId);
    const summary = await this.walletService.getWalletSummaryByPatientId(
      patientId,
      billing.finalPayable ?? billing.totalAmount ?? 0,
    );

    this.logger.log(
      `[WALLET_SUMMARY] billing=${billingId} patient=${patientId} accessedBy=${performedBy ?? 'unknown'}`,
    );

    return {
      code: rc.SUCCESS,
      message: 'Fetched wallet summary successfully',
      data: summary,
    };
  }
}
