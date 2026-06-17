import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { AppointmentAssignmentTaskService, CreateAssignmentTaskAfterDepositSuccessResult } from 'src/appointment/appointment-assignment-task.service';
import { ClientSession, Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { AssignmentStatus } from 'src/appointment/enums/assignment-status.enum';
import { DepositStatus } from 'src/appointment/enums/deposit-status.enum';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';
import { buildEnrichedAppointmentPayload } from 'src/appointment/schemas/appointment-enriched';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { Billing, BillingDocument, BillingStatus } from 'src/billing/billing.schema';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientDocument } from 'src/patient/schema/patient.schema';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { COIN_DEFAULT_EXPIRE_DAYS, COIN_REWARD_RATE } from 'src/wallet/coin/coin-reward.config';
import { CoinSpendAllocation, CoinSpendAllocationDocument } from 'src/wallet/coin/schemas/coin-spend-allocation.schema';
import { CoinTransaction, CoinTransactionDocument } from 'src/wallet/coin/schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletDocument } from 'src/wallet/coin/schemas/coin-wallet.schema';
import { CreditTransaction, CreditTransactionDocument } from 'src/wallet/credit/schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletDocument } from 'src/wallet/credit/schemas/credit-wallet.schema';
import { PaymentFlowMethodEnum, PaymentFlowStatusEnum, PaymentPurposeEnum } from './enums/payment-flow.enum';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { VnPayPaymentService } from './vnpay/vnpay-payment.service';

type ActiveEarnTransaction = {
	_id: Types.ObjectId;
	amount: number;
	expiresAt?: Date;
	createdAt?: Date;
};

@Injectable()
export class PaymentService {
	private readonly logger = new Logger(PaymentService.name);
	private readonly DEFAULT_ASSIGNMENT_DEADLINE_MINUTES = 30;

	constructor(
		@InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
		@InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
		@InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
		@InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
		@InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
		@InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
		@InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
		@InjectModel(CreditWallet.name) private readonly creditWalletModel: Model<CreditWalletDocument>,
		@InjectModel(CreditTransaction.name) private readonly creditTransactionModel: Model<CreditTransactionDocument>,
		@InjectModel(CoinWallet.name) private readonly coinWalletModel: Model<CoinWalletDocument>,
		@InjectModel(CoinTransaction.name) private readonly coinTransactionModel: Model<CoinTransactionDocument>,
		@InjectModel(CoinSpendAllocation.name)
		private readonly coinSpendAllocationModel: Model<CoinSpendAllocationDocument>,
		private readonly config: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly vnPayPaymentService: VnPayPaymentService,
		private readonly assignmentTaskService: AppointmentAssignmentTaskService,
	) {}

	async createPaymentForBilling(
		billingId: string,
		options?: { method?: PaymentFlowMethodEnum; session?: ClientSession },
	): Promise<PaymentDocument> {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		const billing = await this.billingModel.findById(billingId).session(options?.session ?? null).exec();
		if (!billing) {
			throw new NotFoundException('Billing not found');
		}

		if (billing.status !== BillingStatus.FINALIZED) {
			throw new BadRequestException('Payment can only be created after billing is FINALIZED');
		}

		const existingPayment = await this.paymentModel.findOne({
			purpose: PaymentPurposeEnum.BILLING,
			billingId: billing._id,
		}).session(options?.session ?? null).exec();
		if (existingPayment) {
			if (existingPayment.status === PaymentFlowStatusEnum.SUCCESS) {
				throw new BadRequestException('Payment already completed for this billing');
			}
			return existingPayment;
		}

		const payment = await this.paymentModel.create([
			{
				purpose: PaymentPurposeEnum.BILLING,
				billingId: billing._id,
				amount: Math.max(0, Math.floor(billing.finalPayable ?? 0)),
				method: options?.method ?? PaymentFlowMethodEnum.QR,
				status: PaymentFlowStatusEnum.PENDING,
				idempotencyKey: `PAYMENT:${billing._id.toString()}:ACTIVE`,
				expireAt: this.buildPaymentExpireAt(),
			},
		], { session: options?.session ?? undefined });

		this.logger.log(`Created active payment for billing ${billingId}`);
		return payment[0] as PaymentDocument;
	}

