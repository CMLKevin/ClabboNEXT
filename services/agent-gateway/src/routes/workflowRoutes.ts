import {timingSafeEqual} from "node:crypto";

import {FastifyInstance, FastifyRequest} from "fastify";
import {z} from "zod";

import {actionModeSchema} from "../actions/types.js";
import {AppContext} from "../context.js";
import {getHeader, getInternalServiceKeyHeader, getRequestIdHeader, getWorkspaceIdHeader} from "../utils/request.js";
import {WorkflowDispatchPayload} from "../workflows/WorkflowQueueStore.js";

const workspaceIdSchema = z.string().trim().min(1).max(128);

const inlineStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  action_id: z.string().trim().min(1).max(128),
  mode: actionModeSchema.default("execute"),
  halt_on_error: z.boolean().default(true),
  input: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const executeWorkflowBodySchema = z
  .object({
    workspace_id: workspaceIdSchema,
    session_id: z.string().uuid(),
    workflow_id: z.string().trim().min(1).max(128).optional(),
    inline_workflow_title: z.string().trim().min(1).max(100).optional(),
    inline_steps: z.array(inlineStepSchema).min(1).max(100).optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .refine(value => value.workflow_id || (value.inline_steps && value.inline_steps.length > 0), {
    message: "workflow_id or inline_steps is required"
  });

const drainBodySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  time_budget_ms: z.number().int().min(1000).max(300000).optional()
});

const workflowExecutionParamsSchema = z.object({
  workflowExecutionId: z.string().uuid()
});

interface VerifiedWorkflowRequest {
  requestId: string;
  workspaceId: string;
  identityToken?: string;
}

interface VerifyWorkflowRequestOptions {
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

function cronAuthorized(ctx: AppContext, authorizationHeader: string | undefined): boolean {
  const cronSecret = ctx.config.cronSecret;

  if (!cronSecret) return false;
  if (!authorizationHeader) return false;

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);

  if (!match || !match[1]) return false;

