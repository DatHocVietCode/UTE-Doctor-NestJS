import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AppointmentDoctorAssignedDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
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
    const { title, message } = buildAppointmentDoctorAssignedNotification();

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      title,
      message,
      details: {
        type: 'appointment_doctor_assigned',
        recipientEmail: meta.recipientEmail,
        recipientRole: meta.recipientRole,
        appointmentId: payload.appointmentId,
        doctorId: payload.doctorId,
        timeSlotId: payload.timeSlotId,
        scheduledAt: payload.scheduledAt,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'APPOINTMENT_DOCTOR_ASSIGNED',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
