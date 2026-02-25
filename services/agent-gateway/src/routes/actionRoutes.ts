import {timingSafeEqual} from "node:crypto";

import {FastifyInstance, FastifyRequest} from "fastify";
import {z} from "zod";

import {actionModeSchema, actionStatusSchema} from "../actions/types.js";
import {AppContext} from "../context.js";
import {getHeader, getInternalServiceKeyHeader, getRequestIdHeader, getWorkspaceIdHeader} from "../utils/request.js";
import {estimateMaxSynchronousActions, estimateWorstCaseBatchDurationMs} from "../utils/executionBudget.js";

const workspaceIdSchema = z.string().trim().min(1).max(128);

const executeBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  session_id: z.string().uuid(),
  action_id: z.string().trim().min(1).max(128),
  mode: actionModeSchema.default("execute"),
  idempotency_key: z.string().trim().min(1).max(256).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const batchBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  session_id: z.string().uuid(),
  stop_on_error: z.boolean().default(true),
  actions: z
    .array(
      z.object({
        action_id: z.string().trim().min(1).max(128),
        mode: actionModeSchema.default("execute"),
        idempotency_key: z.string().trim().min(1).max(256).optional(),
        input: z.record(z.string(), z.unknown()).default({}),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
    )
    .min(1)
    .max(200)
});

const executionParamsSchema = z.object({
  executionId: z.string().uuid()
});

const reportBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  status: actionStatusSchema.refine(value => value !== "dry_run", "dry_run is not reportable"),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().trim().min(1).max(300).optional()
});

interface VerifiedActionRequest {
  requestId: string;
  workspaceId: string;
  identityToken?: string;
}

interface VerifyActionRequestOptions {
  enforceReplay?: boolean;
  requireIdentity?: boolean;
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function internalServiceAuthorized(ctx: AppContext, requestHeaderValue: string | undefined): boolean {
  if (!ctx.config.internalServiceKey) return false;
  if (!requestHeaderValue) return false;

  return secureStringEquals(requestHeaderValue, ctx.config.internalServiceKey);
}

function parseSchema<T>(schema: z.ZodSchema<T>, input: unknown): {ok: true; data: T} | {ok: false; details: unknown} {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      details: parsed.error.flatten()
    };
  }

  return {
    ok: true,
    data: parsed.data
  };
}

async function verifyActionRequest(
  ctx: AppContext,
  request: FastifyRequest,
  reply: {code: (code: number) => {send: (value: unknown) => unknown}},
  options: VerifyActionRequestOptions = {}
): Promise<VerifiedActionRequest | null> {
  const enforceReplay = options.enforceReplay ?? true;
  const requireIdentity = options.requireIdentity ?? true;
  const requestId = getRequestIdHeader(request);
  const workspaceHeader = getWorkspaceIdHeader(request);

  if (!requestId) {
    reply.code(400).send({error: "missing_request_id", hint: "Set X-Clabo-Request-Id"});
    return null;
  }

  if (!workspaceHeader) {
    reply.code(400).send({error: "missing_workspace_header", hint: "Set X-Clabo-Workspace-Id"});
    return null;
  }

  if (enforceReplay) {
    const isNew = await ctx.replayStore.markIfNew(`action_route:${requestId}`, ctx.config.replayTtlSeconds);

    if (!isNew) {
      reply.code(409).send({error: "replayed_request", hint: "Use a unique X-Clabo-Request-Id"});
      return null;
    }
  }

  const identityToken = getHeader(request, ctx.config.auth.headerName);

  if (requireIdentity && !identityToken) {
    reply.code(401).send({
      error: "missing_identity_token",
      hint: `Provide ${ctx.config.auth.headerName}`
    });
    return null;
  }

  return {
    requestId,
    workspaceId: workspaceHeader,
    identityToken
  };
}

