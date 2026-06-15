import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AppointmentDoctorAssignedDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import { toStoredNotificationPayload } from '../notification-payload.mapper';
import { buildAppointmentDoctorAssignedNotification } from '../notification-template.helper';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class AppointmentDoctorAssignedNotificationHandler
  implements NotificationHandler<AppointmentDoctorAssignedDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(
    payload: AppointmentDoctorAssignedDto,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const { title, message, titleKey, messageKey, data } =
      buildAppointmentDoctorAssignedNotification(payload);

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      type: 'APPOINTMENT_DOCTOR_ASSIGNED',
      title,
      message,
      titleKey,
      messageKey,
      data,
      details: {
        type: 'appointment_doctor_assigned',
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
