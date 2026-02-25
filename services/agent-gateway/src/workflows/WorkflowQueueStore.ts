import {SessionRecord} from "../types.js";

import type {WorkflowInlineStep} from "./workflowExecutor.js";

export interface WorkflowDispatchPayload {
  workflowExecutionId: string;
  requestId: string;
  workspaceId: string;
  session: SessionRecord;
  workflowId?: string;
  inlineWorkflowTitle?: string;
  inlineSteps?: WorkflowInlineStep[];
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enqueuedAt: string;
}

export interface WorkflowQueueStore {
  enqueue(job: WorkflowDispatchPayload, ttlSeconds: number): Promise<boolean>;
  dequeueBatch(limit: number): Promise<WorkflowDispatchPayload[]>;
  requeue(workflowExecutionId: string): Promise<boolean>;
  claim(workflowExecutionId: string, lockSeconds: number): Promise<boolean>;
  release(workflowExecutionId: string): Promise<void>;
  deletePayload(workflowExecutionId: string): Promise<void>;
  close(): Promise<void>;
}
