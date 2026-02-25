import {WorkflowExecutionRecord} from "../workflows/types.js";

export interface WorkflowExecutionStore {
  create(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void>;
  update(record: WorkflowExecutionRecord, ttlSeconds: number): Promise<void>;
  get(workflowExecutionId: string): Promise<WorkflowExecutionRecord | null>;
  close(): Promise<void>;
}
