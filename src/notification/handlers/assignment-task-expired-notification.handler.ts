import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AssignmentTaskExpiredDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
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
    const title = 'Yeu cau dat kham da qua han phan cong';
    const message =
      'Co yeu cau dat kham da qua han phan cong bac si. Vui long xu ly thu cong (lien he benh nhan / phan cong lai).';

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'assignment_task_expired',
        taskId: payload.taskId,
        appointmentId: payload.appointmentId,
        deadlineAt: payload.deadlineAt,
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
      type: 'ASSIGNMENT_TASK_EXPIRED',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
