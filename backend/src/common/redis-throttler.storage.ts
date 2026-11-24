import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import IORedis from 'ioredis';

interface Record {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Atomic fixed-window counter with optional blocking, evaluated inside Redis.
const SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { tonumber(redis.call('GET', hitsKey) or limit + 1), redis.call('PTTL', hitsKey), 1, blockTtl }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local hitsTtl = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, 1, 'PX', blockDuration)
  return { hits, hitsTtl, 1, blockDuration }
end
return { hits, hitsTtl, 0, 0 }
`;

/** Shares rate-limit counters across API instances (falls back to in-memory storage without Redis). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private readonly client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    this.client.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<Record> {
    try {
      const prefix = `throttle:${throttlerName}:${key}`;
      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = (await this.client.eval(
        SCRIPT,
        2,
        `${prefix}:hits`,
        `${prefix}:block`,
        ttl,
        limit,
        blockDuration || ttl,
      )) as number[];
      return {
        totalHits,
        timeToExpire: Math.ceil(Math.max(timeToExpire, 0) / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(Math.max(timeToBlockExpire, 0) / 1000),
      };
    } catch (err) {
      // Fail open: rate limiting must not take the API down when Redis is unavailable.
      this.logger.warn(`Rate-limit storage unavailable: ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
