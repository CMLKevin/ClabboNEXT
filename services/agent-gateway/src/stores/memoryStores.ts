import {SessionRecord} from "../types.js";
import {ReplayStore} from "./ReplayStore.js";
import {SessionStore} from "./SessionStore.js";

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryTimedMap<T> {
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

  public update(key: string, value: T): void {
    const existing = this.map.get(key);

    if (!existing) return;
    if (existing.expiresAt <= Date.now()) {
      this.map.delete(key);

      return;
    }

    this.map.set(key, {...existing, value});
  }

  public has(key: string): boolean {
    return this.get(key) !== null;
  }

  public delete(key: string): void {
    this.map.delete(key);
  }

  public purge(): void {
    const now = Date.now();

    for (const [key, value] of this.map.entries()) if (value.expiresAt <= now) this.map.delete(key);
  }
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly entries = new InMemoryTimedMap<true>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => this.entries.purge(), 5000);
    this.purgeInterval.unref?.();
  }

  public async markIfNew(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.entries.has(key)) return false;

    this.entries.set(key, true, ttlSeconds);

    return true;
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly entries = new InMemoryTimedMap<SessionRecord>();
  private readonly purgeInterval: NodeJS.Timeout;

  constructor() {
    this.purgeInterval = setInterval(() => this.entries.purge(), 5000);
    this.purgeInterval.unref?.();
  }

  public async create(session: SessionRecord, ttlSeconds: number): Promise<void> {
    this.entries.set(session.sessionId, session, ttlSeconds);
  }

  public async get(sessionId: string): Promise<SessionRecord | null> {
    return this.entries.get(sessionId);
  }

  public async end(sessionId: string, endedAt: string): Promise<SessionRecord | null> {
    const existing = this.entries.get(sessionId);

    if (!existing) return null;
    if (existing.endedAt) return existing;

    const updated: SessionRecord = {
      ...existing,
      endedAt
    };

    this.entries.update(sessionId, updated);

    return updated;
  }

  public async close(): Promise<void> {
    clearInterval(this.purgeInterval);
  }
}