	async createPaymentUrlForBilling(billingId: string, ipAddr: string) {
		const payment = await this.createPaymentForBilling(billingId, { method: PaymentFlowMethodEnum.QR });

		if (payment.status === PaymentFlowStatusEnum.SUCCESS) {
			throw new BadRequestException('Payment already completed for this billing');
		}

		if (payment.amount <= 0) {
			throw new BadRequestException('Payment amount must be greater than 0');
		}

		// BillingId is the canonical VNPay txnRef now, so the callback can resolve payment state safely.
		if (!payment.billingId) {
			throw new BadRequestException('Payment is missing billingId');
		}

		const paymentUrl = this.vnPayPaymentService.createPaymentUrl(payment.billingId.toString(), payment.amount, ipAddr);
		this.logger.warn(`QR payment requested for billing ${billingId} (paymentId=${payment._id.toString()})`);

		return {
			paymentId: payment._id.toString(),
			paymentUrl,
			amount: payment.amount,
		};
	}

	async getQrPaymentByBillingId(billingId: string, ipAddr: string) {
		return this.createPaymentUrlForBilling(billingId, ipAddr);
	}

	async createDepositPaymentForAppointment(appointmentId: string, amount: number, ipAddr: string) {
		if (!Types.ObjectId.isValid(appointmentId)) {
			throw new NotFoundException('Appointment not found');
		}

		const appointment = await this.appointmentModel.findById(appointmentId).exec();
		if (!appointment) {
			throw new NotFoundException('Appointment not found');
		}

		const normalizedAmount = Math.max(0, Math.floor(amount || 0));
		if (normalizedAmount <= 0) {
			throw new BadRequestException('Deposit amount must be greater than 0');
		}

		const existingPayment = await this.paymentModel.findOne({
			purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
			appointmentId: appointment._id,
		}).exec();

		if (existingPayment) {
			if (existingPayment.status === PaymentFlowStatusEnum.SUCCESS) {
				throw new BadRequestException('Deposit already paid for this appointment');
			}

			const paymentUrl = this.vnPayPaymentService.createPaymentUrl(
				existingPayment._id.toString(),
				existingPayment.amount,
				ipAddr,
				`Dat coc lich kham ${appointment._id.toString()}`,
			);
			return {
				paymentId: existingPayment._id.toString(),
				paymentUrl,
				amount: existingPayment.amount,
				purpose: existingPayment.purpose,
			};
		}

		const [payment] = await this.paymentModel.create([
			{
				purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
				appointmentId: appointment._id,
				amount: normalizedAmount,
				method: PaymentFlowMethodEnum.QR,
				status: PaymentFlowStatusEnum.PENDING,
				idempotencyKey: `APPOINTMENT_DEPOSIT:${appointment._id.toString()}`,
				expireAt: this.buildPaymentExpireAt(),
			},
		]);

		appointment.depositPaymentId = payment._id;
		await appointment.save();

		const paymentUrl = this.vnPayPaymentService.createPaymentUrl(
			payment._id.toString(),
			payment.amount,
			ipAddr,
			`Dat coc lich kham ${appointment._id.toString()}`,
		);

		this.logger.log(`Created deposit payment for appointment ${appointmentId}`);
		return {
			paymentId: payment._id.toString(),
			paymentUrl,
			amount: payment.amount,
			purpose: payment.purpose,
		};
	}

	async handleVnpayPaymentResultByTxnRef(
		txnRef: string,
		performedBy?: string,
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		const directPayment = Types.ObjectId.isValid(txnRef)
			? await this.paymentModel.findById(txnRef).exec()
			: null;

		if (directPayment?.purpose === PaymentPurposeEnum.APPOINTMENT_DEPOSIT) {
			return this.markDepositPaymentSuccess(directPayment._id.toString(), performedBy, metadata);
		}

		return this.markPaymentSuccessByBillingId(txnRef, performedBy, 'QR', metadata);
	}

