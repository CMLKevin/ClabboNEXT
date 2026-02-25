import {timingSafeEqual} from "node:crypto";

import {FastifyInstance} from "fastify";
import {z} from "zod";

import {AppContext} from "../context.js";
import {getInternalServiceKeyHeader, getRequestIdHeader, getWorkspaceIdHeader} from "../utils/request.js";

const workspaceIdSchema = z.string().trim().min(1).max(128);

const issueTokenBodySchema = z.object({
  workspace_id: workspaceIdSchema,
  ttl_seconds: z.number().int().min(60).max(86400).optional(),
  trust_tier: z.enum(["external", "partner", "internal"]).optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  agent: z.object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().max(400).optional(),
    avatar_url: z.string().trim().max(500).optional(),
    created_at: z.string().trim().max(64).optional(),
    owner: z
      .object({
        handle: z.string().trim().max(128).optional(),
        display_name: z.string().trim().max(128).optional(),
        avatar_url: z.string().trim().max(500).optional(),
        verified: z.boolean().optional()
      })
      .optional(),
    stats: z
      .object({
        actions_executed: z.number().int().min(0).optional(),
        workflows_executed: z.number().int().min(0).optional()
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
});

const introspectBodySchema = z.object({
  token: z.string().trim().min(1),
  workspace_id: workspaceIdSchema.optional()
});

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

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/agent/v1/auth/config", async (_request, reply) => {
    return reply.send({
      success: true,
      auth: {
        scheme: "clb1",
        header_name: ctx.config.auth.headerName,
        issuer: ctx.config.auth.issuer,
        audience: ctx.config.auth.audience,
        current_kid: ctx.config.auth.currentKid,
        token_max_ttl_seconds: ctx.config.auth.tokenMaxTtlSeconds,
        verify_cache_ttl_seconds: ctx.config.auth.verifyCacheTtlSeconds,
        verify_cache_max_entries: ctx.config.auth.verifyCacheMaxEntries,
        allow_issue_endpoint: ctx.config.auth.allowTokenIssueEndpoint
      }
    });
  });

  app.post("/api/agent/v1/auth/token/issue", async (request, reply) => {
    if (!ctx.config.auth.allowTokenIssueEndpoint) {
      return reply.code(403).send({error: "token_issue_disabled"});
    }

    const requestId = getRequestIdHeader(request);
    const workspaceHeader = getWorkspaceIdHeader(request);

    if (!requestId) return reply.code(400).send({error: "missing_request_id", hint: "Set X-Clabo-Request-Id"});
    if (!workspaceHeader) return reply.code(400).send({error: "missing_workspace_header", hint: "Set X-Clabo-Workspace-Id"});
    if (!internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request))) {
      return reply.code(403).send({error: "internal_service_auth_required"});
    }

    const body = parseSchema(issueTokenBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});
    if (body.data.workspace_id !== workspaceHeader) return reply.code(400).send({error: "workspace_mismatch"});

    const issueResult = await ctx.identityService.issue({
      workspaceId: body.data.workspace_id,
      ttlSeconds: body.data.ttl_seconds,
      trustTier: body.data.trust_tier,
      capabilities: body.data.capabilities,
      metadata: body.data.metadata ?? {},
      agent: body.data.agent
    });

    return reply.code(201).send({
      success: true,
      token: issueResult.token,
      token_type: issueResult.token_type,
      kid: issueResult.kid,
      issued_at: issueResult.issued_at,
      expires_at: issueResult.expires_at,
      claims: issueResult.claims
    });
  });

  app.post("/api/agent/v1/auth/token/introspect", async (request, reply) => {
    if (!internalServiceAuthorized(ctx, getInternalServiceKeyHeader(request))) {
      return reply.code(403).send({error: "internal_service_auth_required"});
    }

    const body = parseSchema(introspectBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});

    const verify = await ctx.identityService.verify(body.data.token, body.data.workspace_id);

    if (!verify.ok) {
      return reply.send({
        success: true,
        valid: false,
        error: verify.error,
        hint: verify.hint
      });
    }

    return reply.send({
      success: true,
      valid: true,
      claims: verify.claims,
      agent: verify.agent
    });
  });

  app.get("/auth.md", async (_request, reply) => {
    const instructions = [
      "# Clabbo Agent Auth",
      "",
      "Use a `clb1` identity token in the request header configured by the gateway.",
      "",
      `Default header: \`${ctx.config.auth.headerName}\``,
      "",
      "Required headers on protected routes:",
      "- X-Clabo-Request-Id",
      "- X-Clabo-Workspace-Id",
      `- ${ctx.config.auth.headerName}`,
      "",
      "Token format: `clb1.<kid>.<payload>.<signature>`",
      "",
      "Protected session flow:",
      "1. POST /api/agent/v1/session/validate",
      "2. POST /api/agent/v1/session/start",
      "3. GET /api/agent/v1/session/status",
      "4. POST /api/agent/v1/session/end"
    ].join("\n");

    reply.type("text/markdown; charset=utf-8");
    return reply.send(instructions);
  });
}
