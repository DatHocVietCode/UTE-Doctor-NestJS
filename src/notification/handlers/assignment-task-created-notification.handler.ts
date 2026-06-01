import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AssignmentTaskCreatedDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class AssignmentTaskCreatedNotificationHandler
  implements NotificationHandler<AssignmentTaskCreatedDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(payload: AssignmentTaskCreatedDto, meta: NotificationHandlerMeta): Promise<void> {
    const title = 'Yeu cau dat kham can phan cong bac si';
    const message = payload.specialty
      ? `Co yeu cau dat kham moi (${payload.specialty}) dang cho phan cong bac si.`
      : 'Co yeu cau dat kham moi dang cho phan cong bac si.';

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'assignment_task_created',
        taskId: payload.taskId,
        appointmentId: payload.appointmentId,
        specialty: payload.specialty,
        reasonForAppointment: payload.reasonForAppointment,
        deadlineAt: payload.deadlineAt,
        priority: payload.priority,
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
      type: 'ASSIGNMENT_TASK_CREATED',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
