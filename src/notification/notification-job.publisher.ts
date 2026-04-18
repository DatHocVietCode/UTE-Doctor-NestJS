import { Injectable, Logger } from '@nestjs/common';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import type { NotificationPayload } from './dto/notification-payload.dto';
import { NOTIFICATION_JOBS_QUEUE, NOTIFICATION_JOBS_QUEUE_OPTIONS } from './notification.constants';

@Injectable()
export class NotificationJobPublisher {
  private readonly logger = new Logger(NotificationJobPublisher.name);

  constructor(private readonly rabbitMqService: RabbitMqService) {}

  async publish(payload: NotificationPayload): Promise<void> {
    const published = await this.rabbitMqService.publishWithQueueOptions(
      NOTIFICATION_JOBS_QUEUE,
      payload,
      NOTIFICATION_JOBS_QUEUE_OPTIONS,
    );
    if (!published) {
      this.logger.warn(
        `[NotificationJobPublisher] Failed to publish job ${payload.type} for ${payload.recipientEmail}`,
      );
    }
  }
}
