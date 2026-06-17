import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { Account } from 'src/account/schemas/account.schema';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import { Patient } from 'src/patient/schema/patient.schema';
import { Profile } from 'src/profile/schema/profile.schema';
import { CoinTransaction, CoinTransactionDocument } from '../schemas/coin-transaction.schema';
import {
    COIN_EXPIRY_REMINDER_MAIL_EVENT,
    COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT,
    COIN_EXPIRY_REMINDER_QUEUE,
    MAX_RETRY,
} from './coin-expiry-reminder.constants';
import { CoinExpiryReminderService } from './coin-expiry-reminder.service';
import {
    CoinExpiryReminderDispatchMessage,
    CoinExpiryReminderEventPayload,
} from './dto/coin-expiry-reminder.dto';
import { CoinJobSchedule, CoinJobScheduleDocument } from './schemas/coin-job-schedule.schema';

type CoinTransactionLean = {
	_id: mongoose.Types.ObjectId;
	amount: number;
	expiresAt?: Date;
	patientId: mongoose.Types.ObjectId;
};

@Injectable()
export class CoinExpiryReminderQueueConsumer implements OnModuleInit {
	private readonly logger = new Logger(CoinExpiryReminderQueueConsumer.name);

	constructor(
		private readonly rabbitMqService: RabbitMqService,
		private readonly eventEmitter: EventEmitter2,
		private readonly coinExpiryReminderService: CoinExpiryReminderService,
		@InjectModel(CoinJobSchedule.name) private readonly coinJobScheduleModel: Model<CoinJobScheduleDocument>,
		@InjectModel(CoinTransaction.name) private readonly coinTransactionModel: Model<CoinTransactionDocument>,
		@InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
		@InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
		@InjectModel(Account.name) private readonly accountModel: Model<Account>,
	) {}

	async onModuleInit(): Promise<void> {
		await this.coinExpiryReminderService.ensureTopology();

		const attached = await this.rabbitMqService.consume(
			COIN_EXPIRY_REMINDER_QUEUE,
			async (_message, payload: CoinExpiryReminderDispatchMessage) => {
				await this.handleDispatch(payload);
			},
			10,
		);

		if (!attached) {
			this.logger.warn('Coin expiry reminder queue consumer was not attached.');
		}
	}

	private async handleDispatch(payload: CoinExpiryReminderDispatchMessage): Promise<void> {
		const job = await this.coinJobScheduleModel.findOne({ jobId: payload.jobId }).lean().exec();
		if (!job) {
			this.logger.warn(`Reminder job ${payload.jobId} was not found.`);
			return;
		}

		if (job.status === 'DONE' || job.status === 'FAILED') {
			this.logger.debug(`Skip reminder job ${job.jobId} because it is already ${job.status}.`);
			return;
		}

		const locked = await this.coinExpiryReminderService.acquireProcessLock(job.jobId);
		if (!locked) {
			this.logger.debug(`Skip reminder job ${job.jobId} because another worker is processing it.`);
			return;
		}

		try {
			const earnTransaction = await this.coinTransactionModel
				.findOne({ _id: new mongoose.Types.ObjectId(job.transactionId), type: 'earn' })
				.lean<CoinTransactionLean>()
				.exec();

			if (!earnTransaction || !earnTransaction.expiresAt) {
				throw new Error('COIN_TRANSACTION_NOT_FOUND_OR_NOT_EXPIRING');
			}

			const patient = await this.patientModel
				.findById(job.patientId)
				.populate([{ path: 'profileId', select: 'name email' }, { path: 'accountId', select: 'email' }])
				.lean()
				.exec();

			if (!patient) {
				throw new Error('PATIENT_NOT_FOUND');
			}

			const profile = patient.profileId as unknown as { name?: string; email?: string } | undefined;
			const account = patient.accountId as unknown as { email?: string } | undefined;
			const patientEmail = account?.email || profile?.email || '';
			if (!patientEmail) {
				throw new Error('PATIENT_EMAIL_NOT_FOUND');
			}

			const reminderPayload: CoinExpiryReminderEventPayload = this.coinExpiryReminderService.buildReminderEventPayload({
				jobId: job.jobId,
				patientId: job.patientId,
				patientEmail,
				patientName: profile?.name ?? null,
				amount: earnTransaction.amount,
				expiresAt: earnTransaction.expiresAt,
				runAt: job.runAt,
				retryCount: job.retryCount ?? 0,
			});

			// Handlers remain decoupled: email and realtime delivery are triggered independently.
			await this.eventEmitter.emitAsync(COIN_EXPIRY_REMINDER_MAIL_EVENT, reminderPayload);
			await this.eventEmitter.emitAsync(COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT, reminderPayload);

			await this.coinExpiryReminderService.markJobDone(job.jobId);
			this.logger.log(`Reminder job ${job.jobId} processed successfully.`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const updatedJob = await this.coinExpiryReminderService.markJobRetry(job.jobId, errorMessage);
			const retryCount = updatedJob?.retryCount ?? (job.retryCount ?? 0) + 1;

			if (retryCount < MAX_RETRY) {
				const republished = await this.coinExpiryReminderService.publishDispatch({
					jobId: job.jobId,
					transactionId: job.transactionId,
					patientId: job.patientId,
					type: 'COIN_EXPIRY_REMINDER',
					retryCount,
				});

				if (!republished) {
					this.logger.warn(`Failed to requeue reminder job ${job.jobId} after error: ${errorMessage}`);
				}
				return;
			}

			await this.coinExpiryReminderService.markJobFailed(job.jobId, errorMessage);
			await this.coinExpiryReminderService.publishDeadLetter({
				jobId: job.jobId,
				transactionId: job.transactionId,
				patientId: job.patientId,
				type: 'COIN_EXPIRY_REMINDER',
				retryCount,
				error: errorMessage,
				failedAt: new Date().toISOString(),
			});
			this.logger.error(`Reminder job ${job.jobId} moved to DLQ after ${retryCount} retries: ${errorMessage}`);
		} finally {
			await this.coinExpiryReminderService.releaseProcessLock(job.jobId);
		}
	}
}
