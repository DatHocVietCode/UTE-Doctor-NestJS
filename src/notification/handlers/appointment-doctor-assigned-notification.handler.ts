import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import type { AppointmentDoctorAssignedDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class AppointmentDoctorAssignedNotificationHandler
  implements NotificationHandler<AppointmentDoctorAssignedDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
  ) {}

  async handle(payload: AppointmentDoctorAssignedDto, meta: NotificationHandlerMeta): Promise<void> {
    const title = 'Bac si da duoc phan cong';
    const message = 'Le tan da phan cong bac si va lich kham cho yeu cau cua ban.';

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'appointment_doctor_assigned',
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
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
