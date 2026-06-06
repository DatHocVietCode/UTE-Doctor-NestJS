import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly presenceTtlSeconds = Number(
    process.env.SOCKET_PRESENCE_TTL_SECONDS || 60,
  );
  private readonly onlineUsersKey = 'online_users';

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
    await redis.sadd(this.onlineUsersKey, userId);

    const connectionCount = await redis.scard(deviceKey);
    this.logger.log(
      `[Presence][ADD] userId=${userId} socketId=${socketId} connections=${connectionCount}`,
    );
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
      // Multi-device: another socket of the same user is still alive, keep the user online.
      this.logger.log(
        `[Presence][REMOVE] userId=${userId} socketId=${socketId} remaining=${remainingConnections} (still online)`,
      );
      return;
    }

    // The device set is the source of truth; the online_users index is only kept in sync while live sockets remain.
    await redis.del(deviceKey);
    await redis.srem(this.onlineUsersKey, userId);
    this.logger.log(
      `[Presence][REMOVE] userId=${userId} socketId=${socketId} remaining=0 (offline, cleaned online index)`,
    );
  }

  async refreshTTL(
    userId: string,
    socketId?: string,
    namespace?: string,
  ): Promise<void> {
    if (!userId) {
      return;
    }

    const redis = this.redisService.getClient();
    const deviceKey = this.getDeviceKey(userId);

    // Recovery: if the device set expired (missed heartbeats / TTL lapse) while the socket
    // is still alive, recreate presence from the live socketId instead of leaving the user
    // stuck offline until they reconnect.
    const keyExisted = (await redis.exists(deviceKey)) === 1;
    let recovered = false;
    if (!keyExisted && socketId) {
      await redis.sadd(deviceKey, socketId);
      recovered = true;
    }

    const expireResult = await redis.expire(deviceKey, this.presenceTtlSeconds);

    // Keep the online index consistent with the device set (the source of truth): re-add
    // while at least one device remains, otherwise clean the stale online_users entry.
    const connectionCount = await redis.scard(deviceKey);
    if (connectionCount > 0) {
      await redis.sadd(this.onlineUsersKey, userId);
    } else {
      await redis.srem(this.onlineUsersKey, userId);
    }

    const [ttlAfterRefresh, inOnlineUsersSet, socketIds] = await Promise.all([
      redis.ttl(deviceKey),
      redis.sismember(this.onlineUsersKey, userId),
      redis.smembers(deviceKey),
    ]);

    if (recovered) {
      this.logger.warn(
        `[Presence][HEARTBEAT][RECOVER] Recreated expired device key userId=${userId} socketId=${socketId} namespace=${namespace || 'n/a'}`,
      );
    }

    this.logger.log(
      `[Presence][HEARTBEAT] namespace=${namespace || 'n/a'} socketId=${socketId || 'n/a'} userId=${userId} recovered=${recovered} expireResult=${expireResult} ttl=${ttlAfterRefresh} connections=${connectionCount} inOnlineUsers=${Boolean(inOnlineUsersSet)} socketIds=[${socketIds.join(',')}]`,
    );

    if (!keyExisted && !socketId) {
      this.logger.warn(
        `[Presence][HEARTBEAT] Device key missing and no socketId to recover userId=${userId} key=${deviceKey}`,
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