	async handleVnpayPaymentFailureByTxnRef(
		txnRef: string,
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		const directPayment = Types.ObjectId.isValid(txnRef)
			? await this.paymentModel.findById(txnRef).exec()
			: null;

		if (directPayment?.purpose !== PaymentPurposeEnum.APPOINTMENT_DEPOSIT) {
			return null;
		}

		return this.markDepositPaymentFailed(directPayment._id.toString(), metadata);
	}

	async markPaymentSuccessByBillingId(
		billingId: string,
		performedBy?: string,
		channel: 'QR' | 'CASH' = 'QR',
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		const payment = await this.paymentModel.findOne({
			purpose: PaymentPurposeEnum.BILLING,
			billingId: new Types.ObjectId(billingId),
		}).exec();
		if (!payment) {
			throw new NotFoundException('Payment not found');
		}

		return this.markPaymentSuccess(payment._id.toString(), performedBy, channel, metadata);
	}

	async markPaymentSuccess(
		paymentId: string,
		performedBy?: string,
		channel: 'QR' | 'CASH' = 'QR',
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		if (!Types.ObjectId.isValid(paymentId)) {
			throw new NotFoundException('Payment not found');
		}

		const session = await this.paymentModel.db.startSession();
		try {
			let result: { paymentId: string; billingId: string; status: PaymentFlowStatusEnum; amount: number; method: PaymentFlowMethodEnum } | null = null;

			await session.withTransaction(async () => {
				const payment = await this.paymentModel.findById(paymentId).session(session).exec();
				if (!payment) {
					throw new NotFoundException('Payment not found');
				}

				if (payment.purpose !== PaymentPurposeEnum.BILLING || !payment.billingId) {
					throw new BadRequestException('Payment is not a billing payment');
				}

				if (payment.expireAt && payment.expireAt.getTime() < Date.now()) {
					throw new BadRequestException('Payment expired');
				}

				const billing = await this.billingModel.findById(payment.billingId).session(session).exec();
				if (!billing) {
					throw new NotFoundException('Billing not found');
				}

				if (billing.status !== BillingStatus.FINALIZED && billing.status !== BillingStatus.PAID) {
					throw new BadRequestException('Billing must be FINALIZED before payment success');
				}

				const paymentStatus = payment.status as PaymentFlowStatusEnum;
				const billingStatus = billing.status as BillingStatus;
				const alreadyCompleted = paymentStatus === PaymentFlowStatusEnum.SUCCESS || billingStatus === BillingStatus.PAID;
				if (alreadyCompleted) {
					payment.status = PaymentFlowStatusEnum.SUCCESS;
					payment.expireAt = null;
					payment.transactionId = this.resolveGatewayTransactionId(metadata?.transactionId, payment.transactionId);
					payment.paidAt = metadata?.paidAt ?? payment.paidAt ?? new Date();
					if (channel === 'CASH') {
						payment.method = PaymentFlowMethodEnum.CASH;
					}
					await payment.save({ session });

					billing.status = BillingStatus.PAID;
					await billing.save({ session });

					result = {
						paymentId: payment._id.toString(),
						billingId: billing._id.toString(),
						status: payment.status,
						amount: payment.amount,
						method: payment.method,
					};

					return;
				}

				const visit = await this.visitModel.findById(billing.visitId).session(session).exec();
				if (!visit || !visit.patientId) {
					throw new BadRequestException('Associated visit or patient not found');
				}

				const patientId = visit.patientId.toString();
				const appointmentId = visit.appointmentId?.toString();
				const creditUsed = Math.max(0, Math.floor(billing.creditUsed ?? 0));
				const coinUsed = Math.max(0, Math.floor(billing.coinUsed ?? 0));

				await this.commitCreditDeduction(patientId, creditUsed, paymentId, appointmentId, session);
				await this.commitCoinSpend(patientId, coinUsed, paymentId, appointmentId, session);
				const rewardAmount = this.calculateRewardAmount(billing.finalPayable ?? 0);
				if (rewardAmount > 0) {
					await this.commitCoinReward(patientId, rewardAmount, paymentId, appointmentId, session);
				}

				payment.status = PaymentFlowStatusEnum.SUCCESS;
				payment.expireAt = null;
				payment.transactionId = this.resolveGatewayTransactionId(metadata?.transactionId, payment.transactionId);
				payment.paidAt = metadata?.paidAt ?? new Date();
				if (channel === 'CASH') {
					payment.method = PaymentFlowMethodEnum.CASH;
				}
				await payment.save({ session });

				billing.status = BillingStatus.PAID;
				await billing.save({ session });

				result = {
					paymentId: payment._id.toString(),
					billingId: billing._id.toString(),
					status: payment.status,
					amount: payment.amount,
					method: payment.method,
				};

				const successPayload = {
					paymentId: payment._id.toString(),
					billingId: billing._id.toString(),
					visitId: visit._id.toString(),
					appointmentId,
					amount: payment.amount,
					method: payment.method,
					performedBy: performedBy ?? 'system',
					channel,
					timestamp: Date.now(),
				};

				this.logger.log('Payment committed successfully', successPayload);
				this.eventEmitter.emit('domain.payment.success', successPayload);
				if (appointmentId) {
					this.eventEmitter.emit('payment.update', { orderId: appointmentId, status: 'COMPLETED' as const });
				}
				if (channel === 'CASH') {
					this.logger.warn(
						`Cash payment marked paid | action=MARK_PAID_CASH | performedBy=${performedBy ?? 'unknown'} | paymentId=${payment._id.toString()} | timestamp=${Date.now()}`,
					);
				}
			});

			if (!result) {
				throw new BadRequestException('Payment commit failed');
			}

			return {
				code: 'SUCCESS',
				message: channel === 'CASH' ? 'Cash payment marked paid' : 'Payment successful',
				data: result,
			};
		} finally {
			await session.endSession();
		}
	}

