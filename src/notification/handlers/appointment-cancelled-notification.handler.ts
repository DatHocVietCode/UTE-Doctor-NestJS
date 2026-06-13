import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from 'src/common/redis/redis.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import type { AppointmentCancelledDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import type { NotificationHandler, NotificationHandlerMeta } from './notification-handler.interface';

@Injectable()
export class AppointmentCancelledNotificationHandler implements NotificationHandler<AppointmentCancelledDto> {
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(payload: AppointmentCancelledDto, meta: NotificationHandlerMeta): Promise<void> {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.timeSlot,
    );

    const title = 'Thong bao huy lich kham';
    const message = `Lich kham ngay ${payload.date} luc ${timeSlotName}${payload.hospitalName ? ` tai ${payload.hospitalName}` : ''}${payload.reason ? `. Ly do: ${payload.reason}` : ''}.`;

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      title,
      message,
      details: {
        type: 'appointment_cancelled',
        appointmentId: payload.appointmentId,
        date: payload.date,
        timeSlot: payload.timeSlot,
        timeSlotLabel: payload.timeSlotLabel,
        hospitalName: payload.hospitalName,
        reason: payload.reason,
        refundAmount: payload.refundAmount,
        shouldRefund: payload.shouldRefund,
      },
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.createdAt),
    });

    if (!created) {
      return;
    }

    await this.redisService.publish(NOTIFICATION_REDIS_CHANNEL, {
      type: 'APPOINTMENT_CANCELLED',
      data: payload,
      createdAt: meta.createdAt,
      recipientEmail: meta.recipientEmail,
      idempotencyKey: meta.idempotencyKey,
    });
  }
}
