import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Billing, BillingDocument, BillingStatus } from 'src/billing/billing.schema';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { COIN_DEFAULT_EXPIRE_DAYS, COIN_REWARD_RATE } from 'src/wallet/coin/coin-reward.config';
import { CoinSpendAllocation, CoinSpendAllocationDocument } from 'src/wallet/coin/schemas/coin-spend-allocation.schema';
import { CoinTransaction, CoinTransactionDocument } from 'src/wallet/coin/schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletDocument } from 'src/wallet/coin/schemas/coin-wallet.schema';
import { CreditTransaction, CreditTransactionDocument } from 'src/wallet/credit/schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletDocument } from 'src/wallet/credit/schemas/credit-wallet.schema';
import { PaymentFlowMethodEnum, PaymentFlowStatusEnum } from './enums/payment-flow.enum';
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

	constructor(
		@InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
		@InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
		@InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
		@InjectModel(CreditWallet.name) private readonly creditWalletModel: Model<CreditWalletDocument>,
		@InjectModel(CreditTransaction.name) private readonly creditTransactionModel: Model<CreditTransactionDocument>,
		@InjectModel(CoinWallet.name) private readonly coinWalletModel: Model<CoinWalletDocument>,
		@InjectModel(CoinTransaction.name) private readonly coinTransactionModel: Model<CoinTransactionDocument>,
		@InjectModel(CoinSpendAllocation.name)
		private readonly coinSpendAllocationModel: Model<CoinSpendAllocationDocument>,
		private readonly config: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly vnPayPaymentService: VnPayPaymentService,
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

		const existingPayment = await this.paymentModel.findOne({ billingId: billing._id }).session(options?.session ?? null).exec();
		if (existingPayment) {
			if (existingPayment.status === PaymentFlowStatusEnum.SUCCESS) {
				throw new BadRequestException('Payment already completed for this billing');
			}
			return existingPayment;
		}

		const payment = await this.paymentModel.create([
			{
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

	async markPaymentSuccessByBillingId(
		billingId: string,
		performedBy?: string,
		channel: 'QR' | 'CASH' = 'QR',
		metadata?: { transactionId?: string; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
	) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		const payment = await this.paymentModel.findOne({ billingId: new Types.ObjectId(billingId) }).exec();
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
					payment.transactionId = metadata?.transactionId ?? payment.transactionId;
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
				payment.transactionId = metadata?.transactionId ?? payment.transactionId;
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

	private buildPaymentExpireAt(): Date {
		const expireMinutes = Math.max(1, Number(this.config.get('VN_PAY_EXPIRE_MINUTES') ?? 15));
		return new Date(Date.now() + expireMinutes * 60 * 1000);
	}
}