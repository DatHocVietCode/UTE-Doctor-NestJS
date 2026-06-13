import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import { RedisService } from 'src/common/redis/redis.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class AppointmentSuccessNotificationHandler implements NotificationHandler<AppointmentEnriched> {
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(payload: AppointmentEnriched, meta: NotificationHandlerMeta): Promise<void> {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.timeSlot?.toString?.() || '',
    );

    const title = 'Dat lich kham thanh cong';
    const message = `Ban da dat lich kham thanh cong vao ngay ${payload.date} luc ${timeSlotName} tai ${payload.hospitalName}.`;

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'appointment_success',
        appointmentId: payload._id,
        doctorName: payload.doctorName,
        serviceType: payload.serviceType,
        paymentMethod: payload.paymentMethod,
        amount: payload.amount,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'APPOINTMENT_SUCCESS',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