  return secureStringEquals(match[1], cronSecret);
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

async function verifyWorkflowRequest(
  ctx: AppContext,
  request: FastifyRequest,
  reply: {code: (code: number) => {send: (value: unknown) => unknown}},
  options: VerifyWorkflowRequestOptions = {}
): Promise<VerifiedWorkflowRequest | null> {
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
    const isNew = await ctx.replayStore.markIfNew(`workflow_route:${requestId}`, ctx.config.replayTtlSeconds);

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

export async function registerWorkflowRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/agent/v1/workflows/catalog", async (_request, reply) => {
    return reply.send({
      success: true,
      workflows: ctx.workflowExecutor.listWorkflows()
    });
  });

  app.get("/api/agent/v1/workflows/executions/:workflowExecutionId", async (request, reply) => {
    const verified = await verifyWorkflowRequest(ctx, request, reply, {enforceReplay: false});
    if (!verified) return;

    const params = parseSchema(workflowExecutionParamsSchema, request.params);
    if (!params.ok) return reply.code(400).send({error: "invalid_path_params", details: params.details});

    const workflowExecution = await ctx.workflowExecutor.getExecution(params.data.workflowExecutionId);
    if (!workflowExecution) return reply.code(404).send({error: "workflow_execution_not_found"});
    if (workflowExecution.workspaceId !== verified.workspaceId) return reply.code(403).send({error: "workspace_mismatch"});

    return reply.send({
      success: true,
      workflow_execution: workflowExecution
    });
  });

  app.post("/api/agent/v1/workflows/execute", async (request, reply) => {
    const verified = await verifyWorkflowRequest(ctx, request, reply);
    if (!verified) return;

    const body = parseSchema(executeWorkflowBodySchema, request.body);
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

    const response = await ctx.workflowExecutor.execute({
      requestId: verified.requestId,
      workspaceId: body.data.workspace_id,
      session,
      workflowId: body.data.workflow_id,
      inlineWorkflowTitle: body.data.inline_workflow_title,
      inlineSteps: body.data.inline_steps?.map(step => ({
        id: step.id,
        actionId: step.action_id,
        mode: step.mode,
        haltOnError: step.halt_on_error,
        input: step.input,
        metadata: step.metadata
      })),
      payload: body.data.payload,
      metadata: body.data.metadata ?? {}
    });

    if (!response.ok) {
      return reply.code(response.statusCode).send({
        error: response.error,
        details: response.details
      });
    }

    return reply.code(201).send({
      success: true,
      workflow_execution: response.record
    });
  });

  app.post("/api/agent/v1/workflows/dispatch", async (request, reply) => {
    if (!ctx.config.workflowAsyncEnabled) {
      return reply.code(403).send({error: "workflow_async_disabled"});
    }

    const verified = await verifyWorkflowRequest(ctx, request, reply);
    if (!verified) return;

    const body = parseSchema(executeWorkflowBodySchema, request.body);
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

    const dispatchResponse = await ctx.workflowExecutor.dispatch({
      requestId: verified.requestId,
      workspaceId: body.data.workspace_id,
      session,
      workflowId: body.data.workflow_id,
      inlineWorkflowTitle: body.data.inline_workflow_title,
      inlineSteps: body.data.inline_steps?.map(step => ({
        id: step.id,
        actionId: step.action_id,
        mode: step.mode,
        haltOnError: step.halt_on_error,
        input: step.input,
        metadata: step.metadata
      })),
      payload: body.data.payload,
      metadata: body.data.metadata ?? {}
    });

    if (!dispatchResponse.ok) {
      return reply.code(dispatchResponse.statusCode).send({
        error: dispatchResponse.error,
        details: dispatchResponse.details
      });
    }

    const queuePayload: WorkflowDispatchPayload = {
      workflowExecutionId: dispatchResponse.record.workflowExecutionId,
      requestId: verified.requestId,
      workspaceId: body.data.workspace_id,
      session,
      workflowId: body.data.workflow_id,
      inlineWorkflowTitle: body.data.inline_workflow_title,
      inlineSteps: body.data.inline_steps?.map(step => ({
        id: step.id,
        actionId: step.action_id,
        mode: step.mode,
        haltOnError: step.halt_on_error,
        input: step.input,
        metadata: step.metadata
      })),
      payload: body.data.payload,
      metadata: body.data.metadata ?? {},
      enqueuedAt: new Date().toISOString()
    };

    const enqueued = await ctx.workflowQueueStore.enqueue(queuePayload, ctx.config.workflowExecutionTtlSeconds);

    if (!enqueued) {
      return reply.code(409).send({
        error: "workflow_dispatch_conflict",
        details: {
          workflow_execution_id: dispatchResponse.record.workflowExecutionId
        }
      });
    }

    return reply.code(202).send({
      success: true,
      queued: true,
      workflow_execution: dispatchResponse.record
    });
  });

  app.post("/api/agent/v1/internal/workflows/drain", async (request, reply) => {
    if (!ctx.config.workflowAsyncEnabled) {
      return reply.code(403).send({error: "workflow_async_disabled"});
    }

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));
    const cronAuthValid = cronAuthorized(ctx, getHeader(request, "authorization"));

    if (!internalAuthorized && !cronAuthValid) {
      return reply.code(403).send({error: "internal_service_auth_required"});
    }

    const parsedBody = parseSchema(drainBodySchema, request.body ?? {});

    if (!parsedBody.ok) return reply.code(400).send({error: "invalid_payload", details: parsedBody.details});

    const limit = parsedBody.data.limit ?? ctx.config.workflowDrainMaxItems;
    const timeBudgetMs = parsedBody.data.time_budget_ms ?? ctx.config.workflowDrainTimeBudgetMs;
    const startedAt = Date.now();
    const summary = {
      limit,
      time_budget_ms: timeBudgetMs,
      dequeued: 0,
      processed: 0,
      failed: 0,
      requeued: 0,
      lock_conflicts: 0
    };

    try {
      while (summary.dequeued < limit && Date.now() - startedAt < timeBudgetMs) {
        const jobs = await ctx.workflowQueueStore.dequeueBatch(1);
        const job = jobs[0];

        if (!job) break;

        summary.dequeued += 1;

        const claimed = await ctx.workflowQueueStore.claim(job.workflowExecutionId, ctx.config.workflowQueueLockSeconds);

        if (!claimed) {
          summary.lock_conflicts += 1;
          continue;
        }

        try {
          const processed = await ctx.workflowExecutor.processDispatched({
            workflowExecutionId: job.workflowExecutionId,
            requestId: job.requestId,
            workspaceId: job.workspaceId,
            session: job.session,
            workflowId: job.workflowId,
            inlineWorkflowTitle: job.inlineWorkflowTitle,
            inlineSteps: job.inlineSteps,
            payload: job.payload,
            metadata: job.metadata
          });

          if (processed.ok) summary.processed += 1;
          else summary.failed += 1;

          await ctx.workflowQueueStore.deletePayload(job.workflowExecutionId);
        } catch (error) {
          request.log.error({error, workflowExecutionId: job.workflowExecutionId}, "workflow drain processing failed");
          summary.failed += 1;
          const requeued = await ctx.workflowQueueStore.requeue(job.workflowExecutionId);

          if (requeued) summary.requeued += 1;
        } finally {
          await ctx.workflowQueueStore.release(job.workflowExecutionId);
        }
      }
    } catch (error) {
      request.log.error({error}, "workflow drain failed due queue backend error");
      return reply.code(503).send({error: "workflow_queue_unavailable"});
    }

    return reply.send({
      success: true,
      summary: {
        ...summary,
        duration_ms: Date.now() - startedAt
      }
    });
  });

  app.get("/api/agent/v1/internal/workflows/cron", async (request, reply) => {
    if (!ctx.config.workflowAsyncEnabled) {
      return reply.code(403).send({error: "workflow_async_disabled"});
    }

    if (!cronAuthorized(ctx, getHeader(request, "authorization"))) {
      return reply.code(403).send({error: "cron_auth_required"});
    }

    const startedAt = Date.now();
    const summary = {
      limit: ctx.config.workflowDrainMaxItems,
      time_budget_ms: ctx.config.workflowDrainTimeBudgetMs,
      dequeued: 0,
      processed: 0,
      failed: 0,
      requeued: 0,
      lock_conflicts: 0
    };

    try {
      while (summary.dequeued < summary.limit && Date.now() - startedAt < summary.time_budget_ms) {
        const jobs = await ctx.workflowQueueStore.dequeueBatch(1);
        const job = jobs[0];

        if (!job) break;

        summary.dequeued += 1;

        const claimed = await ctx.workflowQueueStore.claim(job.workflowExecutionId, ctx.config.workflowQueueLockSeconds);

        if (!claimed) {
          summary.lock_conflicts += 1;
          continue;
        }

        try {
          const processed = await ctx.workflowExecutor.processDispatched({
            workflowExecutionId: job.workflowExecutionId,
            requestId: job.requestId,
            workspaceId: job.workspaceId,
            session: job.session,
            workflowId: job.workflowId,
            inlineWorkflowTitle: job.inlineWorkflowTitle,
            inlineSteps: job.inlineSteps,
            payload: job.payload,
            metadata: job.metadata
          });

          if (processed.ok) summary.processed += 1;
          else summary.failed += 1;

          await ctx.workflowQueueStore.deletePayload(job.workflowExecutionId);
        } catch (error) {
          request.log.error({error, workflowExecutionId: job.workflowExecutionId}, "workflow cron processing failed");
          summary.failed += 1;
          const requeued = await ctx.workflowQueueStore.requeue(job.workflowExecutionId);

          if (requeued) summary.requeued += 1;
        } finally {
          await ctx.workflowQueueStore.release(job.workflowExecutionId);
        }
      }
    } catch (error) {
      request.log.error({error}, "workflow cron failed due queue backend error");
      return reply.code(503).send({error: "workflow_queue_unavailable"});
    }

    return reply.send({
      success: true,
      summary: {
        ...summary,
        duration_ms: Date.now() - startedAt
      }
    });
  });
}