export async function registerActionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/agent/v1/actions/catalog", async (_request, reply) => {
    return reply.send({
      success: true,
      actions: ctx.actionExecutor.listActions()
    });
  });

  app.get("/api/agent/v1/actions/executions/:executionId", async (request, reply) => {
    const verified = await verifyActionRequest(ctx, request, reply, {enforceReplay: false});
    if (!verified) return;

    const params = parseSchema(executionParamsSchema, request.params);
    if (!params.ok) return reply.code(400).send({error: "invalid_path_params", details: params.details});

    const record = await ctx.actionExecutor.getExecution(params.data.executionId);
    if (!record) return reply.code(404).send({error: "execution_not_found"});
    if (record.workspaceId !== verified.workspaceId) return reply.code(403).send({error: "workspace_mismatch"});

    return reply.send({
      success: true,
      execution: record
    });
  });

  app.post("/api/agent/v1/actions/execute", async (request, reply) => {
    const verified = await verifyActionRequest(ctx, request, reply);
    if (!verified) return;

    const body = parseSchema(executeBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});
    if (body.data.workspace_id !== verified.workspaceId) return reply.code(400).send({error: "workspace_mismatch"});

    const identity = await ctx.identityService.verify(verified.identityToken ?? "", verified.workspaceId);
    if (!identity.ok) return reply.code(401).send({error: identity.error, hint: identity.hint});

    const session = await ctx.sessionStore.get(body.data.session_id);
    if (!session) return reply.code(404).send({error: "session_not_found"});
    if (session.workspaceId !== body.data.workspace_id) return reply.code(403).send({error: "workspace_mismatch"});

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));
    if (!internalAuthorized && session.agent.id !== identity.agent.id) {
      return reply.code(403).send({error: "session_owner_mismatch"});
    }

    const idempotencyKey =
      body.data.idempotency_key ?? getHeader(request, "x-clabo-idempotency-key") ?? verified.requestId;

    const response = await ctx.actionExecutor.execute({
      requestId: verified.requestId,
      workspaceId: body.data.workspace_id,
      session,
      idempotencyKey,
      actionId: body.data.action_id,
      input: body.data.input,
      mode: body.data.mode,
      metadata: body.data.metadata ?? {}
    });

    if (!response.ok) {
      return reply.code(response.statusCode).send({
        error: response.error,
        details: response.details
      });
    }

    return reply.code(response.idempotentReplay ? 200 : 201).send({
      success: true,
      idempotent_replay: response.idempotentReplay,
      execution: response.record
    });
  });

  app.post("/api/agent/v1/actions/batch", async (request, reply) => {
    const verified = await verifyActionRequest(ctx, request, reply);
    if (!verified) return;

    const body = parseSchema(batchBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});
    if (body.data.workspace_id !== verified.workspaceId) return reply.code(400).send({error: "workspace_mismatch"});

    if (body.data.actions.length > ctx.config.actionMaxBatchSize) {
      return reply.code(400).send({
        error: "batch_size_exceeded",
        details: {
          max_batch_size: ctx.config.actionMaxBatchSize
        }
      });
    }

    const estimatedDurationMs = estimateWorstCaseBatchDurationMs(ctx.config, body.data.actions.length);

    if (estimatedDurationMs > ctx.config.requestExecutionBudgetMs) {
      return reply.code(409).send({
        error: "batch_exceeds_execution_budget",
        details: {
          action_count: body.data.actions.length,
          estimated_duration_ms: estimatedDurationMs,
          max_budget_ms: ctx.config.requestExecutionBudgetMs,
          suggested_max_batch_size: Math.min(ctx.config.actionMaxBatchSize, estimateMaxSynchronousActions(ctx.config))
        }
      });
    }

    const identity = await ctx.identityService.verify(verified.identityToken ?? "", verified.workspaceId);
    if (!identity.ok) return reply.code(401).send({error: identity.error, hint: identity.hint});

    const session = await ctx.sessionStore.get(body.data.session_id);
    if (!session) return reply.code(404).send({error: "session_not_found"});
    if (session.workspaceId !== body.data.workspace_id) return reply.code(403).send({error: "workspace_mismatch"});

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));
    if (!internalAuthorized && session.agent.id !== identity.agent.id) {
      return reply.code(403).send({error: "session_owner_mismatch"});
    }

    const results: Array<Record<string, unknown>> = [];
    let stopped = false;

    for (let index = 0; index < body.data.actions.length; index++) {
      const action = body.data.actions[index];
      if (!action) continue;

      const idempotencyKey =
        action.idempotency_key ?? getHeader(request, "x-clabo-idempotency-key") ?? `${verified.requestId}:${index + 1}`;

      const response = await ctx.actionExecutor.execute({
        requestId: verified.requestId,
        workspaceId: body.data.workspace_id,
        session,
        idempotencyKey,
        actionId: action.action_id,
        input: action.input,
        mode: action.mode,
        metadata: action.metadata ?? {}
      });

      if (!response.ok) {
        results.push({
          index,
          ok: false,
          error: response.error,
          details: response.details
        });

        if (body.data.stop_on_error) {
          stopped = true;
          break;
        }

        continue;
      }

      results.push({
        index,
        ok: true,
        idempotent_replay: response.idempotentReplay,
        execution: response.record
      });
    }

    return reply.send({
      success: true,
      stopped,
      count: results.length,
      results
    });
  });

  app.post("/api/agent/v1/actions/executions/:executionId/report", async (request, reply) => {
    const verified = await verifyActionRequest(ctx, request, reply, {requireIdentity: false});
    if (!verified) return;

    if (!internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request))) {
      return reply.code(403).send({error: "internal_service_auth_required"});
    }

    const params = parseSchema(executionParamsSchema, request.params);
    if (!params.ok) return reply.code(400).send({error: "invalid_path_params", details: params.details});

    const body = parseSchema(reportBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});
    if (body.data.workspace_id !== verified.workspaceId) return reply.code(400).send({error: "workspace_mismatch"});

    const response = await ctx.actionExecutor.reportExecution({
      requestId: verified.requestId,
      workspaceId: body.data.workspace_id,
      executionId: params.data.executionId,
      status: body.data.status,
      result: body.data.result,
      error: body.data.error
    });

    if (!response.ok) {
      return reply.code(response.statusCode).send({
        error: response.error,
        details: response.details
      });
    }

    return reply.code(response.idempotentReplay ? 200 : 202).send({
      success: true,
      idempotent_replay: response.idempotentReplay,
      execution: response.record
    });
  });
}
