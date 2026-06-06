import { Injectable, Logger } from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { RedisService } from 'src/common/redis/redis.service';

// Identity + role metadata captured from the authenticated socket (JWT) at connect/heartbeat.
export interface PresenceUserMeta {
  email?: string;
  role?: RoleEnum | string;
}

// A user of a given role currently considered online, resolved from Redis presence.
export interface OnlinePresenceUser {
  userId: string;
  email?: string;
  role: string;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly presenceTtlSeconds = Number(
    process.env.SOCKET_PRESENCE_TTL_SECONDS || 60,
  );
  private readonly onlineUsersKey = 'online_users';

  constructor(private readonly redisService: RedisService) {}

  async addConnection(
    userId: string,
    socketId: string,
    meta?: PresenceUserMeta,
  ): Promise<void> {
    if (!userId || !socketId) {
      return;
    }

    const redis = this.redisService.getClient();
    const deviceKey = this.getDeviceKey(userId);

    // Track every live socket for the same user so multi-device sessions stay visible across instances.
    await redis.sadd(deviceKey, socketId);
    await redis.expire(deviceKey, this.presenceTtlSeconds);
    await redis.sadd(this.onlineUsersKey, userId);

    // Role-aware index: a SET per role (deduped by userId) + a per-user metadata hash, so the
    // notification router can resolve online receptionists from Redis without a DB lookup.
    await this.indexRole(userId, meta);

    const connectionCount = await redis.scard(deviceKey);
    this.logger.log(
      `[Presence][ADD] userId=${userId} socketId=${socketId} role=${this.normalizeRole(meta?.role) || 'n/a'} connections=${connectionCount}`,
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

    // Drop the user from the role index using the role recorded in its metadata hash.
    const metaKey = this.getUserMetaKey(userId);
    const role = await redis.hget(metaKey, 'role');
    if (role) {
      await redis.srem(this.getRoleKey(role), userId);
    }
    await redis.del(metaKey);

    this.logger.log(
      `[Presence][REMOVE] userId=${userId} socketId=${socketId} role=${role || 'n/a'} remaining=0 (offline, cleaned online + role index)`,
    );
  }

  async refreshTTL(
    userId: string,
    socketId?: string,
    namespace?: string,
    meta?: PresenceUserMeta,
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
      // Recover/maintain the role index too (it may have expired alongside the device key).
      await this.indexRole(userId, meta);
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

  /**
   * Resolve the users of a role currently considered online. The role SET is a secondary
   * index; liveness is authoritatively the device set (TTL'd + heartbeat-recovered), so any
   * member without a live device set is pruned lazily here (self-heals crash leftovers).
   */
  async getOnlineUsersByRole(
    role: RoleEnum | string,
  ): Promise<OnlinePresenceUser[]> {
    const normalizedRole = this.normalizeRole(role);
    if (!normalizedRole) {
      return [];
    }

    const redis = this.redisService.getClient();
    const roleKey = this.getRoleKey(normalizedRole);
    const userIds = await redis.smembers(roleKey);

    const online: OnlinePresenceUser[] = [];
    for (const userId of userIds) {
      if (!(await this.isUserOnline(userId))) {
        // Stale role membership (e.g. crash with no clean disconnect) — prune lazily.
        await redis.srem(roleKey, userId);
        await redis.del(this.getUserMetaKey(userId));
        continue;
      }

      const meta = await redis.hgetall(this.getUserMetaKey(userId));
      online.push({
        userId,
        email: meta?.email,
        role: meta?.role || normalizedRole,
      });
    }

    return online;
  }

  /** Convenience accessor for the broad-booking assignment fan-out. */
  async getOnlineReceptionists(): Promise<OnlinePresenceUser[]> {
    return this.getOnlineUsersByRole(RoleEnum.RECEPTIONIST);
  }

  // Index a user into its role SET + write a per-user metadata hash (userId/email/role),
  // refreshing the hash TTL. No-op when no role is known. Idempotent across devices.
  private async indexRole(
    userId: string,
    meta?: PresenceUserMeta,
  ): Promise<void> {
    const role = this.normalizeRole(meta?.role);
    if (!role) {
      return;
    }

    const redis = this.redisService.getClient();
    const metaKey = this.getUserMetaKey(userId);
    const fields: Record<string, string> = { userId, role };
    const email = this.normalizeEmail(meta?.email);
    if (email) {
      fields.email = email;
    }

    await redis.sadd(this.getRoleKey(role), userId);
    await redis.hset(metaKey, fields);
    await redis.expire(metaKey, this.presenceTtlSeconds);
  }

  private normalizeRole(role?: RoleEnum | string): string {
    return role ? String(role).trim().toUpperCase() : '';
  }

  private normalizeEmail(email?: string): string {
    return email ? email.trim().toLowerCase() : '';
  }

  private getRoleKey(role: string): string {
    return `online_role:${this.normalizeRole(role)}`;
  }

  private getUserMetaKey(userId: string): string {
    return `presence:user:${userId}`;
  }

  private getDeviceKey(userId: string): string {
    return `user:${userId}:devices`;
  }
}
