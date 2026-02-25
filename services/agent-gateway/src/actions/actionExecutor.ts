import {randomUUID} from "node:crypto";

import {AppConfig} from "../config.js";
import {ActionExecutionStore} from "../stores/ActionExecutionStore.js";
import {ActionRateLimitStore} from "../stores/ActionRateLimitStore.js";
import {SessionRecord, TrustTier} from "../types.js";
import {AuditService} from "../utils/audit.js";
import {ACTION_CATALOG_LIST, getActionDefinition} from "./catalog.js";
import {ActionDriver, ActionExecutionRecord, ActionMode, ActionStatus, DriverDelivery} from "./types.js";

const TRUST_TIER_RANKING: Record<TrustTier, number> = {
  external: 1,
  partner: 2,
  internal: 3
};

const TERMINAL_STATUSES = new Set<ActionStatus>(["dry_run", "succeeded", "failed", "rejected"]);

const REPORTABLE_STATUS_SET = new Set<ActionStatus>(["running", "queued", "succeeded", "failed", "rejected"]);

const STATUS_TRANSITIONS: Record<ActionStatus, ReadonlySet<ActionStatus>> = {
  dry_run: new Set<ActionStatus>(),
  queued: new Set<ActionStatus>(["queued", "running", "succeeded", "failed", "rejected"]),
  running: new Set<ActionStatus>(["running", "succeeded", "failed", "rejected"]),
  succeeded: new Set<ActionStatus>(["succeeded"]),
  failed: new Set<ActionStatus>(["failed"]),
  rejected: new Set<ActionStatus>(["rejected"])
};

export interface ActionExecutionInput {
  requestId: string;
  workspaceId: string;
  session: SessionRecord;
  idempotencyKey: string;
  actionId: string;
  input: Record<string, unknown>;
  mode: ActionMode;
  metadata: Record<string, unknown>;
}

export interface ActionExecutionReportInput {
  requestId: string;
  workspaceId: string;
  executionId: string;
  status: ActionStatus;
  result?: Record<string, unknown>;
  error?: string;
}

export type ActionExecutionResponse =
  | {ok: true; record: ActionExecutionRecord; idempotentReplay: boolean}
  | {ok: false; statusCode: number; error: string; details?: Record<string, unknown>};

export type ActionReportResponse =
  | {ok: true; record: ActionExecutionRecord; idempotentReplay: boolean}
  | {ok: false; statusCode: number; error: string; details?: Record<string, unknown>};

interface DriverAttemptResult {
  accepted: boolean;
  delivery: DriverDelivery;
  retryable: boolean;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  durationMs: number;
}

export class ActionExecutor {
  constructor(
    private readonly config: AppConfig,
    private readonly driver: ActionDriver,
    private readonly store: ActionExecutionStore,
    private readonly rateLimitStore: ActionRateLimitStore,
    private readonly audit: AuditService
  ) {}

  public listActions() {
    return ACTION_CATALOG_LIST.map(action => ({
      id: action.id,
      title: action.title,
      description: action.description,
      bridge_command: action.bridgeCommand,
      required_capabilities: action.requiredCapabilities,
      minimum_trust_tier: action.minimumTrustTier,
      risk: action.risk,
      reversible_by: action.reversibleBy
    }));
  }

  public async getExecution(executionId: string): Promise<ActionExecutionRecord | null> {
    return this.store.get(executionId);
  }