	private async markDepositPaymentSuccess(
		paymentId: string,
		performedBy?: string,
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		const session = await this.paymentModel.db.startSession();
		try {
			let result: any = null;
			let confirmedAppointment: AppointmentDocument | null = null;
			let shouldEmitBookingSuccess = false;
			let assignmentTaskResult: CreateAssignmentTaskAfterDepositSuccessResult | null = null;

			await session.withTransaction(async () => {
				const payment = await this.paymentModel.findById(paymentId).session(session).exec();
				if (!payment) {
					throw new NotFoundException('Payment not found');
				}
				if (payment.purpose !== PaymentPurposeEnum.APPOINTMENT_DEPOSIT || !payment.appointmentId) {
					throw new BadRequestException('Payment is not an appointment deposit payment');
				}
				if (payment.expireAt && payment.expireAt.getTime() < Date.now()) {
					throw new BadRequestException('Payment expired');
				}

				const appointment = await this.appointmentModel.findById(payment.appointmentId).session(session).exec();
				if (!appointment) {
					throw new NotFoundException('Appointment not found');
				}
				if (
					appointment.appointmentStatus !== AppointmentStatus.PENDING &&
					appointment.appointmentStatus !== AppointmentStatus.CONFIRMED
				) {
					throw new BadRequestException(`Appointment cannot accept deposit from status ${appointment.appointmentStatus}`);
				}

				const paidAt = metadata?.paidAt ?? payment.paidAt ?? new Date();
				const wasAlreadyPaid = payment.status === PaymentFlowStatusEnum.SUCCESS && appointment.depositStatus === DepositStatus.PAID;
				const isBroadDichVuAwaitingAssignment = this.isBroadDichVuAwaitingAssignment(appointment);
				payment.status = PaymentFlowStatusEnum.SUCCESS;
				payment.expireAt = null;
				payment.transactionId = this.resolveGatewayTransactionId(metadata?.transactionId, payment.transactionId);
				payment.paidAt = paidAt;
				await payment.save({ session });

				// Deposit PAID is the proof boundary that allows billing to use depositPaidAmount later.
				appointment.depositStatus = DepositStatus.PAID;
				appointment.depositPaidAmount = payment.amount;
				appointment.depositPaidAt = paidAt.getTime();
				appointment.depositPaymentId = payment._id;
				if (isBroadDichVuAwaitingAssignment) {
					// Broad DICH_VU deposit success opens receptionist assignment work, but
					// doctor/slot assignment remains the booking-success/Visit boundary.
					appointment.assignmentStatus = AssignmentStatus.AWAITING_ASSIGNMENT;
					assignmentTaskResult = await this.assignmentTaskService.createAssignmentTaskAfterDepositSuccess({
						appointmentId: appointment._id.toString(),
						deadlineAt: paidAt.getTime() + this.resolveAssignmentDeadlineMs(),
						specialty: appointment.specialtyId?.toString?.() ?? undefined,
						reasonForAppointment: appointment.reasonForAppointment,
						patientEmail: appointment.patientEmail,
						session,
					});
				} else if (appointment.appointmentStatus === AppointmentStatus.PENDING) {
					appointment.appointmentStatus = AppointmentStatus.CONFIRMED;
					shouldEmitBookingSuccess = !wasAlreadyPaid;
				}
				await appointment.save({ session });

				confirmedAppointment = appointment;
				result = {
					paymentId: payment._id.toString(),
					appointmentId: appointment._id.toString(),
					status: payment.status,
					amount: payment.amount,
					method: payment.method,
				};
			});

			if (!result || !confirmedAppointment) {
				throw new BadRequestException('Deposit payment commit failed');
			}
			const committedResult = result as { paymentId: string; appointmentId: string; status: PaymentFlowStatusEnum; amount: number; method: PaymentFlowMethodEnum };
			const committedAssignmentTaskResult =
				assignmentTaskResult as CreateAssignmentTaskAfterDepositSuccessResult | null;

			if (shouldEmitBookingSuccess) {
				const payload = await this.buildAppointmentBookingPayload(confirmedAppointment);
				this.eventEmitter.emit('appointment.booking.success', payload);
			}
			if (committedAssignmentTaskResult && committedAssignmentTaskResult.created) {
				this.eventEmitter.emit('appointment.assignment.created', {
					taskId: committedAssignmentTaskResult.taskId,
					appointmentId: committedAssignmentTaskResult.appointmentId,
					patientEmail: committedAssignmentTaskResult.patientEmail,
					specialty: committedAssignmentTaskResult.specialty,
					priority: 'NORMAL',
					deadlineAt: committedAssignmentTaskResult.deadlineAt,
					reasonForAppointment: committedAssignmentTaskResult.reasonForAppointment,
				});
			}
			this.eventEmitter.emit('payment.update', {
				orderId: committedResult.appointmentId,
				status: 'COMPLETED' as const,
			});

			this.logger.log(`Deposit payment committed by ${performedBy ?? 'system'} for appointment ${committedResult.appointmentId}`);
			return {
				code: 'SUCCESS',
				message: 'Appointment deposit payment successful',
				data: committedResult,
			};
		} finally {
			await session.endSession();
		}
	}

