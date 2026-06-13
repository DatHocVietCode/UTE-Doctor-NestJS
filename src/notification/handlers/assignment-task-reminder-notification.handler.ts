import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AssignmentTaskReminderDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class AssignmentTaskReminderNotificationHandler
  implements NotificationHandler<AssignmentTaskReminderDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(
    payload: AssignmentTaskReminderDto,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const title = 'Nhac nho: yeu cau dat kham sap qua han phan cong';
    const message =
      'Co yeu cau dat kham dang cho phan cong bac si va sap qua han. Vui long xu ly som.';

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'assignment_task_reminder',
        taskId: payload.taskId,
        appointmentId: payload.appointmentId,
        deadlineAt: payload.deadlineAt,
        reminderCount: payload.reminderCount,
        online: payload.online,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    // Idempotency: a duplicate event hits the unique idempotencyKey and is skipped,
    // so we neither double-store nor double-emit on the socket.
    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'ASSIGNMENT_TASK_REMINDER',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
