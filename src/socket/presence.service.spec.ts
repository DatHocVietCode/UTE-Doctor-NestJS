/* eslint-disable @typescript-eslint/require-await -- FakeRedis intentionally mirrors the async ioredis surface with synchronous in-memory bodies */
import { PresenceService } from './presence.service';

const EXPECTED_TTL = Number(process.env.SOCKET_PRESENCE_TTL_SECONDS || 60);

/**
 * Minimal in-memory ioredis stand-in covering the set/hash/ttl commands PresenceService uses.
 * Empty sets/hashes auto-delete to mirror real Redis key semantics.
 */
class FakeRedis {
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();
  private ttls = new Map<string, number>();

  private keyExists(key: string): boolean {
    return this.sets.has(key) || this.hashes.has(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) added += 1;
      set.add(m);
    }
    this.sets.set(key, set);
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed += 1;
    }
    if (set.size === 0) {
      this.sets.delete(key);
      this.ttls.delete(key);
    }
    return removed;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async hset(
    key: string,
    field: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    if (typeof field === 'object') {
      for (const [k, v] of Object.entries(field)) hash.set(k, v);
    } else {
      hash.set(field, value as string);
    }
    this.hashes.set(key, hash);
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async del(key: string): Promise<number> {
    const existed = this.keyExists(key);
    this.sets.delete(key);
    this.hashes.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async expire(key: string, ttl: number): Promise<number> {
    if (!this.keyExists(key)) return 0;
    this.ttls.set(key, ttl);
    return 1;
  }

  async exists(key: string): Promise<number> {
    return this.keyExists(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    if (this.ttls.has(key)) return this.ttls.get(key) as number;
    return this.keyExists(key) ? -1 : -2;
  }

  // ---- test helpers (not part of the ioredis surface) ----
  setTtl(key: string, ttl: number): void {
    this.ttls.set(key, ttl);
  }

  simulateExpiry(key: string): void {
    this.sets.delete(key);
    this.hashes.delete(key);
    this.ttls.delete(key);
  }
}

describe('PresenceService', () => {
  let redis: FakeRedis;
  let service: PresenceService;

  const deviceKey = (userId: string) => `user:${userId}:devices`;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new PresenceService({ getClient: () => redis } as never);
  });

  it('addConnection creates the device set and the online index', async () => {
    await service.addConnection('u1', 's1');

    expect(await redis.smembers(deviceKey('u1'))).toEqual(['s1']);
    expect(await redis.sismember('online_users', 'u1')).toBe(1);
    expect(await redis.ttl(deviceKey('u1'))).toBe(EXPECTED_TTL);
    expect(await service.isUserOnline('u1')).toBe(true);
  });

  it('removeConnection keeps the user online while another device socket remains', async () => {
    await service.addConnection('u1', 's1');
    await service.addConnection('u1', 's2');

    await service.removeConnection('u1', 's1');

    expect(await redis.smembers(deviceKey('u1'))).toEqual(['s2']);
    expect(await service.isUserOnline('u1')).toBe(true);
    expect(await redis.sismember('online_users', 'u1')).toBe(1);
  });

  it('removeConnection clears the online index when the last device disconnects', async () => {
    await service.addConnection('u1', 's1');

    await service.removeConnection('u1', 's1');

    expect(await service.isUserOnline('u1')).toBe(false);
    expect(await redis.sismember('online_users', 'u1')).toBe(0);
    expect(await redis.exists(deviceKey('u1'))).toBe(0);
  });

  it('refreshTTL refreshes the device-set TTL when the key exists', async () => {
    await service.addConnection('u1', 's1');
    redis.setTtl(deviceKey('u1'), 3); // simulate TTL counting down

    await service.refreshTTL('u1', 's1', '/notification');

    expect(await redis.ttl(deviceKey('u1'))).toBe(EXPECTED_TTL);
    expect(await service.isUserOnline('u1')).toBe(true);
  });

  it('refreshTTL re-creates presence when the device key expired but the socket is still alive', async () => {
    await service.addConnection('u1', 's1');
    redis.simulateExpiry(deviceKey('u1')); // device key TTL lapsed while connected
    expect(await service.isUserOnline('u1')).toBe(false);

    await service.refreshTTL('u1', 's1', '/notification');

    expect(await redis.smembers(deviceKey('u1'))).toEqual(['s1']);
    expect(await redis.sismember('online_users', 'u1')).toBe(1);
    expect(await redis.ttl(deviceKey('u1'))).toBe(EXPECTED_TTL);
    expect(await service.isUserOnline('u1')).toBe(true);
  });

  it('isUserOnline reflects recovery and offline transitions', async () => {
    expect(await service.isUserOnline('u1')).toBe(false);

    await service.addConnection('u1', 's1');
    expect(await service.isUserOnline('u1')).toBe(true);

    redis.simulateExpiry(deviceKey('u1'));
    await service.refreshTTL('u1', 's1');
    expect(await service.isUserOnline('u1')).toBe(true);

    await service.removeConnection('u1', 's1');
    expect(await service.isUserOnline('u1')).toBe(false);
  });
});
