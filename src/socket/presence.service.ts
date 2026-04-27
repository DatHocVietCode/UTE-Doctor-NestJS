import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly presenceTtlSeconds = Number(process.env.SOCKET_PRESENCE_TTL_SECONDS || 60);

  constructor(private readonly redisService: RedisService) {}

  async addConnection(userId: string, socketId: string): Promise<void> {
    if (!userId || !socketId) {
      return;
    }

    const redis = this.redisService.getClient();
    const deviceKey = this.getDeviceKey(userId);

    // Track every live socket for the same user so multi-device sessions stay visible across instances.
    await redis.sadd(deviceKey, socketId);
    await redis.expire(deviceKey, this.presenceTtlSeconds);
    await redis.sadd('online_users', userId);
  }

  async removeConnection(userId: string, socketId: string): Promise<void> {
    if (!userId || !socketId) {
      return;
    }

    const redis = this.redisService.getClient();
    const deviceKey = this.getDeviceKey(userId);

    await redis.srem(deviceKey, socketId);

    const remainingConnections = await redis.scard(deviceKey);
    if (remainingConnections > 0) {
      return;
    }

    // The device set is the source of truth; the online_users index is only kept in sync while live sockets remain.
    await redis.del(deviceKey);
    await redis.srem('online_users', userId);
  }

  async refreshTTL(userId: string, socketId?: string, namespace?: string): Promise<void> {
    if (!userId) {
      return;
    }

    const redis = this.redisService.getClient();
    const deviceKey = this.getDeviceKey(userId);

    // Heartbeat diagnostics: refresh TTL and immediately scan related Redis state for troubleshooting.
    const expireResult = await redis.expire(deviceKey, this.presenceTtlSeconds);
    const [ttlAfterRefresh, connectionCount, inOnlineUsersSet, socketIds] = await Promise.all([
      redis.ttl(deviceKey),
      redis.scard(deviceKey),
      redis.sismember('online_users', userId),
      redis.smembers(deviceKey),
    ]);

    this.logger.log(
      `[Presence][HEARTBEAT] namespace=${namespace || 'n/a'} socketId=${socketId || 'n/a'} userId=${userId} expireResult=${expireResult} ttl=${ttlAfterRefresh} connections=${connectionCount} inOnlineUsers=${Boolean(inOnlineUsersSet)} socketIds=[${socketIds.join(',')}]`,
    );

    if (!expireResult) {
      this.logger.warn(
        `[Presence][HEARTBEAT] Device key missing while refreshing TTL userId=${userId} key=${deviceKey}`,
      );
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const redis = this.redisService.getClient();
    return (await redis.scard(this.getDeviceKey(userId))) > 0;
  }

  private getDeviceKey(userId: string): string {
    return `user:${userId}:devices`;
  }
}