	private async markDepositPaymentFailed(
		paymentId: string,
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		const session = await this.paymentModel.db.startSession();
		try {
			let result: { paymentId: string; appointmentId: string; status: PaymentFlowStatusEnum } | null = null;

			await session.withTransaction(async () => {
				const payment = await this.paymentModel.findById(paymentId).session(session).exec();
				if (!payment) {
					throw new NotFoundException('Payment not found');
				}
				if (payment.purpose !== PaymentPurposeEnum.APPOINTMENT_DEPOSIT || !payment.appointmentId) {
					return;
				}

				const appointment = await this.appointmentModel.findById(payment.appointmentId).session(session).exec();
				if (!appointment) {
					throw new NotFoundException('Appointment not found');
				}

				if (payment.status !== PaymentFlowStatusEnum.SUCCESS) {
					payment.status = PaymentFlowStatusEnum.FAILED;
					payment.expireAt = null;
					payment.transactionId = this.resolveGatewayTransactionId(metadata?.transactionId, payment.transactionId);
					payment.paidAt = metadata?.paidAt ?? payment.paidAt;
					await payment.save({ session });

					appointment.depositStatus = DepositStatus.FAILED;
					if (appointment.appointmentStatus === AppointmentStatus.PENDING) {
						appointment.appointmentStatus = AppointmentStatus.FAILED;
					}
					await appointment.save({ session });

					if (this.isBroadDichVuAwaitingAssignment(appointment)) {
						await this.assignmentTaskService.closeActiveTaskAfterDepositFailure({
							appointmentId: appointment._id.toString(),
							note: 'deposit payment failed',
							session,
						});
					}

					if (appointment.timeSlot) {
						await this.timeSlotLogModel.updateOne(
							{ _id: appointment.timeSlot },
							{ $set: { status: 'available' } },
							{ session },
						);
					}
				}

				result = {
					paymentId: payment._id.toString(),
					appointmentId: appointment._id.toString(),
					status: payment.status,
				};
			});

			return result
				? { code: 'FAILED', message: 'Appointment deposit payment failed', data: result }
				: null;
		} finally {
			await session.endSession();
		}
	}

