import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly pubClient: Redis;
  private readonly subClient: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    const db = Number(process.env.REDIS_DB || 0);
    const password = process.env.REDIS_PASSWORD?.trim();

    this.client = new Redis({
      host,
      port,
      db,
      ...(password ? { password } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis client error: ${(error as Error).message}`);
    });

    this.pubClient = new Redis({
      host,
      port,
      db,
      ...(password ? { password } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    this.subClient = new Redis({
      host,
      port,
      db,
      ...(password ? { password } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    this.pubClient.on('error', (error) => {
      this.logger.warn(`Redis pub client error: ${(error as Error).message}`);
    });

    this.subClient.on('error', (error) => {
      this.logger.warn(`Redis sub client error: ${(error as Error).message}`);
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    try {
      await this.pubClient.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(`Redis publish failed on ${channel}: ${(error as Error).message}`);
    }
  }

  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    try {
      await this.subClient.subscribe(channel);
      this.subClient.on('message', (receivedChannel, raw) => {
        if (receivedChannel !== channel) {
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          handler(parsed);
        } catch {
          handler(raw);
        }
      });
    } catch (error) {
      this.logger.warn(`Redis subscribe failed on ${channel}: ${(error as Error).message}`);
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    try {
      await this.subClient.unsubscribe(channel);
    } catch (error) {
      this.logger.warn(`Redis unsubscribe failed on ${channel}: ${(error as Error).message}`);
    }
  }

  async acquireSlotLock(lockKey: string, lockValue: string, ttlSeconds = 300): Promise<boolean> {
    try {
      const result = await this.client.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
      console.log("SET RESULT:", result, "KEY:", lockKey);
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Redis lock acquisition failed for ${lockKey}: ${(error as Error).message}`);
      return false;
    }
  }

  async releaseSlotLock(lockKey: string, lockValue: string): Promise<void> {
    try {
      const currentValue = await this.client.get(lockKey);
      if (currentValue === lockValue) {
        await this.client.del(lockKey);
        console.log(`Lock released for ${lockKey}`);
      }
    } catch (error) {
      this.logger.warn(`Redis lock release failed for ${lockKey}: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
      await this.pubClient.quit();
      await this.subClient.quit();
    } catch (error) {
      this.logger.warn(`Redis shutdown failed: ${(error as Error).message}`);
    }
  }
}