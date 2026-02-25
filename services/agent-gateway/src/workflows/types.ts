import {ActionMode, ActionRisk, ActionStatus} from "../actions/types.js";
import {TrustTier} from "../types.js";

export type WorkflowStatus = "queued" | "running" | "succeeded" | "failed" | "partial";

export interface WorkflowStepTemplate {
  id: string;
  actionId: string;
  mode: ActionMode;
  haltOnError: boolean;
  inputTemplate: Record<string, unknown>;
  metadataTemplate?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  minimumTrustTier: TrustTier;
  risk: ActionRisk;
  steps: WorkflowStepTemplate[];
}

export interface WorkflowStepResult {
  stepId: string;
  actionId: string;
  status: ActionStatus | "failed";
  executionId?: string;
  idempotentReplay?: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface WorkflowExecutionRecord {
  workflowExecutionId: string;
  workflowId: string;
  workflowTitle: string;
  requestId: string;
  workspaceId: string;
  sessionId: string;
  status: WorkflowStatus;
  steps: WorkflowStepResult[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
