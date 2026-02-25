import type {Redis as RedisClient} from "ioredis";

import {WorkflowDispatchPayload, WorkflowQueueStore} from "../workflows/WorkflowQueueStore.js";

interface TimedEntry<T> {
  value: T;
  expiresAtMs: number;
}

function buildPayloadKey(prefix: string, workflowExecutionId: string): string {
  return `${prefix}:payload:${workflowExecutionId}`;
}

function buildLockKey(prefix: string, workflowExecutionId: string): string {
  return `${prefix}:lock:${workflowExecutionId}`;
}

export class InMemoryWorkflowQueueStore implements WorkflowQueueStore {
  private readonly queue: string[] = [];
  private readonly payloads = new Map<string, TimedEntry<WorkflowDispatchPayload>>();
  private readonly locks = new Map<string, TimedEntry<true>>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => this.purgeExpired(), 5000);
    this.purgeInterval.unref?.();
  }

  public async enqueue(job: WorkflowDispatchPayload, ttlSeconds: number): Promise<boolean> {
    if (this.getPayload(job.workflowExecutionId)) return false;

    this.payloads.set(job.workflowExecutionId, {
      value: job,
      expiresAtMs: Date.now() + ttlSeconds * 1000
    });
    this.queue.push(job.workflowExecutionId);

    return true;
  }

  public async dequeueBatch(limit: number): Promise<WorkflowDispatchPayload[]> {
    const jobs: WorkflowDispatchPayload[] = [];
    const max = Math.max(1, limit);

    while (jobs.length < max) {
      const workflowExecutionId = this.queue.shift();

      if (!workflowExecutionId) break;

      const payload = this.getPayload(workflowExecutionId);

      if (!payload) continue;

      jobs.push(payload);
    }

    return jobs;
  }

  public async requeue(workflowExecutionId: string): Promise<boolean> {
    const payload = this.getPayload(workflowExecutionId);

    if (!payload) return false;

    this.queue.push(workflowExecutionId);
    return true;
  }

  public async claim(workflowExecutionId: string, lockSeconds: number): Promise<boolean> {
    const lock = this.locks.get(workflowExecutionId);

    if (lock && lock.expiresAtMs > Date.now()) return false;

    this.locks.set(workflowExecutionId, {
      value: true,
      expiresAtMs: Date.now() + lockSeconds * 1000
    });

    return true;
  }

  public async release(workflowExecutionId: string): Promise<void> {
    this.locks.delete(workflowExecutionId);
  }

  public async deletePayload(workflowExecutionId: string): Promise<void> {
    this.payloads.delete(workflowExecutionId);
    this.locks.delete(workflowExecutionId);
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }

  private getPayload(workflowExecutionId: string): WorkflowDispatchPayload | null {
    const payload = this.payloads.get(workflowExecutionId);

    if (!payload) return null;
    if (payload.expiresAtMs <= Date.now()) {
      this.payloads.delete(workflowExecutionId);
      return null;
    }

    return payload.value;
  }

  private purgeExpired(): void {
    const now = Date.now();

    for (const [workflowExecutionId, payload] of this.payloads.entries()) {
      if (payload.expiresAtMs <= now) this.payloads.delete(workflowExecutionId);
    }

    for (const [workflowExecutionId, lock] of this.locks.entries()) {
      if (lock.expiresAtMs <= now) this.locks.delete(workflowExecutionId);
    }
  }
}

export class RedisWorkflowQueueStore implements WorkflowQueueStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly queueKey: string
  ) {}

  public async enqueue(job: WorkflowDispatchPayload, ttlSeconds: number): Promise<boolean> {
    const payloadKey = buildPayloadKey(this.queueKey, job.workflowExecutionId);
    const payload = JSON.stringify(job);
    const payloadCreated = await this.redis.set(payloadKey, payload, "EX", ttlSeconds, "NX");

    if (payloadCreated !== "OK") return false;

    await this.redis.rpush(this.queueKey, job.workflowExecutionId);
    return true;
  }

  public async dequeueBatch(limit: number): Promise<WorkflowDispatchPayload[]> {
    const jobs: WorkflowDispatchPayload[] = [];
    const max = Math.max(1, limit);

    for (let index = 0; index < max; index += 1) {
      const workflowExecutionId = await this.redis.lpop(this.queueKey);

      if (!workflowExecutionId) break;

      const payloadRaw = await this.redis.get(buildPayloadKey(this.queueKey, workflowExecutionId));

      if (!payloadRaw) continue;

      try {
        const payload = JSON.parse(payloadRaw) as WorkflowDispatchPayload;

        if (!payload?.workflowExecutionId || !payload?.workspaceId || !payload?.session?.sessionId) {
          continue;
        }

        jobs.push(payload);
      } catch {
        continue;
      }
    }

    return jobs;
  }

  public async requeue(workflowExecutionId: string): Promise<boolean> {
    const payloadKey = buildPayloadKey(this.queueKey, workflowExecutionId);
    const payloadExists = await this.redis.exists(payloadKey);

    if (!payloadExists) return false;

    await this.redis.rpush(this.queueKey, workflowExecutionId);
    return true;
  }

  public async claim(workflowExecutionId: string, lockSeconds: number): Promise<boolean> {
    const lockKey = buildLockKey(this.queueKey, workflowExecutionId);
    const claimed = await this.redis.set(lockKey, "1", "EX", lockSeconds, "NX");

    return claimed === "OK";
  }

  public async release(workflowExecutionId: string): Promise<void> {
    await this.redis.del(buildLockKey(this.queueKey, workflowExecutionId));
  }

  public async deletePayload(workflowExecutionId: string): Promise<void> {
    await this.redis
      .multi()
      .del(buildPayloadKey(this.queueKey, workflowExecutionId))
      .del(buildLockKey(this.queueKey, workflowExecutionId))
      .exec();
  }

  public async close(): Promise<void> {}
}
