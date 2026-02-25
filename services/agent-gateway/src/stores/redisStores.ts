import type {Redis as RedisClient} from "ioredis";

import {SessionRecord} from "../types.js";
import {ReplayStore} from "./ReplayStore.js";
import {SessionStore} from "./SessionStore.js";

export class RedisReplayStore implements ReplayStore {
  constructor(private readonly redis: RedisClient) {}

  public async markIfNew(key: string, ttlSeconds: number): Promise<boolean> {
    const response = await this.redis.set(`clabo:replay:${key}`, "1", "EX", ttlSeconds, "NX");

    return response === "OK";
  }

  public async close(): Promise<void> {}
}

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: RedisClient) {}

  public async create(session: SessionRecord, ttlSeconds: number): Promise<void> {
    await this.redis.set(`clabo:session:${session.sessionId}`, JSON.stringify(session), "EX", ttlSeconds);
  }

  public async get(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(`clabo:session:${sessionId}`);

    if (!raw) return null;

    return this.parseSession(raw);
  }

  public async end(sessionId: string, endedAt: string): Promise<SessionRecord | null> {
    const key = `clabo:session:${sessionId}`;
    const raw = await this.redis.get(key);

    if (!raw) return null;

    const existing = this.parseSession(raw);

    if (!existing) return null;

    if (existing.endedAt) return existing;

    const updated: SessionRecord = {
      ...existing,
      endedAt
    };

    const ttl = await this.redis.ttl(key);

    if (ttl > 0) await this.redis.set(key, JSON.stringify(updated), "EX", ttl);
    else await this.redis.set(key, JSON.stringify(updated));

    return updated;
  }

  public async close(): Promise<void> {}

  private parseSession(raw: string): SessionRecord | null {
    try {
      const parsed = JSON.parse(raw) as SessionRecord;

      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.sessionId || !parsed.workspaceId) return null;

      return parsed;
    } catch {
      return null;
    }
  }
}
