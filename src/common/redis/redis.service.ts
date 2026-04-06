import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

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
      }
    } catch (error) {
      this.logger.warn(`Redis lock release failed for ${lockKey}: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis shutdown failed: ${(error as Error).message}`);
    }
  }
}