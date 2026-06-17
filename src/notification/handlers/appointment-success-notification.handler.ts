import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import { RedisService } from 'src/common/redis/redis.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import { toStoredNotificationPayload } from '../notification-payload.mapper';
import { buildAppointmentSuccessNotification } from '../notification-template.helper';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class AppointmentSuccessNotificationHandler
  implements NotificationHandler<AppointmentEnriched>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(
    payload: AppointmentEnriched,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.timeSlot?.toString?.() || '',
    );

    const { title, message, titleKey, messageKey, data } =
      buildAppointmentSuccessNotification(
        payload,
        meta.recipientRole,
        timeSlotName,
      );

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      type: 'APPOINTMENT_SUCCESS',
      title,
      message,
      titleKey,
      messageKey,
      data,
      details: {
        type: 'appointment_success',
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
