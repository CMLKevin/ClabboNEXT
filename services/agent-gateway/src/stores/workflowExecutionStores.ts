import type {Redis as RedisClient} from "ioredis";

import {WorkflowExecutionStore} from "./WorkflowExecutionStore.js";
import {WorkflowExecutionRecord} from "../workflows/types.js";

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryWorkflowMap<T> {
  private readonly map = new Map<string, TimedEntry<T>>();

  public set(key: string, value: T, ttlSeconds: number): void {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public get(key: string): T | null {
    const entry = this.map.get(key);

    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }

    return entry.value;
  }

  public purgeExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }
}

export class InMemoryWorkflowExecutionStore implements WorkflowExecutionStore {
  private readonly entries = new InMemoryWorkflowMap<WorkflowExecutionRecord>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => this.entries.purgeExpired(), 5000);
    this.purgeInterval.unref?.();
  }

  public async create(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void> {
    this.entries.set(record.workflowExecutionId, record, ttlSeconds);
  }

  public async update(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void> {
    this.entries.set(record.workflowExecutionId, record, ttlSeconds);
  }

  public async get(workflowExecutionId: string): Promise<WorkflowExecutionRecord | null> {
    return this.entries.get(workflowExecutionId);
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }
}

export class RedisWorkflowExecutionStore implements WorkflowExecutionStore {
  constructor(private readonly redis: RedisClient) {}

  public async create(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void> {
    await this.persist(record, ttlSeconds);
  }

  public async update(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void> {
    await this.persist(record, ttlSeconds);
  }

  public async get(workflowExecutionId: string): Promise<WorkflowExecutionRecord | null> {
    const raw = await this.redis.get(`clabo:workflow:execution:${workflowExecutionId}`);

    if (!raw) return null;

    return this.parse(raw);
  }

  public async close(): Promise<void> {}

  private async persist(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void> {
    const key = `clabo:workflow:execution:${record.workflowExecutionId}`;
    await this.redis.set(key, JSON.stringify(record), "EX", ttlSeconds);
  }

  private parse(raw: string): WorkflowExecutionRecord | null {
    try {
      const parsed = JSON.parse(raw) as WorkflowExecutionRecord;

      if (!parsed?.workflowExecutionId || !parsed?.workspaceId || !parsed?.sessionId) return null;

      return parsed;
    } catch {
      return null;
    }
  }
}
