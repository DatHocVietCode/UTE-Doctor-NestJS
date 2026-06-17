import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { PaymentSuccessDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import { toStoredNotificationPayload } from '../notification-payload.mapper';
import { buildPaymentSuccessNotification } from '../notification-template.helper';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class PaymentSuccessNotificationHandler
  implements NotificationHandler<PaymentSuccessDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(
    payload: PaymentSuccessDto,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const { title, message, titleKey, messageKey, data } =
      buildPaymentSuccessNotification(payload);

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      type: 'PAYMENT_SUCCESS',
      title,
      message,
      titleKey,
      messageKey,
      data,
      details: {
        type: 'payment_success',
        recipientEmail: meta.recipientEmail,
        recipientRole: meta.recipientRole,
        ...data,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(
      NOTIFICATION_REDIS_CHANNEL,
      toStoredNotificationPayload(created),
    );
  }
}
