import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AssignmentTaskExpiredDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import { toStoredNotificationPayload } from '../notification-payload.mapper';
import { buildAssignmentTaskExpiredNotification } from '../notification-template.helper';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class AssignmentTaskExpiredNotificationHandler
  implements NotificationHandler<AssignmentTaskExpiredDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(
    payload: AssignmentTaskExpiredDto,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const { title, message, titleKey, messageKey, data } =
      buildAssignmentTaskExpiredNotification(payload);

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      type: 'ASSIGNMENT_TASK_EXPIRED',
      title,
      message,
      titleKey,
      messageKey,
      data,
      details: {
        type: 'assignment_task_expired',
        recipientEmail: meta.recipientEmail,
        recipientRole: meta.recipientRole,
        ...data,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    // Idempotency: a duplicate event hits the unique idempotencyKey and is skipped,
    // so we neither double-store nor double-emit on the socket.
    if (!created) {
      return;
    }

    await this.redisService.publish(
      NOTIFICATION_REDIS_CHANNEL,
      toStoredNotificationPayload(created),
    );
  }
}
