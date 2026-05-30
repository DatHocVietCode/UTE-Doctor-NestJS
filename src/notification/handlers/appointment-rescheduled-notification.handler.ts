import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from 'src/common/redis/redis.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import type { AppointmentRescheduledNotificationDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class AppointmentRescheduledNotificationHandler
  implements NotificationHandler<AppointmentRescheduledNotificationDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(payload: AppointmentRescheduledNotificationDto, meta: NotificationHandlerMeta): Promise<void> {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.newTimeSlotId,
    );

    // Format epoch ms as a readable VN datetime string for the notification body.
    const newDateStr = new Date(payload.newScheduledAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const title = 'Lịch hẹn đã được dời lịch';
    const message = `Lịch hẹn của bạn đã được dời sang ${newDateStr}${timeSlotName ? ` - ${timeSlotName}` : ''}${payload.hospitalName ? ` tại ${payload.hospitalName}` : ''}.`;

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'appointment_rescheduled',
        appointmentId: payload.appointmentId,
        doctorName: payload.doctorName,
        hospitalName: payload.hospitalName,
        oldScheduledAt: payload.oldScheduledAt,
        newScheduledAt: payload.newScheduledAt,
        reason: payload.reason,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      // Duplicate idempotency key — already processed.
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'APPOINTMENT_RESCHEDULED',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