  public async execute(input: ActionExecutionInput): Promise<ActionExecutionResponse> {
    const action = getActionDefinition(input.actionId);

    if (!action) {
      return {ok: false, statusCode: 404, error: "action_not_found"};
    }

    const parsedActionInput = action.inputSchema.safeParse(input.input);

    if (!parsedActionInput.success) {
      return {
        ok: false,
        statusCode: 400,
        error: "invalid_action_input",
        details: parsedActionInput.error.flatten()
      };
    }

    const now = Date.now();
    const sessionExpiresAt = Date.parse(input.session.expiresAt);

    if (Number.isFinite(sessionExpiresAt) && sessionExpiresAt <= now) {
      return {ok: false, statusCode: 401, error: "session_expired"};
    }

    if (input.session.endedAt) {
      return {ok: false, statusCode: 409, error: "session_ended"};
    }

    const missingCapabilities = action.requiredCapabilities.filter(capability => !input.session.capabilities.includes(capability));

    if (missingCapabilities.length) {
      return {
        ok: false,
        statusCode: 403,
        error: "missing_action_capabilities",
        details: {missing_capabilities: missingCapabilities}
      };
    }

    if (TRUST_TIER_RANKING[input.session.trustTier] < TRUST_TIER_RANKING[action.minimumTrustTier]) {
      return {
        ok: false,
        statusCode: 403,
        error: "insufficient_trust_tier",
        details: {
          current_trust_tier: input.session.trustTier,
          required_trust_tier: action.minimumTrustTier
        }
      };
    }

    const rateLimitDecision = await this.rateLimitStore.consume(input.session.sessionId, this.config.actionSessionRateLimitPerMinute);

    if (!rateLimitDecision.allowed) {
      return {
        ok: false,
        statusCode: 429,
        error: "action_rate_limit_exceeded",
        details: {
          count: rateLimitDecision.count,
          max_allowed: rateLimitDecision.maxAllowed,
          window_start: rateLimitDecision.windowStart
        }
      };
    }

    if (this.config.actionRequireApprovalForHighRisk && (action.risk === "high" || action.risk === "critical")) {
      const hasApproval = input.metadata.approved_by_human === true || input.metadata.approval_ticket !== undefined;

      if (!hasApproval && input.mode !== "dry_run") {
        return {
          ok: false,
          statusCode: 409,
          error: "human_approval_required",
          details: {
            action_id: action.id,
            risk: action.risk
          }
        };
      }
    }

    const normalizedInput = parsedActionInput.data as Record<string, unknown>;
    const idempotencyScope = this.buildIdempotencyScope(input.workspaceId, input.session.sessionId, action.id, input.idempotencyKey);
    const existing = await this.store.getByIdempotency(idempotencyScope);

    if (existing) {
      return {
        ok: true,
        record: existing,
        idempotentReplay: true
      };
    }

    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + this.config.actionExecutionTtlSeconds * 1000).toISOString();
    const executionId = randomUUID();
    const baseRecord: ActionExecutionRecord = {
      executionId,
      requestId: input.requestId,
      idempotencyKey: idempotencyScope,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      actionId: action.id,
      actionTitle: action.title,
      bridgeCommand: action.bridgeCommand,
      status: "queued",
      mode: input.mode,
      risk: action.risk,
      trustTier: input.session.trustTier,
      runtimeTarget: input.session.runtimeTarget,
      requiredCapabilities: action.requiredCapabilities,
      input: normalizedInput,
      metadata: input.metadata,
      result: null,
      error: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: expiresAtIso
    };

    if (input.mode === "dry_run") {
      const dryRunRecord = this.withStatus(baseRecord, "dry_run", {
        driver: this.driver.name,
        simulated: true
      });

      await this.store.create(dryRunRecord, this.config.actionExecutionTtlSeconds);
      this.auditExecution(input.session, input.workspaceId, input.requestId, dryRunRecord, true);

      return {
        ok: true,
        record: dryRunRecord,
        idempotentReplay: false
      };
    }

    await this.store.create(baseRecord, this.config.actionExecutionTtlSeconds);

    const runningRecord = this.withStatus(baseRecord, "running");
    await this.store.update(runningRecord, this.config.actionExecutionTtlSeconds);

    const driverResult = await this.executeWithResilience({
      executionId,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      actionId: action.id,
      bridgeCommand: action.bridgeCommand,
      input: normalizedInput,
      metadata: input.metadata
    });

    const enrichedResult = {
      driver: this.driver.name,
      attempts: driverResult.attempts,
      duration_ms: driverResult.durationMs,
      ...(driverResult.result ?? {})
    };

    const finalRecord = driverResult.accepted
      ? this.withStatus(runningRecord, driverResult.delivery === "queued" ? "queued" : "succeeded", enrichedResult)
      : this.withStatus(
          runningRecord,
          "failed",
          {
            ...enrichedResult,
            retryable: driverResult.retryable
          },
          driverResult.error ?? "action_driver_failed"
        );

    await this.store.update(finalRecord, this.config.actionExecutionTtlSeconds);
    this.auditExecution(input.session, input.workspaceId, input.requestId, finalRecord, driverResult.accepted);

