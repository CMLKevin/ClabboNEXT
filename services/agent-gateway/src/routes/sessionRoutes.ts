import {randomUUID, timingSafeEqual} from "node:crypto";

import {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";
import {z} from "zod";

import {AppContext} from "../context.js";
import {RuntimeTarget, SessionRecord, TrustTier} from "../types.js";
import {
  chooseRuntimeTarget,
  clampTrustTierToIdentity,
  evaluateCapabilities,
  evaluateRuntimePolicy,
  normalizeTrustTier,
  parseCapabilities,
  resolveTrustTier
} from "../utils/policy.js";
import {getHeader, getInternalServiceKeyHeader, getRequestIdHeader, getWorkspaceIdHeader} from "../utils/request.js";

const workspaceIdSchema = z.string().trim().min(1).max(128);
const runtimeTargetSchema = z.enum(["e2b", "internal-worker", "auto"]);
const trustTierSchema = z.enum(["external", "partner", "internal"]);

const baseBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  capabilities: z.union([z.array(z.string()), z.string()]).optional(),
  runtime_target: runtimeTargetSchema.default("auto"),
  trust_tier: trustTierSchema.optional()
});

const validateBodySchema = baseBodySchema;
const startBodySchema = baseBodySchema.extend({
  purpose: z.string().trim().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const endBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  session_id: z.string().uuid(),
  reason: z.string().trim().max(200).optional()
});

const statusQuerySchema = z.object({
  session_id: z.string().uuid()
});

