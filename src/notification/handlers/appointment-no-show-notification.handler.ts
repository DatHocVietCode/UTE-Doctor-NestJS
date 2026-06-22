import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from 'src/common/redis/redis.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import type { AppointmentNoShowDto } from '../dto/notification-payload.dto';
import { NotificationWriteService } from '../notification-write.service';
import { NOTIFICATION_REDIS_CHANNEL } from '../notification.constants';
import { toStoredNotificationPayload } from '../notification-payload.mapper';
import { buildAppointmentNoShowNotification } from '../notification-template.helper';
import type {
  NotificationHandler,
  NotificationHandlerMeta,
} from './notification-handler.interface';

@Injectable()
export class AppointmentNoShowNotificationHandler
  implements NotificationHandler<AppointmentNoShowDto>
{
  constructor(
    private readonly notificationWriteService: NotificationWriteService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(
    payload: AppointmentNoShowDto,
    meta: NotificationHandlerMeta,
  ): Promise<void> {
    const timeSlotName = payload.timeSlot
      ? await emitTyped<string, string>(
          this.eventEmitter,
          'timeslot.get.name.by.id',
          payload.timeSlot,
        )
      : undefined;

    const { title, message, titleKey, messageKey, data } =
      buildAppointmentNoShowNotification(payload, meta.recipientRole, timeSlotName);

    const created = await this.notificationWriteService.storeIfNotExists({
      idempotencyKey: meta.idempotencyKey,
      receiverEmail: [meta.recipientEmail],
      recipientEmail: meta.recipientEmail,
      recipientRole: meta.recipientRole,
      type: 'APPOINTMENT_NO_SHOW',
      title,
      message,
      titleKey,
      messageKey,
      data,
      details: {
        type: 'appointment_no_show',
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
