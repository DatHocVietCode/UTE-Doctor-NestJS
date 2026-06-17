import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { NOTIFICATION_REDIS_CHANNEL } from 'src/notification/notification.constants';
import type { StoredNotificationPayload } from 'src/notification/notification-payload.mapper';
import { NotificationGateway } from '../namespace/notification/notification.gateway';

@Injectable()
export class NotificationRedisListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationRedisListener.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // Subscribe once and forward all typed notification envelopes using one socket event.
    await this.redisService.subscribe(NOTIFICATION_REDIS_CHANNEL, (payload) => {
      const notification = payload as StoredNotificationPayload;
      if (!notification?.recipientEmail) {
        return;
      }

      this.notificationGateway.emitToRoom(
        notification.recipientEmail,
        SocketEventsEnum.NOTIFICATION_RECEIVED,
        notification,
      );
      this.logger.debug(
        `[NotificationRedis] Pushed ${notification.type} to room ${notification.recipientEmail}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisService.unsubscribe(NOTIFICATION_REDIS_CHANNEL);
  }
}
