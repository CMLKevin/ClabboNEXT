import {ActionExecutionRecord} from "../actions/types.js";

export interface ActionExecutionStore {
  create(record: ActionExecutionRecord, ttlSeconds: number): Promise<void>;
  update(record: ActionExecutionRecord, ttlSeconds: number): Promise<void>;
  get(executionId: string): Promise<ActionExecutionRecord | null>;
  getByIdempotency(idempotencyScope: string): Promise<ActionExecutionRecord | null>;
  close(): Promise<void>;
}