	private isBroadDichVuAwaitingAssignment(appointment: AppointmentDocument): boolean {
		return (
			appointment.paymentCategory === PaymentCategory.DICH_VU &&
			appointment.assignmentStatus === AssignmentStatus.AWAITING_ASSIGNMENT &&
			!appointment.doctorId &&
			!appointment.timeSlot
		);
	}

	private resolveAssignmentDeadlineMs(): number {
		const configured = Number(this.config.get('ASSIGNMENT_DEADLINE_MINUTES'));
		const minutes =
			Number.isFinite(configured) && configured > 0
				? Math.floor(configured)
				: this.DEFAULT_ASSIGNMENT_DEADLINE_MINUTES;
		return minutes * 60_000;
	}

	private async buildAppointmentBookingPayload(appointment: AppointmentDocument) {
		const doctor = appointment.doctorId
			? await this.doctorModel.findById(appointment.doctorId).populate('profileId', 'name email').lean()
			: null;
		const patient = appointment.patientId
			? await this.patientModel.findById(appointment.patientId).populate('profileId', 'name email phone avatarUrl').lean()
			: null;

		const doctorProfile = (doctor as any)?.profileId ? (doctor as any).profileId : null;
		const patientProfile = (patient as any)?.profileId ? (patient as any).profileId : null;

		const payload = buildEnrichedAppointmentPayload(
			appointment,
			doctorProfile,
			patientProfile,
			appointment.consultationFee ?? 0,
			patientProfile?.name ?? appointment.patientEmail,
			appointment.patientEmail,
		);

		return {
			...payload,
			paymentStatus: PaymentFlowStatusEnum.SUCCESS,
		};
	}

	private calculateRewardAmount(finalPayable: number): number {
		return Math.max(0, Math.floor(Math.max(0, finalPayable) * COIN_REWARD_RATE));
	}

	private async commitCreditDeduction(
		patientId: string,
		creditUsed: number,
		paymentId: string,
		appointmentId: string | undefined,
		session: ClientSession,
	) {
		if (creditUsed <= 0) {
			return;
		}

		const wallet = await this.creditWalletModel.findOne({ patientId: new Types.ObjectId(patientId) }).session(session).exec();
		if (!wallet) {
			throw new BadRequestException('Credit wallet not found');
		}
		if (wallet.creditBalance < creditUsed) {
			throw new BadRequestException(`Insufficient credit. Balance: ${wallet.creditBalance}, Required: ${creditUsed}`);
		}

		wallet.creditBalance -= creditUsed;
		wallet.totalDebited += creditUsed;
		await wallet.save({ session });

		await this.creditTransactionModel.create([
			{
				patientId: new Types.ObjectId(patientId),
				appointmentId: appointmentId ? new Types.ObjectId(appointmentId) : undefined,
				type: 'debit',
				amount: creditUsed,
				reason: 'billing_payment',
				description: `Billing payment commit for payment ${paymentId}`,
				status: 'completed',
			},
		], { session });
	}