    return {
      ok: true,
      record: finalRecord,
      idempotentReplay: false
    };
  }

  public async reportExecution(input: ActionExecutionReportInput): Promise<ActionReportResponse> {
    if (!REPORTABLE_STATUS_SET.has(input.status)) {
      return {
        ok: false,
        statusCode: 400,
        error: "invalid_report_status"
      };
    }

    const existing = await this.store.get(input.executionId);

    if (!existing) {
      return {ok: false, statusCode: 404, error: "execution_not_found"};
    }

    if (existing.workspaceId !== input.workspaceId) {
      return {ok: false, statusCode: 403, error: "workspace_mismatch"};
    }

    if (existing.mode === "dry_run") {
      return {ok: false, statusCode: 409, error: "dry_run_execution_immutable"};
    }

    const allowedTransitions = STATUS_TRANSITIONS[existing.status];

    if (!allowedTransitions.has(input.status)) {
      return {
        ok: false,
        statusCode: 409,
        error: "invalid_status_transition",
        details: {
          current_status: existing.status,
          requested_status: input.status
        }
      };
    }

    if (TERMINAL_STATUSES.has(existing.status) && existing.status === input.status) {
      return {
        ok: true,
        record: existing,
        idempotentReplay: true
      };
    }

    if ((input.status === "failed" || input.status === "rejected") && (!input.error || !input.error.trim().length)) {
      return {
        ok: false,
        statusCode: 400,
        error: "report_error_required_for_failure"
      };
    }

    const updated = this.withStatus(
      existing,
      input.status,
      input.result ?? existing.result ?? null,
      input.status === "failed" || input.status === "rejected" ? input.error ?? "execution_reported_failure" : null
    );

    await this.store.update(updated, this.config.actionExecutionTtlSeconds);
    this.audit.emit({
      event: "action.report",
      at: new Date().toISOString(),
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      sessionId: updated.sessionId,
      allowed: true,
      details: {
        execution_id: updated.executionId,
        action_id: updated.actionId,
        from_status: existing.status,
        to_status: input.status
      }
    });

    return {
      ok: true,
      record: updated,
      idempotentReplay: false
    };
  }

  private buildIdempotencyScope(workspaceId: string, sessionId: string, actionId: string, idempotencyKey: string): string {
    return `${workspaceId}:${sessionId}:${actionId}:${idempotencyKey}`;
  }

  private withStatus(
    record: ActionExecutionRecord,
    status: ActionStatus,
    result: Record<string, unknown> | null = record.result ?? null,
    error: string | null = null
  ): ActionExecutionRecord {
    return {
      ...record,
      status,
      result,
      error,
      updatedAt: new Date().toISOString()
    };
  }

  private async executeWithResilience(
    request: Parameters<ActionDriver["execute"]>[0]
  ): Promise<DriverAttemptResult> {
    const startedAt = Date.now();
    let attempts = 0;
    let lastResult: Omit<DriverAttemptResult, "attempts" | "durationMs"> = {
      accepted: false,
      delivery: "final",
      retryable: false,
      error: "action_driver_failed"
    };

    while (attempts <= this.config.actionExecutionMaxRetries) {
      attempts++;
      const result = await this.executeSingleAttempt(request);
      lastResult = result;

      if (result.accepted) {
        return {
          ...result,
          attempts,
          durationMs: Date.now() - startedAt
        };
      }

      if (!result.retryable || attempts > this.config.actionExecutionMaxRetries) {
        break;
      }

      const delayMs = this.config.actionExecutionRetryBackoffMs * 2 ** (attempts - 1);
      const jitter = Math.floor(Math.random() * Math.max(25, this.config.actionExecutionRetryBackoffMs));

      await sleep(delayMs + jitter);
    }

    return {
      ...lastResult,
      attempts,
      durationMs: Date.now() - startedAt
    };
  }

  private async executeSingleAttempt(
    request: Parameters<ActionDriver["execute"]>[0]
  ): Promise<Omit<DriverAttemptResult, "attempts" | "durationMs">> {
    try {
      const result = await withTimeout(
        this.driver.execute(request),
        this.config.actionExecutionTimeoutMs,
        "action_driver_timeout"
      );

      return {
        accepted: result.accepted,
        delivery: result.delivery ?? "final",
        retryable: result.retryable ?? false,
        result: result.result,
        error: result.error
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "action_driver_failed";

      return {
        accepted: false,
        delivery: "final",
        retryable: message === "action_driver_timeout",
        error: message
      };
    }
  }

  private auditExecution(
    session: SessionRecord,
    workspaceId: string,
    requestId: string,
    record: ActionExecutionRecord,
    allowed: boolean
  ): void {
    this.audit.emit({
      event: "action.execute",
      at: new Date().toISOString(),
      requestId,
      workspaceId,
      sessionId: session.sessionId,
      agentId: session.agent.id,
      agentName: session.agent.name,
      runtimeTarget: session.runtimeTarget,
      trustTier: session.trustTier,
      allowed,
      reason: allowed ? undefined : record.error ?? undefined,
      details: {
        execution_id: record.executionId,
        action_id: record.actionId,
        risk: record.risk,
        status: record.status,
        mode: record.mode,
        idempotency_key: record.idempotencyKey
      }
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
