import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import type { NotificationPayload } from './dto/notification-payload.dto';
import {
    NOTIFICATION_JOBS_DLQ,
    NOTIFICATION_JOBS_DLX_EXCHANGE,
    NOTIFICATION_JOBS_EXCHANGE,
    NOTIFICATION_JOBS_QUEUE,
    NOTIFICATION_JOBS_QUEUE_OPTIONS,
    NOTIFICATION_MAX_RETRY,
} from './notification.constants';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationQueueConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationQueueConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTopology();

    const attached = await this.rabbitMqService.consumeWithQueueOptions(
      NOTIFICATION_JOBS_QUEUE,
      NOTIFICATION_JOBS_QUEUE_OPTIONS,
      async (_message, payload: NotificationPayload) => {
        await this.handleNotification(payload);
      },
      20,
    );

    if (!attached) {
      this.logger.warn('Notification queue consumer was not attached.');
    }
  }

  private async ensureTopology(): Promise<void> {
    await this.rabbitMqService.assertExchange(NOTIFICATION_JOBS_DLX_EXCHANGE, 'direct', {
      durable: true,
    });
    await this.rabbitMqService.assertQueue(NOTIFICATION_JOBS_DLQ, { durable: true });
    await this.rabbitMqService.bindQueue(
      NOTIFICATION_JOBS_DLQ,
      NOTIFICATION_JOBS_DLX_EXCHANGE,
      NOTIFICATION_JOBS_DLQ,
    );

    await this.rabbitMqService.assertExchange(NOTIFICATION_JOBS_EXCHANGE, 'direct', {
      durable: true,
    });
    await this.rabbitMqService.assertQueue(NOTIFICATION_JOBS_QUEUE, NOTIFICATION_JOBS_QUEUE_OPTIONS);
    await this.rabbitMqService.bindQueue(
      NOTIFICATION_JOBS_QUEUE,
      NOTIFICATION_JOBS_EXCHANGE,
      NOTIFICATION_JOBS_QUEUE,
    );
  }

  private async handleNotification(payload: NotificationPayload): Promise<void> {
    try {
      await this.notificationService.process(payload);
    } catch (error) {
      const retryCount = (payload.retryCount ?? 0) + 1;

      if (retryCount < NOTIFICATION_MAX_RETRY) {
        const retriedPayload: NotificationPayload = {
          ...payload,
          retryCount,
        };

        await this.rabbitMqService.publishWithQueueOptions(
          NOTIFICATION_JOBS_QUEUE,
          retriedPayload,
          NOTIFICATION_JOBS_QUEUE_OPTIONS,
        );
        return;
      }

      await this.rabbitMqService.publishToExchange(
        NOTIFICATION_JOBS_DLX_EXCHANGE,
        NOTIFICATION_JOBS_DLQ,
        {
          ...payload,
          retryCount,
          failedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        },
      );

      this.logger.error(
        `[NotificationQueueConsumer] Notification moved to DLQ. type=${payload.type}, idempotencyKey=${payload.idempotencyKey}`,
      );
    }
  }
}