	private async commitCoinSpend(
		patientId: string,
		coinUsed: number,
		paymentId: string,
		appointmentId: string | undefined,
		session: ClientSession,
	) {
		const normalizedAmount = this.normalizeCoinAmount(coinUsed);
		if (normalizedAmount <= 0) {
			return;
		}

		const patientObjectId = new Types.ObjectId(patientId);
		const spendCreatedAt = new Date();
		const wallet = await this.coinWalletModel.findOne({ patientId: patientObjectId }).session(session).exec();
		if (!wallet) {
			throw new BadRequestException('Coin wallet not found');
		}

		const eligibleEarns = await this.loadCompletedEarnTransactions(patientId, { upToCreatedAt: spendCreatedAt, onlyUnexpiredAt: spendCreatedAt }, session);
		const allocationMap = await this.loadAllocationMapForEarns(patientId, eligibleEarns.map((tx) => tx._id), session);
		const sortedEligibleEarns = this.sortSpendableEarnTransactions(eligibleEarns, spendCreatedAt);
		const allocationRows: Array<{ earnTransactionId: Types.ObjectId; amount: number }> = [];
		let remainingSpend = normalizedAmount;

		for (const earn of sortedEligibleEarns) {
			if (remainingSpend <= 0) {
				break;
			}

			const earnAmount = this.normalizeCoinAmount(earn.amount);
			const usedAmount = Math.min(earnAmount, allocationMap.get(earn._id.toString()) ?? 0);
			const availableAmount = Math.max(0, earnAmount - usedAmount);
			if (availableAmount <= 0) {
				continue;
			}

			const consumeAmount = Math.min(availableAmount, remainingSpend);
			allocationRows.push({ earnTransactionId: earn._id, amount: consumeAmount });
			remainingSpend -= consumeAmount;
		}

		if (remainingSpend > 0) {
			throw new BadRequestException('Insufficient coins');
		}

		const spendTransaction = await this.coinTransactionModel.create([
			{
				patientId: patientObjectId,
				appointmentId: appointmentId ? new Types.ObjectId(appointmentId) : undefined,
				type: 'spend',
				amount: normalizedAmount,
				reason: 'billing_payment',
				description: `Billing payment commit for payment ${paymentId}`,
				status: 'completed',
			},
		], { session, ordered: true });

		if (allocationRows.length > 0) {
			await this.coinSpendAllocationModel.create(
				allocationRows.map((row) => ({
					spendTransactionId: spendTransaction[0]._id,
					earnTransactionId: row.earnTransactionId,
					patientId: patientObjectId,
					amount: row.amount,
				})),
				{ session, ordered: true },
			);
		}

		wallet.coinBalance = Math.max(0, wallet.coinBalance - normalizedAmount);
		wallet.totalCoinUsed += normalizedAmount;
		await wallet.save({ session });
	}

	private async commitCoinReward(
		patientId: string,
		rewardAmount: number,
		paymentId: string,
		appointmentId: string | undefined,
		session: ClientSession,
	) {
		const normalizedAmount = this.normalizeCoinAmount(rewardAmount);
		if (normalizedAmount <= 0) {
			return;
		}

		const patientObjectId = new Types.ObjectId(patientId);
		const wallet = await this.coinWalletModel.findOne({ patientId: patientObjectId }).session(session).exec();
		const persistedWallet = wallet ?? new this.coinWalletModel({
			patientId: patientObjectId,
			coinBalance: 0,
			totalCoinEarned: 0,
			totalCoinUsed: 0,
		});

		persistedWallet.coinBalance += normalizedAmount;
		persistedWallet.totalCoinEarned += normalizedAmount;
		await persistedWallet.save({ session });

		await this.coinTransactionModel.create([
			{
				patientId: patientObjectId,
				appointmentId: appointmentId ? new Types.ObjectId(appointmentId) : undefined,
				type: 'earn',
				amount: normalizedAmount,
				reason: 'payment_reward',
				description: `Reward coin for payment ${paymentId}`,
				status: 'completed',
				expiresAt: new Date(Date.now() + COIN_DEFAULT_EXPIRE_DAYS * 24 * 60 * 60 * 1000),
			},
		], { session });
	}

	private normalizeCoinAmount(amount: number): number {
		return Math.max(0, Math.floor(amount || 0));
	}

