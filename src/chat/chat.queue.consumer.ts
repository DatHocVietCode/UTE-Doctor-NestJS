import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import {
  CHAT_MESSAGE_CREATED_DEAD_LETTER_QUEUE,
  CHAT_MESSAGE_CREATED_QUEUE,
  ChatMessageCreatedEvent,
} from './chat-queue.constants';
import { ChatService } from './chat.service';

@Injectable()
export class ChatQueueConsumer implements OnModuleInit {
  private readonly logger = new Logger(ChatQueueConsumer.name);

  constructor(
    private readonly rabbitMqService: RabbitMqService,
    private readonly chatService: ChatService,
  ) {}

  async onModuleInit(): Promise<void> {
    const attached = await this.rabbitMqService.consume(
      CHAT_MESSAGE_CREATED_QUEUE,
      async (_message, payload: ChatMessageCreatedEvent) => {
        await this.handleMessageCreated(payload);
      },
    );

    if (!attached) {
      this.logger.warn('RabbitMQ consumer was not attached; queue integration is disabled.');
    }
  }

  private async handleMessageCreated(payload: ChatMessageCreatedEvent): Promise<void> {
    if (!this.chatService.isWorkerWriteMode()) {
      // In dual mode we only validate queue plumbing and preserve current monolith write path.
      this.logger.debug(`Queue event received in dual mode: ${payload.clientMessageId ?? payload.messageId ?? 'no-id'}`);
      return;
    }

    const maxRetry = Number(process.env.CHAT_QUEUE_MAX_RETRY ?? 3);

    try {
      await this.chatService.processMessageCreatedEvent(payload);
    } catch (error) {
      const retryCount = (payload.retryCount ?? 0) + 1;
      if (retryCount <= maxRetry) {
        await this.rabbitMqService.publish(CHAT_MESSAGE_CREATED_QUEUE, {
          ...payload,
          retryCount,
        });
        this.logger.warn(
          `Retrying queued chat message (${retryCount}/${maxRetry}): ${(error as Error).message}`,
        );
        return;
      }

      await this.rabbitMqService.publish(CHAT_MESSAGE_CREATED_DEAD_LETTER_QUEUE, {
        ...payload,
        retryCount,
        failedAt: new Date().toISOString(),
        error: (error as Error).message,
      });
      this.logger.error(`Moved chat message to DLQ after ${maxRetry} retries: ${(error as Error).message}`);
    }
  }
}
