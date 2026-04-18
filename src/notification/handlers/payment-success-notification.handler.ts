import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { PaymentSuccessDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class PaymentSuccessNotificationHandler implements NotificationHandler<PaymentSuccessDto> {
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(payload: PaymentSuccessDto, meta: NotificationHandlerMeta): Promise<void> {
    const title = 'Thanh toan thanh cong';
    const message = `Thanh toan don ${payload.orderId} da hoan tat thanh cong.`;

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'payment_success',
        orderId: payload.orderId,
        status: payload.status,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'PAYMENT_SUCCESS',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
