import {randomUUID} from "node:crypto";

import {ActionExecutor} from "../actions/actionExecutor.js";
import {getActionDefinition} from "../actions/catalog.js";
import {ActionMode} from "../actions/types.js";
import {AppConfig} from "../config.js";
import {WorkflowExecutionStore} from "../stores/WorkflowExecutionStore.js";
import {SessionRecord, TrustTier} from "../types.js";
import {AuditService} from "../utils/audit.js";
import {estimateMaxSynchronousWorkflowSteps, estimateWorstCaseWorkflowDurationMs} from "../utils/executionBudget.js";
import {getWorkflowDefinition, WORKFLOW_CATALOG_LIST} from "./catalog.js";
import {renderTemplate} from "./template.js";
import {WorkflowDefinition, WorkflowExecutionRecord, WorkflowStatus, WorkflowStepResult} from "./types.js";

const TRUST_TIER_RANKING: Record<TrustTier, number> = {
  external: 1,
  partner: 2,
  internal: 3
};

const MAX_INLINE_WORKFLOW_STEPS = 100;

export interface WorkflowInlineStep {
  id: string;
  actionId: string;
  mode: ActionMode;
  haltOnError: boolean;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface WorkflowExecutionInput {
  requestId: string;
  workspaceId: string;
  session: SessionRecord;
  workflowId?: string;
  inlineWorkflowTitle?: string;
  inlineSteps?: WorkflowInlineStep[];
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface WorkflowDispatchedExecutionInput extends WorkflowExecutionInput {
  workflowExecutionId: string;
}

export type WorkflowExecutionResponse =
  | {ok: true; record: WorkflowExecutionRecord}
  | {ok: false; statusCode: number; error: string; details?: Record<string, unknown>};

export class WorkflowExecutor {
  constructor(
    private readonly config: AppConfig,
    private readonly actionExecutor: ActionExecutor,
    private readonly store: WorkflowExecutionStore,
    private readonly audit: AuditService
  ) {}

  public listWorkflows() {
    return WORKFLOW_CATALOG_LIST.map(workflow => ({
      id: workflow.id,
      title: workflow.title,
      description: workflow.description,
      minimum_trust_tier: workflow.minimumTrustTier,
      risk: workflow.risk,
      required_capabilities: workflow.requiredCapabilities,
      step_count: workflow.steps.length
    }));
  }

  public async getExecution(workflowExecutionId: string): Promise<WorkflowExecutionRecord | null> {
    return this.store.get(workflowExecutionId);
  }

  public async execute(input: WorkflowExecutionInput): Promise<WorkflowExecutionResponse> {
    const workflow = this.resolveWorkflow(input);

    if (!workflow.ok) {
      return workflow;
    }

    const estimatedDurationMs = estimateWorstCaseWorkflowDurationMs(this.config, workflow.definition.steps.length);

    if (estimatedDurationMs > this.config.requestExecutionBudgetMs) {
      return {
        ok: false,
        statusCode: 409,
        error: "workflow_exceeds_execution_budget",
        details: {
          workflow_id: workflow.definition.id,
          step_count: workflow.definition.steps.length,
          estimated_duration_ms: estimatedDurationMs,
          max_budget_ms: this.config.requestExecutionBudgetMs,
          suggested_max_steps: estimateMaxSynchronousWorkflowSteps(this.config)
        }
      };
    }

    const authDecision = this.authorizeWorkflow(input.session, workflow.definition);

    if (!authDecision.ok) return authDecision;

    const record = this.createExecutionRecord(randomUUID(), input, workflow.definition);
    await this.store.create(record, this.config.workflowExecutionTtlSeconds);

    return this.runWorkflow(record, input, workflow.definition);
  }

  public async dispatch(input: WorkflowExecutionInput): Promise<WorkflowExecutionResponse> {
    const workflow = this.resolveWorkflow(input);

    if (!workflow.ok) return workflow;

    const authDecision = this.authorizeWorkflow(input.session, workflow.definition);

    if (!authDecision.ok) return authDecision;

    const record = this.createExecutionRecord(randomUUID(), input, workflow.definition);
    await this.store.create(record, this.config.workflowExecutionTtlSeconds);

    return {
      ok: true,
      record
    };
  }

  public async processDispatched(input: WorkflowDispatchedExecutionInput): Promise<WorkflowExecutionResponse> {
    const workflow = this.resolveWorkflow(input);

    if (!workflow.ok) {
      await this.persistDispatchError(input, workflow.error, workflow.details);
      return workflow;
    }

    const authDecision = this.authorizeWorkflow(input.session, workflow.definition);

    if (!authDecision.ok) {
      await this.persistDispatchError(input, authDecision.error, authDecision.details);
      return authDecision;
    }

    const existing = await this.store.get(input.workflowExecutionId);

    if (existing && (existing.status === "succeeded" || existing.status === "failed" || existing.status === "partial")) {
      return {
        ok: true,
        record: existing
      };
    }

    const record = existing ?? this.createExecutionRecord(input.workflowExecutionId, input, workflow.definition);

    if (!existing) {
      await this.store.create(record, this.config.workflowExecutionTtlSeconds);
    }

    return this.runWorkflow(record, input, workflow.definition);
  }

  private createExecutionRecord(
    workflowExecutionId: string,
    input: WorkflowExecutionInput,
    definition: WorkflowDefinition
  ): WorkflowExecutionRecord {
    const nowIso = new Date().toISOString();

    return {
      workflowExecutionId,
      workflowId: definition.id,
      workflowTitle: definition.title,
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      status: "queued",
      steps: [],
      metadata: input.metadata,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(Date.now() + this.config.workflowExecutionTtlSeconds * 1000).toISOString()
    };
  }

  private resolveWorkflow(
    input: WorkflowExecutionInput
  ):
    | {ok: true; definition: WorkflowDefinition}
    | {ok: false; statusCode: number; error: string; details?: Record<string, unknown>} {
    if (input.workflowId) {
      const workflow = getWorkflowDefinition(input.workflowId);

      if (!workflow) {
        return {ok: false, statusCode: 404, error: "workflow_not_found"};
      }

      return {ok: true, definition: workflow};
    }

    if (!input.inlineSteps?.length) {
      return {
        ok: false,
        statusCode: 400,
        error: "workflow_or_steps_required"
      };
    }

    if (input.inlineSteps.length > MAX_INLINE_WORKFLOW_STEPS) {
      return {
        ok: false,
        statusCode: 400,
        error: "inline_workflow_step_limit_exceeded",
        details: {
          max_steps: MAX_INLINE_WORKFLOW_STEPS
        }
      };
    }

    const requiredCapabilities = new Set<string>();

    for (const step of input.inlineSteps) {
      const action = getActionDefinition(step.actionId);

      if (!action) {
        return {
          ok: false,
          statusCode: 400,
          error: "inline_workflow_unknown_action",
          details: {
            action_id: step.actionId,
            step_id: step.id
          }
        };
      }

      for (const capability of action.requiredCapabilities) requiredCapabilities.add(capability);
    }

    return {
      ok: true,
      definition: {
        id: `inline.${input.requestId}`,
        title: input.inlineWorkflowTitle?.trim().length ? input.inlineWorkflowTitle.trim() : "Inline Workflow",
        description: "Dynamically provided workflow",
        requiredCapabilities: [...requiredCapabilities],
        minimumTrustTier: "external",
        risk: "medium",
        steps: input.inlineSteps.map(step => ({
          id: step.id,
          actionId: step.actionId,
          mode: step.mode,
          haltOnError: step.haltOnError,
          inputTemplate: step.input,
          metadataTemplate: step.metadata
        }))
      }
    };
  }

  private authorizeWorkflow(
    session: SessionRecord,
    definition: WorkflowDefinition
  ):
    | {ok: true}
    | {ok: false; statusCode: number; error: string; details?: Record<string, unknown>} {
    const missingCapabilities = definition.requiredCapabilities.filter(cap => !session.capabilities.includes(cap));

    if (missingCapabilities.length) {
      return {
        ok: false,
        statusCode: 403,
        error: "missing_workflow_capabilities",
        details: {
          missing_capabilities: missingCapabilities
        }
      };
    }

    if (TRUST_TIER_RANKING[session.trustTier] < TRUST_TIER_RANKING[definition.minimumTrustTier]) {
      return {
        ok: false,
        statusCode: 403,
        error: "insufficient_trust_tier",
        details: {
          current_trust_tier: session.trustTier,
          required_trust_tier: definition.minimumTrustTier
        }
      };
    }

    return {ok: true};
  }

  private async runWorkflow(
    initialRecord: WorkflowExecutionRecord,
    input: WorkflowExecutionInput,
    definition: WorkflowDefinition
  ): Promise<WorkflowExecutionResponse> {
    let currentRecord = this.withStatus(initialRecord, "running");
    await this.store.update(currentRecord, this.config.workflowExecutionTtlSeconds);

    const stepResultsById = new Map<string, WorkflowStepResult>();
    let haltedByFailure = false;

    for (const step of currentRecord.steps) {
      stepResultsById.set(step.stepId, step);
    }

    for (const [index, step] of definition.steps.entries()) {
      if (stepResultsById.has(step.id)) continue;

      const renderedInput = renderTemplate(step.inputTemplate, {
        payload: input.payload,
        session: input.session,
        workflow: definition,
        metadata: input.metadata,
        step_results: Object.fromEntries(stepResultsById.entries())
      });
      const renderedMetadata = renderTemplate(step.metadataTemplate ?? {}, {
        payload: input.payload,
        session: input.session,
        workflow: definition,
        metadata: input.metadata,
        step_results: Object.fromEntries(stepResultsById.entries())
      });

      const actionResponse = await this.actionExecutor.execute({
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        session: input.session,
        idempotencyKey: `${initialRecord.workflowExecutionId}:${step.id}:${index + 1}`,
        actionId: step.actionId,
        input: renderedInput as Record<string, unknown>,
        mode: step.mode,
        metadata: renderedMetadata as Record<string, unknown>
      });

      if (!actionResponse.ok) {
        const failedStep: WorkflowStepResult = {
          stepId: step.id,
          actionId: step.actionId,
          status: "failed",
          error: actionResponse.error,
          details: actionResponse.details
        };

        stepResultsById.set(step.id, failedStep);
        currentRecord = this.withStep(currentRecord, failedStep);
        await this.store.update(currentRecord, this.config.workflowExecutionTtlSeconds);

        if (step.haltOnError) {
          haltedByFailure = true;
          break;
        }

        continue;
      }

      const succeededStep: WorkflowStepResult = {
        stepId: step.id,
        actionId: step.actionId,
        status: actionResponse.record.status,
        executionId: actionResponse.record.executionId,
        idempotentReplay: actionResponse.idempotentReplay
      };

      stepResultsById.set(step.id, succeededStep);
      currentRecord = this.withStep(currentRecord, succeededStep);
      await this.store.update(currentRecord, this.config.workflowExecutionTtlSeconds);

      if ((succeededStep.status === "failed" || succeededStep.status === "rejected") && step.haltOnError) {
        haltedByFailure = true;
        break;
      }
    }

    const failedSteps = currentRecord.steps.filter(step => step.status === "failed" || step.status === "rejected");
    let finalStatus: WorkflowStatus = "succeeded";

    if (failedSteps.length && haltedByFailure) finalStatus = "failed";
    else if (failedSteps.length) finalStatus = "partial";

    currentRecord = this.withStatus(currentRecord, finalStatus);
    await this.store.update(currentRecord, this.config.workflowExecutionTtlSeconds);

    this.audit.emit({
      event: "workflow.execute",
      at: new Date().toISOString(),
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      agentId: input.session.agent.id,
      agentName: input.session.agent.name,
      runtimeTarget: input.session.runtimeTarget,
      trustTier: input.session.trustTier,
      allowed: finalStatus !== "failed",
      reason: finalStatus === "failed" ? "workflow_halted" : undefined,
      details: {
        workflow_execution_id: currentRecord.workflowExecutionId,
        workflow_id: currentRecord.workflowId,
        status: currentRecord.status,
        step_count: currentRecord.steps.length,
        failed_steps: failedSteps.map(step => step.stepId)
      }
    });

    return {
      ok: true,
      record: currentRecord
    };
  }

  private async persistDispatchError(
    input: WorkflowDispatchedExecutionInput,
    error: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.store.get(input.workflowExecutionId);

    if (existing) {
      const failedRecord = this.withStatus(existing, "failed");
      await this.store.update(failedRecord, this.config.workflowExecutionTtlSeconds);
      return;
    }

    const nowIso = new Date().toISOString();
    const failedRecord: WorkflowExecutionRecord = {
      workflowExecutionId: input.workflowExecutionId,
      workflowId: input.workflowId ?? `inline.${input.requestId}`,
      workflowTitle: input.inlineWorkflowTitle?.trim().length ? input.inlineWorkflowTitle.trim() : "Dispatched Workflow",
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      status: "failed",
      steps: [
        {
          stepId: "dispatch",
          actionId: "workflow.dispatch",
          status: "failed",
          error,
          details
        }
      ],
      metadata: input.metadata,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(Date.now() + this.config.workflowExecutionTtlSeconds * 1000).toISOString()
    };

    await this.store.create(failedRecord, this.config.workflowExecutionTtlSeconds);
  }

  private withStatus(record: WorkflowExecutionRecord, status: WorkflowStatus): WorkflowExecutionRecord {
    return {
      ...record,
      status,
      updatedAt: new Date().toISOString()
    };
  }

  private withStep(record: WorkflowExecutionRecord, step: WorkflowStepResult): WorkflowExecutionRecord {
    return {
      ...record,
      steps: [...record.steps, step],
      updatedAt: new Date().toISOString()
    };
  }
}
