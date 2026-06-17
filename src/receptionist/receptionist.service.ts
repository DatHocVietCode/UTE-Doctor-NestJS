import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { BillingService } from 'src/billing/billing.service';
import { PaymentService } from 'src/payment/payment.service';

type MockPaymentInput = {
	visitId?: string;
	amount?: number;
};

@Injectable()
export class ReceptionistService {
	constructor(
		@InjectModel(Appointment.name)
		private readonly appointmentModel: Model<AppointmentDocument>,
		private readonly billingService: BillingService,
		private readonly paymentService: PaymentService
	) {}

	async getVisits() {
		// Return appointment list for FE receptionist flow integration.
		const visits = await this.appointmentModel
			.find()
			.sort({ createdAt: -1 })
			.limit(50)
			.populate('patientId', 'profileId')
			.populate('doctorId', 'profileId')
			.populate('timeSlot', 'start end label status')
			.lean()
			.exec();

		return {
			code: 'SUCCESS',
			message: 'Fetched receptionist visits successfully',
			data: visits,
		};
	}

	async getBillingByVisitId(visitId: string) {
		console.log('Fetching billing for visitId:', visitId);
		if (!Types.ObjectId.isValid(visitId)) {
			throw new NotFoundException('Visit not found');
		}
		try {
			const billing = await this.billingService.createDraftBilling(visitId);
				return {
					code: 'SUCCESS',
					message: 'Fetched billing successfully',
					data: {
						billingId: billing._id?.toString?.() ?? null,
						visitId: billing.visitId?.toString?.() ?? visitId,
						status: billing.status,
						consultationFee: billing.consultationFee,
						medicationFee: billing.medicationFee,
						totalAmount: billing.totalAmount,
						insuranceAmount: billing.insuranceAmount,
						depositUsed: billing.depositUsed,
						creditUsed: billing.creditUsed,
						coinUsed: billing.coinUsed,
						finalPayable: billing.finalPayable,
						paymentCategory: billing.paymentCategory ?? null,
						// Expose the immutable billing medication snapshot so the receptionist UI uses the same prices used for totals.
						medications: billing.medications.map(med => ({
							medicineId: med.medicineId?.toString() ?? null,
							medicineName: med.medicineName,
							prescribedQty: med.prescribedQty,
							dispensedQty: med.dispensedQty,
							unitPrice: med.unitPrice,
							source: med.source,
							lineTotal: med.lineTotal,
						})),
					},
				};
			} catch (err) {
				throw new NotFoundException('Visit not found');
			}
	}
	

	async mockPayment(input: MockPaymentInput) {
		if (!input.visitId) {
			return {
				code: 'SUCCESS',
				message: 'Mock payment simulated',
				data: {
					visitId: null,
					status: 'COMPLETED',
					amount: Math.max(0, Math.floor(input.amount ?? 0)),
					simulated: true,
				},
			};
		}

		if (!Types.ObjectId.isValid(input.visitId)) {
			throw new NotFoundException('Visit not found');
		}

		const visit = await this.appointmentModel.findById(input.visitId).exec();
		if (!visit) {
			throw new NotFoundException('Visit not found');
		}

		// Temporary FE endpoint: mark pending/failed appointment as paid+confirmed.
		if (
			visit.appointmentStatus === AppointmentStatus.PENDING ||
			visit.appointmentStatus === AppointmentStatus.FAILED
		) {
			visit.appointmentStatus = AppointmentStatus.CONFIRMED;
		}

		const amount = Math.max(
			0,
			Math.floor(
				input.amount ??
					(typeof visit.paymentAmount === 'number'
						? visit.paymentAmount
						: visit.consultationFee ?? 0),
			),
		);

		visit.paymentAmount = amount;
		visit.paidAt = new Date();
		visit.paymentResponseCode = 'MOCK_SUCCESS';
		visit.paymentTransactionStatus = 'MOCK_COMPLETED';
		await visit.save();

		return {
			code: 'SUCCESS',
			message: 'Mock payment completed',
			data: {
				visitId: visit._id.toString(),
				status: visit.appointmentStatus,
				amount,
				paidAt: visit.paidAt,
				simulated: true,
			},
		};
	}

	async applyCreditToBilling(billingId: string, creditToUse: number) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		if (typeof creditToUse !== 'number' || !Number.isFinite(creditToUse) || creditToUse < 0) {
			throw new BadRequestException('Invalid creditToUse');
		}

		return this.billingService.applyCredit(billingId, creditToUse);
	}

	async applyCoinToBilling(billingId: string, coinToUse: number) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		if (typeof coinToUse !== 'number' || !Number.isFinite(coinToUse) || coinToUse < 0) {
			throw new BadRequestException('Invalid coinToUse');
		}

		return this.billingService.applyCoin(billingId, coinToUse);
	}

	async finalizeBilling(billingId: string, fulfillment?: { medications: Array<{ medicineId?: string; dispensedQty: number; source: string }> }) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		return this.billingService.finalizeBilling(billingId, fulfillment as any);
	}

	async getQrPaymentForBilling(billingId: string, ipAddr: string) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		return this.paymentService.getQrPaymentByBillingId(billingId, ipAddr);
	}

	async markCashPaymentPaid(paymentId: string, performedBy?: string) {
		if (!Types.ObjectId.isValid(paymentId)) {
			throw new NotFoundException('Payment not found');
		}

		return this.paymentService.markPaymentSuccess(paymentId, performedBy, 'CASH');
	}
}
