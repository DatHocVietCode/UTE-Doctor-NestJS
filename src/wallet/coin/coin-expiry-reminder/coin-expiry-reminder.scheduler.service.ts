import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import {
    REMINDER_DISPATCH_BUFFER_MS,
    SCHEDULER_INTERVAL_MS
} from './coin-expiry-reminder.constants';
import { CoinExpiryReminderService } from './coin-expiry-reminder.service';
import { CoinExpiryReminderDispatchMessage } from './dto/coin-expiry-reminder.dto';

@Injectable()
export class CoinExpiryReminderSchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(CoinExpiryReminderSchedulerService.name);
	private intervalId: NodeJS.Timeout | null = null;
	private running = false;

	constructor(
		private readonly coinExpiryReminderService: CoinExpiryReminderService,
		private readonly rabbitMqService: RabbitMqService,
	) {}

	async onModuleInit(): Promise<void> {
		await this.coinExpiryReminderService.ensureTopology();
		await this.dispatchDueJobs();

		this.intervalId = setInterval(() => {
			void this.dispatchDueJobs();
		}, SCHEDULER_INTERVAL_MS);
	}

	async onModuleDestroy(): Promise<void> {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private async dispatchDueJobs(): Promise<void> {
		if (this.running) {
			return;
		}

		this.running = true;
		try {
			const now = new Date();
			const cutoff = new Date(now.getTime() + REMINDER_DISPATCH_BUFFER_MS);
			this.logger.debug(`[CoinExpiryScheduler] Checking for due jobs at ${now.toISOString()}, cutoff: ${cutoff.toISOString()}`);
			
			const dueJobs = await this.coinExpiryReminderService.listDueJobs(cutoff, 100);
			this.logger.log(`[CoinExpiryScheduler] Found ${dueJobs.length} due jobs to dispatch`);

			if (dueJobs.length === 0) {
				this.logger.debug(`[CoinExpiryScheduler] No due jobs found`);
				return;
			}

			for (const job of dueJobs) {
				this.logger.log(`[CoinExpiryScheduler] Processing job ${job.jobId} for patient ${job.patientId}`);
				
				const locked = await this.coinExpiryReminderService.acquireDispatchLock(job.jobId);
				if (!locked) {
					this.logger.warn(`[CoinExpiryScheduler] Failed to acquire lock for job ${job.jobId}`);
					continue;
				}

				const payload: CoinExpiryReminderDispatchMessage = {
					jobId: job.jobId,
					transactionId: job.transactionId,
					patientId: job.patientId,
					type: 'COIN_EXPIRY_REMINDER',
					retryCount: job.retryCount ?? 0,
				};

				const published = await this.coinExpiryReminderService.publishDispatch(payload);
				if (!published) {
					this.logger.warn(`[CoinExpiryScheduler] Failed to publish reminder job ${job.jobId} to RabbitMQ.`);
				} else {
					this.logger.log(`[CoinExpiryScheduler] Successfully published job ${job.jobId}`);
				}

				await this.coinExpiryReminderService.releaseDispatchLock(job.jobId);
			}
		} catch (error) {
			this.logger.error(`[CoinExpiryScheduler] Scheduler error: ${(error as Error).message}`, (error as Error).stack);
		} finally {
			this.running = false;
		}
	}
}
