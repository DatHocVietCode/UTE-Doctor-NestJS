import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  Channel,
  Connection,
  ConsumeMessage,
  Options,
  connect,
  type Replies,
} from 'amqplib';

type ConsumeHandler = (message: ConsumeMessage, parsedPayload: any) => Promise<void>;

@Injectable()
export class RabbitMqService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private connectingPromise: Promise<void> | null = null;

  private readonly url = process.env.RABBITMQ_URL?.trim();
  private readonly enabled = process.env.RABBITMQ_ENABLED !== 'false';

  private async ensureConnected(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    if (!this.url) {
      this.logger.warn('RABBITMQ_URL is missing, RabbitMQ integration is disabled.');
      return false;
    }

    if (this.channel) {
      return true;
    }

    if (this.connectingPromise) {
      await this.connectingPromise;
      return !!this.channel;
    }

    this.connectingPromise = (async () => {
      try {
        this.connection = await connect(this.url);
        this.channel = await this.connection.createChannel();
        this.logger.log('RabbitMQ channel established');

        this.connection.on('error', (error) => {
          this.logger.warn(`RabbitMQ connection error: ${(error as Error).message}`);
        });

        this.connection.on('close', () => {
          this.logger.warn('RabbitMQ connection closed, channel reset');
          this.channel = null;
          this.connection = null;
        });
      } catch (error) {
        this.logger.warn(`RabbitMQ connect failed: ${(error as Error).message}`);
        this.channel = null;
        this.connection = null;
      } finally {
        this.connectingPromise = null;
      }
    })();

    await this.connectingPromise;
    return !!this.channel;
  }

  async publish(queueName: string, payload: unknown, options?: Options.Publish): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    await this.channel.assertQueue(queueName, { durable: true });
    const buffer = Buffer.from(JSON.stringify(payload));
    return this.channel.sendToQueue(queueName, buffer, {
      persistent: true,
      contentType: 'application/json',
      ...options,
    });
  }

  async publishWithQueueOptions(
    queueName: string,
    payload: unknown,
    queueOptions: Options.AssertQueue,
    options?: Options.Publish,
  ): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    await this.channel.assertQueue(queueName, queueOptions);
    const buffer = Buffer.from(JSON.stringify(payload));
    return this.channel.sendToQueue(queueName, buffer, {
      persistent: true,
      contentType: 'application/json',
      ...options,
    });
  }

  async publishToExchange(
    exchangeName: string,
    routingKey: string,
    payload: unknown,
    options?: Options.Publish,
  ): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    await this.channel.assertExchange(exchangeName, 'direct', { durable: true });
    const buffer = Buffer.from(JSON.stringify(payload));
    return this.channel.publish(exchangeName, routingKey, buffer, {
      persistent: true,
      contentType: 'application/json',
      ...options,
    });
  }

  async assertQueue(queueName: string, options?: Options.AssertQueue): Promise<Replies.AssertQueue | null> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return null;
    }

    try {
      return await this.channel.assertQueue(queueName, options);
    } catch (error) {
      this.logger.warn(`RabbitMQ assertQueue failed for ${queueName}: ${(error as Error).message}`);
      return null;
    }
  }

  async checkQueue(queueName: string): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    try {
      await this.channel.checkQueue(queueName);
      return true;
    } catch (error) {
      this.logger.warn(`RabbitMQ checkQueue failed for ${queueName}: ${(error as Error).message}`);
      return false;
    }
  }

  async assertExchange(
    exchangeName: string,
    type: 'direct' | 'fanout' | 'topic' | 'headers',
    options?: Options.AssertExchange,
  ): Promise<Replies.AssertExchange | null> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return null;
    }

    try {
      return await this.channel.assertExchange(exchangeName, type, options);
    } catch (error) {
      this.logger.warn(`RabbitMQ assertExchange failed for ${exchangeName}: ${(error as Error).message}`);
      return null;
    }
  }

  async bindQueue(
    queueName: string,
    exchangeName: string,
    routingKey = '',
    args?: unknown,
  ): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    try {
      await this.channel.bindQueue(queueName, exchangeName, routingKey, args);
      return true;
    } catch (error) {
      this.logger.warn(
        `RabbitMQ bindQueue failed for ${queueName} -> ${exchangeName}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async consume(queueName: string, handler: ConsumeHandler, prefetch = 20): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    await this.channel.assertQueue(queueName, { durable: true });
    await this.channel.prefetch(prefetch);

    await this.channel.consume(queueName, async (message) => {
      if (!message || !this.channel) {
        return;
      }

      try {
        const parsed = JSON.parse(message.content.toString('utf-8'));
        await handler(message, parsed);
        this.channel.ack(message);
      } catch (error) {
        this.logger.warn(`RabbitMQ consume handler failed for ${queueName}: ${(error as Error).message}`);
        this.channel.nack(message, false, false);
      }
    });

    this.logger.log(`RabbitMQ consumer attached to queue: ${queueName}`);
    return true;
  }

  async consumeWithQueueOptions(
    queueName: string,
    queueOptions: Options.AssertQueue,
    handler: ConsumeHandler,
    prefetch = 20,
  ): Promise<boolean> {
    const ready = await this.ensureConnected();
    if (!ready || !this.channel) {
      return false;
    }

    await this.channel.assertQueue(queueName, queueOptions);
    await this.channel.prefetch(prefetch);

    await this.channel.consume(queueName, async (message) => {
      if (!message || !this.channel) {
        return;
      }

      try {
        const parsed = JSON.parse(message.content.toString('utf-8'));
        await handler(message, parsed);
        this.channel.ack(message);
      } catch (error) {
        this.logger.warn(`RabbitMQ consume handler failed for ${queueName}: ${(error as Error).message}`);
        this.channel.nack(message, false, false);
      }
    });

    this.logger.log(`RabbitMQ consumer attached to queue: ${queueName}`);
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      await this.channel.close().catch(() => undefined);
    }
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
    }
  }
}
