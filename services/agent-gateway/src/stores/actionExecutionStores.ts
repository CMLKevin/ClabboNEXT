import type {Redis as RedisClient} from "ioredis";

import {ActionExecutionRecord} from "../actions/types.js";
import {ActionExecutionStore} from "./ActionExecutionStore.js";

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryExecutionMap<T> {
  private readonly map = new Map<string, TimedEntry<T>>();

  public set(key: string, value: T, ttlSeconds: number): void {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public get(key: string): T | null {
    const existing = this.map.get(key);

    if (!existing) return null;
    if (existing.expiresAt <= Date.now()) {
      this.map.delete(key);

      return null;
    }

    return existing.value;
  }

  public purgeExpired(): void {
    const now = Date.now();

    for (const [key, value] of this.map.entries()) {
      if (value.expiresAt <= now) this.map.delete(key);
    }
  }
}

export class InMemoryActionExecutionStore implements ActionExecutionStore {
  private readonly byExecutionId = new InMemoryExecutionMap<ActionExecutionRecord>();
  private readonly byIdempotency = new InMemoryExecutionMap<string>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => {
      this.byExecutionId.purgeExpired();
      this.byIdempotency.purgeExpired();
    }, 5000);
    this.purgeInterval.unref?.();
  }

  public async create(record: ActionExecutionRecord, ttlSeconds: number): Promise<void> {
    this.byExecutionId.set(record.executionId, record, ttlSeconds);
    this.byIdempotency.set(record.idempotencyKey, record.executionId, ttlSeconds);
  }

  public async update(record: ActionExecutionRecord, ttlSeconds: number): Promise<void> {
    this.byExecutionId.set(record.executionId, record, ttlSeconds);
    this.byIdempotency.set(record.idempotencyKey, record.executionId, ttlSeconds);
  }

  public async get(executionId: string): Promise<ActionExecutionRecord | null> {
    return this.byExecutionId.get(executionId);
  }

  public async getByIdempotency(idempotencyScope: string): Promise<ActionExecutionRecord | null> {
    const executionId = this.byIdempotency.get(idempotencyScope);

    if (!executionId) return null;

    return this.byExecutionId.get(executionId);
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }
}

export class RedisActionExecutionStore implements ActionExecutionStore {
  constructor(private readonly redis: RedisClient) {}

  public async create(record: ActionExecutionRecord, ttlSeconds: number): Promise<void> {
    await this.persist(record, ttlSeconds);
  }

  public async update(record: ActionExecutionRecord, ttlSeconds: number): Promise<void> {
    await this.persist(record, ttlSeconds);
  }

  public async get(executionId: string): Promise<ActionExecutionRecord | null> {
    const raw = await this.redis.get(`clabo:action:execution:${executionId}`);

    if (!raw) return null;

    return this.parseRecord(raw);
  }

  public async getByIdempotency(idempotencyScope: string): Promise<ActionExecutionRecord | null> {
    const executionId = await this.redis.get(`clabo:action:idempotency:${idempotencyScope}`);

    if (!executionId) return null;

    return this.get(executionId);
  }

  public async close(): Promise<void> {}

  private async persist(record: ActionExecutionRecord, ttlSeconds: number): Promise<void> {
    const payload = JSON.stringify(record);
    const executionKey = `clabo:action:execution:${record.executionId}`;
    const idempotencyKey = `clabo:action:idempotency:${record.idempotencyKey}`;

    await this.redis
      .multi()
      .set(executionKey, payload, "EX", ttlSeconds)
      .set(idempotencyKey, record.executionId, "EX", ttlSeconds)
      .exec();
  }

  private parseRecord(raw: string): ActionExecutionRecord | null {
    try {
      const parsed = JSON.parse(raw) as ActionExecutionRecord;

      if (!parsed?.executionId || !parsed?.actionId || !parsed?.workspaceId) return null;

      return parsed;
    } catch {
      return null;
    }
  }
}
