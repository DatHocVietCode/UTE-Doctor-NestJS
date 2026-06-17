import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import { RedisService } from 'src/common/redis/redis.service';
import { CoinTransaction } from '../schemas/coin-transaction.schema';
import {
    COIN_EXPIRY_DAY_MS,
    COIN_EXPIRY_REMINDER_DLQ_QUEUE,
    COIN_EXPIRY_REMINDER_DLX_EXCHANGE,
    COIN_EXPIRY_REMINDER_QUEUE,
    COIN_EXPIRY_REMINDER_TYPE,
    EXPIRY_REMINDER_DAYS,
    REMINDER_DISPATCH_LOCK_TTL_SECONDS,
    REMINDER_PROCESS_LOCK_TTL_SECONDS,
} from './coin-expiry-reminder.constants';
import {
    CoinExpiryReminderDispatchMessage,
    CoinExpiryReminderEventPayload,
} from './dto/coin-expiry-reminder.dto';
import { CoinJobSchedule, CoinJobScheduleDocument } from './schemas/coin-job-schedule.schema';

type EarnTransactionForReminder = Pick<CoinTransaction, '_id' | 'patientId' | 'amount' | 'expiresAt'>;

@Injectable()
export class CoinExpiryReminderService {
	private readonly logger = new Logger(CoinExpiryReminderService.name);
	private topologyReady = false;

	constructor(
		@InjectModel(CoinJobSchedule.name) private readonly coinJobScheduleModel: Model<CoinJobScheduleDocument>,
		private readonly rabbitMqService: RabbitMqService,
		private readonly redisService: RedisService,
	) {}

	async ensureTopology(): Promise<boolean> {
		if (this.topologyReady) {
			return true;
		}

		const exchangeReady = await this.rabbitMqService.assertExchange(COIN_EXPIRY_REMINDER_DLX_EXCHANGE, 'direct', {
			durable: true,
		});
		const dlqReady = await this.rabbitMqService.assertQueue(COIN_EXPIRY_REMINDER_DLQ_QUEUE, { durable: true });
		const bindReady = await this.rabbitMqService.bindQueue(
			COIN_EXPIRY_REMINDER_DLQ_QUEUE,
			COIN_EXPIRY_REMINDER_DLX_EXCHANGE,
			COIN_EXPIRY_REMINDER_DLQ_QUEUE,
		);

		// Avoid reasserting the main queue with different arguments because existing deployments may already own it.
		// Final failure handling still publishes to the DLQ exchange explicitly.
		const queueExists = await this.rabbitMqService.checkQueue(COIN_EXPIRY_REMINDER_QUEUE);
		const queueReady = queueExists || (await this.rabbitMqService.assertQueue(COIN_EXPIRY_REMINDER_QUEUE, { durable: true }));

		this.topologyReady = !!exchangeReady && !!dlqReady && !!bindReady && !!queueReady;
		if (!this.topologyReady) {
			this.logger.warn('Coin expiry reminder RabbitMQ topology was not fully initialized.');
		}

		return this.topologyReady;
	}

	async createReminderJobForEarnTransaction(
		earnTransaction: EarnTransactionForReminder,
		session?: ClientSession,
	): Promise<CoinJobScheduleDocument | null> {
		if (!earnTransaction.expiresAt) {
			return null;
		}

		const runAt = new Date(earnTransaction.expiresAt.getTime() - EXPIRY_REMINDER_DAYS * COIN_EXPIRY_DAY_MS);
		const jobId = earnTransaction._id.toString();
		const patientId = earnTransaction.patientId.toString();

		const query = { jobId };
		const update = {
			$setOnInsert: {
				jobId,
				transactionId: jobId,
				patientId,
				type: COIN_EXPIRY_REMINDER_TYPE,
				runAt,
				status: 'PENDING' as const,
				retryCount: 0,
			},
		};

		const options = { upsert: true, new: true, session };
		const job = await this.coinJobScheduleModel.findOneAndUpdate(query, update, options).exec();
		return job;
	}

	async listDueJobs(now: Date, limit = 100): Promise<CoinJobScheduleDocument[]> {
		return this.coinJobScheduleModel
			.find({
				status: 'PENDING',
				runAt: { $lte: now },
			})
			.sort({ runAt: 1, createdAt: 1 })
			.limit(limit)
			.lean<CoinJobScheduleDocument[]>()
			.exec();
	}

	async markJobDone(jobId: string, session?: ClientSession): Promise<void> {
		await this.coinJobScheduleModel.updateOne(
			{ jobId },
			{
				$set: {
					status: 'DONE',
					updatedAt: new Date(),
					lastError: undefined,
				},
			},
			{ session },
		);
	}

	async markJobRetry(jobId: string, error: string, session?: ClientSession): Promise<CoinJobScheduleDocument | null> {
		const job = await this.coinJobScheduleModel
			.findOneAndUpdate(
				{ jobId, status: 'PENDING' },
				{
					$inc: { retryCount: 1 },
					$set: {
						lastError: error,
						updatedAt: new Date(),
					},
				},
				{ new: true, session },
			)
			.exec();

		return job;
	}

	async markJobFailed(jobId: string, error: string, session?: ClientSession): Promise<void> {
		await this.coinJobScheduleModel.updateOne(
			{ jobId },
			{
				$set: {
					status: 'FAILED',
					lastError: error,
					updatedAt: new Date(),
				},
			},
			{ session },
		);
	}

	async publishDispatch(payload: CoinExpiryReminderDispatchMessage): Promise<boolean> {
		return this.rabbitMqService.publish(COIN_EXPIRY_REMINDER_QUEUE, payload);
	}

	async publishDeadLetter(payload: Record<string, unknown>): Promise<boolean> {
		return this.rabbitMqService.publishToExchange(COIN_EXPIRY_REMINDER_DLX_EXCHANGE, COIN_EXPIRY_REMINDER_DLQ_QUEUE, payload);
	}

	async acquireDispatchLock(jobId: string): Promise<boolean> {
		return this.redisService.acquireLock(`coin-expiry-reminder:dispatch:${jobId}`, jobId, REMINDER_DISPATCH_LOCK_TTL_SECONDS);
	}

	async releaseDispatchLock(jobId: string): Promise<void> {
		await this.redisService.releaseLock(`coin-expiry-reminder:dispatch:${jobId}`, jobId);
	}

	async acquireProcessLock(jobId: string): Promise<boolean> {
		return this.redisService.acquireLock(`coin-expiry-reminder:process:${jobId}`, jobId, REMINDER_PROCESS_LOCK_TTL_SECONDS);
	}

	async releaseProcessLock(jobId: string): Promise<void> {
		await this.redisService.releaseLock(`coin-expiry-reminder:process:${jobId}`, jobId);
	}

	buildReminderEventPayload(params: {
		jobId: string;
		patientId: string;
		patientEmail: string;
		patientName: string | null;
		amount: number;
		expiresAt: Date;
		runAt: Date;
		retryCount: number;
	}): CoinExpiryReminderEventPayload {
		return {
			jobId: params.jobId,
			transactionId: params.jobId,
			patientId: params.patientId,
			patientEmail: params.patientEmail,
			patientName: params.patientName,
			amount: Math.max(0, Math.floor(params.amount || 0)),
			expiresAt: params.expiresAt.getTime(),
			runAt: params.runAt.getTime(),
			reminderDays: EXPIRY_REMINDER_DAYS,
			retryCount: params.retryCount,
		};
	}
}
