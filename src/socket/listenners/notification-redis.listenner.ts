import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { NotificationPayload } from 'src/notification/dto/notification-payload.dto';
import { NOTIFICATION_REDIS_CHANNEL } from 'src/notification/notification.constants';
import { NotificationGateway } from '../namespace/notification/notification.gateway';

@Injectable()
export class NotificationRedisListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRedisListener.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // Subscribe once and forward all typed notification envelopes using one socket event.
    await this.redisService.subscribe(NOTIFICATION_REDIS_CHANNEL, async (payload: NotificationPayload) => {
      if (!payload?.recipientEmail) {
        return;
      }

      this.notificationGateway.emitToRoom(
        payload.recipientEmail,
        SocketEventsEnum.NOTIFICATION_RECEIVED,
        payload,
      );
      this.logger.debug(
        `[NotificationRedis] Pushed ${payload.type} to room ${payload.recipientEmail}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisService.unsubscribe(NOTIFICATION_REDIS_CHANNEL);
  }
}
