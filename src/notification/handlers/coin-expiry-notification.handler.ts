import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from 'src/common/redis/redis.service';
import { COIN_EXPIRY_REMINDER_MAIL_EVENT } from 'src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.constants';
import type { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class CoinExpiryNotificationHandler implements NotificationHandler<CoinExpiryReminderEventPayload> {
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(payload: CoinExpiryReminderEventPayload, meta: NotificationHandlerMeta): Promise<void> {
    const title = 'Thong bao coin sap het han';
    const message = `Ban co ${payload.amount} coin sap het han. Vui long su dung truoc khi het han.`;

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'coin_expiry_reminder',
        jobId: payload.jobId,
        transactionId: payload.transactionId,
        amount: payload.amount,
        expiresAt: payload.expiresAt,
        runAt: payload.runAt,
        reminderDays: payload.reminderDays,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'COIN_EXPIRY_REMINDER',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });

    await this.eventEmitter.emitAsync(COIN_EXPIRY_REMINDER_MAIL_EVENT, payload);
  }
}
