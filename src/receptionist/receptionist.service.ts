import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';

type MockPaymentInput = {
	visitId?: string;
	amount?: number;
};

@Injectable()
export class ReceptionistService {
	constructor(
		@InjectModel(Appointment.name)
		private readonly appointmentModel: Model<AppointmentDocument>,
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
		if (!Types.ObjectId.isValid(visitId)) {
			throw new NotFoundException('Visit not found');
		}

		const visit = await this.appointmentModel.findById(visitId).lean().exec();
		if (!visit) {
			throw new NotFoundException('Visit not found');
		}

		const originalAmount = Math.max(0, Math.floor((visit as any).consultationFee ?? 0));
		const discountAmount = Math.max(0, Math.floor((visit as any).coinDiscountAmount ?? 0));
		const finalAmount = Math.max(
			0,
			Math.floor(
				typeof (visit as any).paymentAmount === 'number'
					? (visit as any).paymentAmount
					: originalAmount - discountAmount,
			),
		);

		return {
			code: 'SUCCESS',
			message: 'Fetched billing successfully',
			data: {
				visitId: visit._id.toString(),
				appointmentStatus: visit.appointmentStatus,
				paymentMethod: visit.paymentMethod,
				originalAmount,
				discountAmount,
				finalAmount,
				paidAt: visit.paidAt ?? null,
			},
		};
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
}
