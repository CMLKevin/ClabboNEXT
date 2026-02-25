import type {Redis as RedisClient} from "ioredis";

import {ActionRateLimitDecision, ActionRateLimitStore} from "./ActionRateLimitStore.js";

interface TimedCounter {
  count: number;
  expiresAt: number;
}

export class InMemoryActionRateLimitStore implements ActionRateLimitStore {
  private readonly counters = new Map<string, TimedCounter>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => this.purge(), 5000);
    this.purgeInterval.unref?.();
  }

  public async consume(sessionId: string, maxPerMinute: number): Promise<ActionRateLimitDecision> {
    const bucket = this.getBucket();
    const now = Date.now();
    const key = `${sessionId}:${bucket.id}`;
    const existing = this.counters.get(key);
    const counter = existing && existing.expiresAt > now ? existing : {count: 0, expiresAt: bucket.expiresAt};
    const nextCount = counter.count + 1;

    this.counters.set(key, {
      count: nextCount,
      expiresAt: bucket.expiresAt
    });

    return {
      allowed: nextCount <= maxPerMinute,
      count: nextCount,
      maxAllowed: maxPerMinute,
      windowStart: bucket.windowStartIso
    };
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }

  private getBucket() {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const windowStart = minute * 60000;

    return {
      id: minute,
      expiresAt: windowStart + 120000,
      windowStartIso: new Date(windowStart).toISOString()
    };
  }

  private purge(): void {
    const now = Date.now();

    for (const [key, entry] of this.counters.entries()) {
      if (entry.expiresAt <= now) this.counters.delete(key);
    }
  }
}

export class RedisActionRateLimitStore implements ActionRateLimitStore {
  constructor(private readonly redis: RedisClient) {}

  public async consume(sessionId: string, maxPerMinute: number): Promise<ActionRateLimitDecision> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const windowStart = minute * 60000;
    const key = `clabo:action:ratelimit:${sessionId}:${minute}`;

    const count = await this.redis
      .multi()
      .incr(key)
      .expire(key, 120, "NX")
      .exec()
      .then(reply => {
        const entry = reply?.[0]?.[1];

        return typeof entry === "number" ? entry : Number(entry ?? 0);
      });

    return {
      allowed: count <= maxPerMinute,
      count,
      maxAllowed: maxPerMinute,
      windowStart: new Date(windowStart).toISOString()
    };
  }

  public async close(): Promise<void> {}
}
