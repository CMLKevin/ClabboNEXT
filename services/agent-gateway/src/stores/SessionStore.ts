import {SessionRecord} from "../types.js";

export interface SessionStore {
  create(session: SessionRecord, ttlSeconds: number): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  end(sessionId: string, endedAt: string): Promise<SessionRecord | null>;
  close(): Promise<void>;
}