interface VerifiedRequestContext {
  requestId: string;
  workspaceId: string;
  identityToken: string;
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

async function ensureReplayProtection(ctx: AppContext, requestId: string, routeKey: string): Promise<boolean> {
  return ctx.replayStore.markIfNew(`${routeKey}:${requestId}`, ctx.config.replayTtlSeconds);
}

function parseRequestBody<T>(schema: z.ZodSchema<T>, body: unknown): {ok: true; data: T} | {ok: false; details: unknown} {
  const parsed = schema.safeParse(body);

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

async function verifyRequestContext(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  routeKey: string
): Promise<VerifiedRequestContext | null> {
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

  const isNew = await ensureReplayProtection(ctx, requestId, routeKey);

  if (!isNew) {
    reply.code(409).send({error: "replayed_request", hint: "Use a unique X-Clabo-Request-Id"});
    return null;
  }

  const identityToken = getHeader(request, ctx.config.auth.headerName);

  if (!identityToken) {
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

function evaluatePolicy(
  ctx: AppContext,
  requestedRuntimeTarget: RuntimeTarget | "auto",
  requestedTrustTier: TrustTier,
  identityTrustTier: TrustTier,
  requestedCapabilities: string[],
  internalAuthorized: boolean
): {
  runtimeTarget: RuntimeTarget;
  trustTier: TrustTier;
  runtimeAllowed: ReturnType<typeof evaluateRuntimePolicy>;
  capabilityDecision: ReturnType<typeof evaluateCapabilities>;
} {
  const resolvedRequestedTier = resolveTrustTier(requestedTrustTier, internalAuthorized);
  const trustTier = clampTrustTierToIdentity(resolvedRequestedTier, identityTrustTier, internalAuthorized);
  const runtimeTarget = chooseRuntimeTarget(
    ctx.config.runtimePolicy,
    requestedRuntimeTarget,
    trustTier,
    ctx.config.requireE2BForExternal
  );
  const capabilityDecision = evaluateCapabilities(requestedCapabilities, ctx.config.allowedCapabilities);
  const runtimeAllowed = evaluateRuntimePolicy(ctx.config.runtimePolicy, runtimeTarget, trustTier, ctx.config.requireE2BForExternal);

  return {
    runtimeTarget,
    trustTier,
    runtimeAllowed,
    capabilityDecision
  };
}

export async function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post("/api/agent/v1/session/validate", async (request, reply) => {
    const verified = await verifyRequestContext(ctx, request, reply, "session_validate");
    if (!verified) return;

    const parsedBody = parseRequestBody(validateBodySchema, request.body);

    if (!parsedBody.ok) return reply.code(400).send({error: "invalid_payload", details: parsedBody.details});

    const body = parsedBody.data;

    if (body.workspace_id !== verified.workspaceId) {
      return reply.code(400).send({error: "workspace_mismatch", hint: "Body workspace_id must match X-Clabo-Workspace-Id"});
    }

    const verifyResult = await ctx.identityService.verify(verified.identityToken, verified.workspaceId);

    if (!verifyResult.ok) {
      return reply.code(401).send({
        error: verifyResult.error,
        hint: verifyResult.hint ?? "Generate a new Clabbo identity token and retry"
      });
    }

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));
    const identityTrustTier = normalizeTrustTier(verifyResult.claims.trust_tier);
    const requestedRuntimeTarget = body.runtime_target;
    const requestedCapabilities = parseCapabilities(body.capabilities);
    const effectiveRequestedCapabilities = requestedCapabilities.length ? requestedCapabilities : ctx.config.allowedCapabilities;
    const requestedTrustTier = normalizeTrustTier(body.trust_tier);
    const decision = evaluatePolicy(
      ctx,
      requestedRuntimeTarget,
      requestedTrustTier,
      identityTrustTier,
      effectiveRequestedCapabilities,
      internalAuthorized
    );
    const runtimeTarget = decision.runtimeTarget;
    const allowed = decision.runtimeAllowed.allowed && decision.capabilityDecision.missing.length === 0;

    ctx.audit.emit({
      event: "session.validate",
      at: new Date().toISOString(),
      requestId: verified.requestId,
      workspaceId: body.workspace_id,
      agentId: verifyResult.agent.id,
      agentName: verifyResult.agent.name,
      runtimeTarget,
      trustTier: decision.trustTier,
      allowed,
      reason: !decision.runtimeAllowed.allowed
        ? decision.runtimeAllowed.reason
        : decision.capabilityDecision.missing.length
          ? "missing_capabilities"
          : undefined,
      details: {
        requestedCapabilities,
        effectiveRequestedCapabilities,
        grantedCapabilities: decision.capabilityDecision.granted,
        missingCapabilities: decision.capabilityDecision.missing
      }
    });

    if (!decision.runtimeAllowed.allowed) return reply.code(403).send({error: decision.runtimeAllowed.reason, valid: false});
    if (decision.capabilityDecision.missing.length) {
      return reply.code(403).send({
        error: "capability_not_allowed",
        valid: false,
        missing_capabilities: decision.capabilityDecision.missing
      });
    }

    request.authContext = {
      provider: "clabbo",
      requestId: verified.requestId,
      workspaceId: body.workspace_id,
      capabilities: decision.capabilityDecision.granted,
      trustTier: decision.trustTier,
      runtimeTarget,
      agent: verifyResult.agent
    };

    return reply.send({
      valid: true,
      provider: "clabbo",
      request_id: verified.requestId,
      workspace_id: body.workspace_id,
      runtime_target: runtimeTarget,
      trust_tier: decision.trustTier,
      capabilities_granted: decision.capabilityDecision.granted,
      agent: verifyResult.agent,
      auth_instructions_url: `${ctx.config.claboPublicUrl}/auth.md?app=${encodeURIComponent(
        ctx.config.claboAppName
      )}&endpoint=${encodeURIComponent(`${ctx.config.claboPublicUrl}/api/agent/v1/session/validate`)}`
    });
  });

  app.post("/api/agent/v1/session/start", async (request, reply) => {
    const verified = await verifyRequestContext(ctx, request, reply, "session_start");
    if (!verified) return;

    const parsedBody = parseRequestBody(startBodySchema, request.body);

    if (!parsedBody.ok) return reply.code(400).send({error: "invalid_payload", details: parsedBody.details});

    const body = parsedBody.data;

    if (body.workspace_id !== verified.workspaceId) {
      return reply.code(400).send({error: "workspace_mismatch", hint: "Body workspace_id must match X-Clabo-Workspace-Id"});
    }

    const verifyResult = await ctx.identityService.verify(verified.identityToken, verified.workspaceId);

    if (!verifyResult.ok) {
      return reply.code(401).send({
        error: verifyResult.error,
        hint: verifyResult.hint ?? "Generate a new Clabbo identity token and retry"
      });
    }

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));
    const identityTrustTier = normalizeTrustTier(verifyResult.claims.trust_tier);
    const requestedRuntimeTarget = body.runtime_target;
    const requestedCapabilities = parseCapabilities(body.capabilities);
    const effectiveRequestedCapabilities = requestedCapabilities.length ? requestedCapabilities : ctx.config.allowedCapabilities;
    const requestedTrustTier = normalizeTrustTier(body.trust_tier);
    const decision = evaluatePolicy(
      ctx,
      requestedRuntimeTarget,
      requestedTrustTier,
      identityTrustTier,
      effectiveRequestedCapabilities,
      internalAuthorized
    );
    const runtimeTarget = decision.runtimeTarget;

    if (!decision.runtimeAllowed.allowed) return reply.code(403).send({error: decision.runtimeAllowed.reason});
    if (decision.capabilityDecision.missing.length) {
      return reply.code(403).send({
        error: "capability_not_allowed",
        missing_capabilities: decision.capabilityDecision.missing
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ctx.config.sessionTtlSeconds * 1000);
    const sessionId = randomUUID();
    const session: SessionRecord = {
      sessionId,
      workspaceId: body.workspace_id,
      requestId: verified.requestId,
      runtimeTarget,
      trustTier: decision.trustTier,
      capabilities: decision.capabilityDecision.granted,
      purpose: body.purpose ?? null,
      metadata: body.metadata ?? {},
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      endedAt: null,
      agent: verifyResult.agent
    };

    await ctx.sessionStore.create(session, ctx.config.sessionTtlSeconds);

    ctx.audit.emit({
      event: "session.start",
      at: now.toISOString(),
      requestId: verified.requestId,
      workspaceId: body.workspace_id,
      sessionId,
      agentId: verifyResult.agent.id,
      agentName: verifyResult.agent.name,
      runtimeTarget,
      trustTier: decision.trustTier,
      allowed: true,
      details: {
        purpose: session.purpose,
        capabilities: session.capabilities
      }
    });

    return reply.code(201).send({
      success: true,
      session_id: sessionId,
      workspace_id: session.workspaceId,
      runtime_target: session.runtimeTarget,
      trust_tier: session.trustTier,
      capabilities: session.capabilities,
      started_at: session.startedAt,
      expires_at: session.expiresAt,
      agent: session.agent
    });
  });

  app.get("/api/agent/v1/session/status", async (request, reply) => {
    const requestId = getRequestIdHeader(request);
    const workspaceHeader = getWorkspaceIdHeader(request);

    if (!requestId) return reply.code(400).send({error: "missing_request_id", hint: "Set X-Clabo-Request-Id"});
    if (!workspaceHeader) return reply.code(400).send({error: "missing_workspace_header", hint: "Set X-Clabo-Workspace-Id"});

    const query = parseRequestBody(statusQuerySchema, request.query);

    if (!query.ok) return reply.code(400).send({error: "invalid_query", details: query.details});

    const existing = await ctx.sessionStore.get(query.data.session_id);

    if (!existing) return reply.code(404).send({error: "session_not_found"});
    if (existing.workspaceId !== workspaceHeader) return reply.code(403).send({error: "workspace_mismatch"});

    return reply.send({
      success: true,
      session_id: existing.sessionId,
      workspace_id: existing.workspaceId,
      started_at: existing.startedAt,
      ended_at: existing.endedAt,
      expires_at: existing.expiresAt,
      runtime_target: existing.runtimeTarget,
      trust_tier: existing.trustTier,
      capabilities: existing.capabilities,
      agent: existing.agent
    });
  });

  app.post("/api/agent/v1/session/end", async (request, reply) => {
    const verified = await verifyRequestContext(ctx, request, reply, "session_end");
    if (!verified) return;

    const parsedBody = parseRequestBody(endBodySchema, request.body);

    if (!parsedBody.ok) return reply.code(400).send({error: "invalid_payload", details: parsedBody.details});

    const body = parsedBody.data;

    if (body.workspace_id !== verified.workspaceId) {
      return reply.code(400).send({error: "workspace_mismatch", hint: "Body workspace_id must match X-Clabo-Workspace-Id"});
    }

    const verifyResult = await ctx.identityService.verify(verified.identityToken, verified.workspaceId);

    if (!verifyResult.ok) {
      return reply.code(401).send({
        error: verifyResult.error,
        hint: verifyResult.hint ?? "Generate a new Clabbo identity token and retry"
      });
    }

    const existing = await ctx.sessionStore.get(body.session_id);

    if (!existing) return reply.code(404).send({error: "session_not_found"});
    if (existing.workspaceId !== body.workspace_id) return reply.code(403).send({error: "workspace_mismatch"});

    const internalAuthorized = internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request));

    if (!internalAuthorized && existing.agent.id !== verifyResult.agent.id) {
      return reply.code(403).send({error: "session_owner_mismatch"});
    }

    const endedAt = new Date().toISOString();
    const ended = await ctx.sessionStore.end(body.session_id, endedAt);

    ctx.audit.emit({
      event: "session.end",
      at: endedAt,
      requestId: verified.requestId,
      workspaceId: body.workspace_id,
      sessionId: body.session_id,
      agentId: verifyResult.agent.id,
      agentName: verifyResult.agent.name,
      runtimeTarget: existing.runtimeTarget,
      trustTier: existing.trustTier,
      allowed: true,
      details: {
        reason: body.reason ?? null
      }
    });

    return reply.send({
      success: true,
      session_id: body.session_id,
      ended_at: ended?.endedAt ?? endedAt
    });
  });
}
