import {z} from "zod";

import {RuntimeTarget, TrustTier} from "../types.js";

export const actionRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export type ActionRisk = z.infer<typeof actionRiskSchema>;

export const actionModeSchema = z.enum(["execute", "dry_run"]);
export type ActionMode = z.infer<typeof actionModeSchema>;

export const actionStatusSchema = z.enum(["dry_run", "queued", "running", "succeeded", "failed", "rejected"]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export interface ActionDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  title: string;
  description: string;
  bridgeCommand: string;
  inputSchema: TInput;
  requiredCapabilities: string[];
  minimumTrustTier: TrustTier;
  risk: ActionRisk;
  reversibleBy?: string;
}

export interface ActionExecutionRecord {
  executionId: string;
  requestId: string;
  idempotencyKey: string;
  workspaceId: string;
  sessionId: string;
  actionId: string;
  actionTitle: string;
  bridgeCommand: string;
  status: ActionStatus;
  mode: ActionMode;
  risk: ActionRisk;
  trustTier: TrustTier;
  runtimeTarget: RuntimeTarget;
  requiredCapabilities: string[];
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export const driverDeliverySchema = z.enum(["final", "queued"]);
export type DriverDelivery = z.infer<typeof driverDeliverySchema>;

export interface ActionDriverRequest {
  executionId: string;
  workspaceId: string;
  sessionId: string;
  actionId: string;
  bridgeCommand: string;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ActionDriverResult {
  accepted: boolean;
  delivery?: DriverDelivery;
  retryable?: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ActionDriver {
  name: string;
  execute(request: ActionDriverRequest): Promise<ActionDriverResult>;
}