	private async loadCompletedEarnTransactions(
		patientId: string,
		input: { upToCreatedAt: Date; onlyUnexpiredAt: Date },
		session: ClientSession,
	): Promise<ActiveEarnTransaction[]> {
		return this.coinTransactionModel
			.find({
				patientId: new Types.ObjectId(patientId),
				type: 'earn',
				status: 'completed',
				createdAt: { $lte: input.upToCreatedAt },
				$or: [
					{ expiresAt: { $exists: false } },
					{ expiresAt: null },
					{ expiresAt: { $gt: input.onlyUnexpiredAt } },
				],
			})
			.select('_id amount expiresAt createdAt')
			.sort({ expiresAt: 1, createdAt: 1, _id: 1 })
			.session(session)
			.lean()
			.exec() as Promise<ActiveEarnTransaction[]>;
	}

	private async loadAllocationMapForEarns(
		patientId: string,
		earnTransactionIds: Types.ObjectId[],
		session: ClientSession,
	): Promise<Map<string, number>> {
		const allocationMap = new Map<string, number>();
		if (earnTransactionIds.length === 0) {
			return allocationMap;
		}

		const allocations = await this.coinSpendAllocationModel
			.find({
				patientId: new Types.ObjectId(patientId),
				earnTransactionId: { $in: earnTransactionIds },
			})
			.select('earnTransactionId amount')
			.session(session)
			.lean()
			.exec();

		for (const allocation of allocations) {
			const key = allocation.earnTransactionId.toString();
			allocationMap.set(key, (allocationMap.get(key) ?? 0) + this.normalizeCoinAmount(allocation.amount));
		}

		return allocationMap;
	}

	private sortSpendableEarnTransactions(earns: ActiveEarnTransaction[], now: Date): ActiveEarnTransaction[] {
		const activeEarns = earns
			.filter((tx) => tx.expiresAt && tx.expiresAt > now)
			.sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

		const nonExpiringEarns = earns
			.filter((tx) => !tx.expiresAt)
			.sort((left, right) => this.compareByCreatedAt(left, right));

		return [...activeEarns, ...nonExpiringEarns];
	}

	private compareByExpiryThenCreatedAt(
		left: { expiresAt?: Date; createdAt?: Date; _id: Types.ObjectId },
		right: { expiresAt?: Date; createdAt?: Date; _id: Types.ObjectId },
	): number {
		const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
		if (leftExpiry !== rightExpiry) {
			return leftExpiry - rightExpiry;
		}

		const leftCreatedAt = left.createdAt?.getTime() ?? 0;
		const rightCreatedAt = right.createdAt?.getTime() ?? 0;
		if (leftCreatedAt !== rightCreatedAt) {
			return leftCreatedAt - rightCreatedAt;
		}

		return left._id.toString().localeCompare(right._id.toString());
	}

	private compareByCreatedAt(
		left: { createdAt?: Date; _id: Types.ObjectId },
		right: { createdAt?: Date; _id: Types.ObjectId },
	): number {
		const leftCreatedAt = left.createdAt?.getTime() ?? 0;
		const rightCreatedAt = right.createdAt?.getTime() ?? 0;
		if (leftCreatedAt !== rightCreatedAt) {
			return leftCreatedAt - rightCreatedAt;
		}

		return left._id.toString().localeCompare(right._id.toString());
	}

	private resolveGatewayTransactionId(
		incoming?: string | null,
		current?: string,
	): string | undefined {
		const normalizedIncoming = incoming?.trim();
		// VNPay sends transactionNo=0 for cancelled/failed attempts. Treat it as
		// "no gateway transaction" so the unique sparse transactionId index is not polluted.
		if (!normalizedIncoming || normalizedIncoming === '0') {
			return current;
		}

		return normalizedIncoming;
	}

	private buildPaymentExpireAt(): Date {
		const expireMinutes = Math.max(1, Number(this.config.get('VN_PAY_EXPIRE_MINUTES') ?? 15));
		return new Date(Date.now() + expireMinutes * 60 * 1000);
	}
}
