import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from 'src/common/redis/redis.service';
import { COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT, COIN_EXPIRY_REMINDER_REDIS_CHANNEL } from '../coin-expiry-reminder.constants';
import type { CoinExpiryReminderEventPayload } from '../dto/coin-expiry-reminder.dto';

@Injectable()
export class CoinExpiryReminderRealtimeListener {
	constructor(private readonly redisService: RedisService) {}

	@OnEvent(COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT)
	async handleReminderNotification(payload: CoinExpiryReminderEventPayload): Promise<void> {
		// Redis stays the cross-server event bus so every gateway instance can fan out the reminder.
		await this.redisService.publish(COIN_EXPIRY_REMINDER_REDIS_CHANNEL, payload);
	}
}
