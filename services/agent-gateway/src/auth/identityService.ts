import {createHash, createHmac, randomUUID, timingSafeEqual} from "node:crypto";

import {FastifyBaseLogger} from "fastify";
import {z} from "zod";

import {AppConfig} from "../config.js";
import {AgentIdentityProfile, TrustTier} from "../types.js";

const tokenClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.string().min(1),
  sub: z.string().min(1),
  wid: z.string().min(1),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    avatar_url: z.string().optional(),
    created_at: z.string().optional(),
    owner: z
      .object({
        handle: z.string().optional(),
        display_name: z.string().optional(),
        avatar_url: z.string().optional(),
        verified: z.boolean().optional()
      })
      .optional(),
    stats: z
      .object({
        actions_executed: z.number().optional(),
        workflows_executed: z.number().optional()
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  }),
  trust_tier: z.enum(["external", "partner", "internal"]).default("external"),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  iat: z.number().int().nonnegative(),
  nbf: z.number().int().nonnegative().optional(),
  exp: z.number().int().nonnegative(),
  jti: z.string().min(1)
});

const issueInputSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  ttlSeconds: z.number().int().min(60).max(86400).optional(),
  trustTier: z.enum(["external", "partner", "internal"]).optional(),
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

interface CachedIdentity {
  result: IdentityVerifyResult;
  expiresAtMs: number;
}

export interface ClabboIdentityClaims {
  iss: string;
  aud: string;
  sub: string;
  wid: string;
  trust_tier: TrustTier;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  iat: number;
  nbf?: number;
  exp: number;
  jti: string;
}

export interface IdentityIssueInput {
  workspaceId: string;
  ttlSeconds?: number;
  trustTier?: TrustTier;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  agent: AgentIdentityProfile;
}

export interface IdentityIssueResult {
  token: string;
  token_type: "clb1";
  kid: string;
  issued_at: string;
  expires_at: string;
  claims: ClabboIdentityClaims;
}

export type IdentityVerifyResult =
  | {ok: true; agent: AgentIdentityProfile; claims: ClabboIdentityClaims}
  | {ok: false; error: string; hint?: string};

export interface IdentityServiceLike {
  verify(identityToken: string, expectedWorkspaceId?: string): Promise<IdentityVerifyResult>;
  issue(input: IdentityIssueInput): Promise<IdentityIssueResult>;
}

export class IdentityService implements IdentityServiceLike {
  private readonly cache = new Map<string, CachedIdentity>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger
  ) {}

  public async verify(identityToken: string, expectedWorkspaceId?: string): Promise<IdentityVerifyResult> {
    const cacheKey = this.hashToken(identityToken);
    const nowMs = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAtMs > nowMs) {
      if (!cached.result.ok) return cached.result;
      if (expectedWorkspaceId && cached.result.claims.wid !== expectedWorkspaceId) {
        return {ok: false, error: "workspace_mismatch"};
      }

      return cached.result;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const parsed = this.verifyToken(identityToken);
    const cacheTtlMs = Math.max(0, this.config.auth.verifyCacheTtlSeconds * 1000);
    const expiresAtMs = nowMs + cacheTtlMs;

    if (cacheTtlMs > 0) {
      this.ensureCacheCapacity(nowMs);
      this.cache.set(cacheKey, {
        result: parsed,
        expiresAtMs
      });
    }

    if (!parsed.ok) return parsed;
    if (expectedWorkspaceId && parsed.claims.wid !== expectedWorkspaceId) {
      return {ok: false, error: "workspace_mismatch"};
    }

    return parsed;
  }

  public async issue(input: IdentityIssueInput): Promise<IdentityIssueResult> {
    const parsedInput = issueInputSchema.parse(input);
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.min(parsedInput.ttlSeconds ?? this.config.auth.tokenMaxTtlSeconds, this.config.auth.tokenMaxTtlSeconds);
    const kid = this.config.auth.currentKid;
    const secret = this.config.auth.keys[kid];

    if (!secret) throw new Error(`Missing signing key for kid '${kid}'`);

    const claims: ClabboIdentityClaims = {
      iss: this.config.auth.issuer,
      aud: this.config.auth.audience,
      sub: parsedInput.agent.id,
      wid: parsedInput.workspaceId,
      trust_tier: parsedInput.trustTier ?? "external",
      capabilities: parsedInput.capabilities,
      metadata: parsedInput.metadata,
      iat: now,
      nbf: now - 1,
      exp: now + ttlSeconds,
      jti: randomUUID()
    };

    const payload = {
      ...claims,
      agent: parsedInput.agent
    };

    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
    const signature = this.sign("clb1", kid, payloadEncoded, secret);
    const token = `clb1.${kid}.${payloadEncoded}.${signature}`;

    return {
      token,
      token_type: "clb1",
      kid,
      issued_at: new Date(claims.iat * 1000).toISOString(),
      expires_at: new Date(claims.exp * 1000).toISOString(),
      claims
    };
  }

  private verifyToken(token: string): IdentityVerifyResult {
    const segments = token.split(".");

    if (segments.length !== 4) return {ok: false, error: "identity_token_malformed"};

    const [version, kid, payloadEncoded, signature] = segments;

    if (version !== "clb1" || !kid || !payloadEncoded || !signature) {
      return {ok: false, error: "identity_token_malformed"};
    }

    const secret = this.config.auth.keys[kid];

    if (!secret) return {ok: false, error: "identity_token_unknown_kid"};

    const expectedSignature = this.sign(version, kid, payloadEncoded, secret);

    if (!safeEqual(expectedSignature, signature)) {
      return {ok: false, error: "identity_token_invalid_signature"};
    }

    let payloadRaw = "";

    try {
      payloadRaw = base64UrlDecode(payloadEncoded);
    } catch {
      return {ok: false, error: "identity_token_invalid_payload_encoding"};
    }

    let payloadParsed: unknown;

    try {
      payloadParsed = JSON.parse(payloadRaw);
    } catch {
      return {ok: false, error: "identity_token_invalid_payload_json"};
    }

    const parsed = tokenClaimsSchema.safeParse(payloadParsed);

    if (!parsed.success) {
      this.logger.warn({issues: parsed.error.issues}, "Identity token payload schema validation failed");
      return {ok: false, error: "identity_token_invalid_claims"};
    }

    const claims = parsed.data;

    if (claims.iss !== this.config.auth.issuer) return {ok: false, error: "identity_token_issuer_mismatch"};
    if (claims.aud !== this.config.auth.audience) return {ok: false, error: "identity_token_audience_mismatch"};
    if (claims.sub !== claims.agent.id) return {ok: false, error: "identity_token_subject_mismatch"};

    const now = Math.floor(Date.now() / 1000);
    const skew = this.config.auth.clockSkewSeconds;
    const nbf = claims.nbf ?? claims.iat;

    if (claims.iat - skew > now) return {ok: false, error: "identity_token_not_yet_valid"};
    if (nbf - skew > now) return {ok: false, error: "identity_token_not_yet_valid"};
    if (claims.exp + skew < now) return {ok: false, error: "identity_token_expired"};
    if (claims.exp - claims.iat > this.config.auth.tokenMaxTtlSeconds + skew) {
      return {ok: false, error: "identity_token_ttl_exceeded"};
    }

    return {
      ok: true,
      agent: claims.agent,
      claims: {
        iss: claims.iss,
        aud: claims.aud,
        sub: claims.sub,
        wid: claims.wid,
        trust_tier: claims.trust_tier,
        capabilities: claims.capabilities,
        metadata: claims.metadata,
        iat: claims.iat,
        nbf: claims.nbf,
        exp: claims.exp,
        jti: claims.jti
      }
    };
  }

  private sign(version: string, kid: string, payloadEncoded: string, secret: string): string {
    return createHmac("sha256", secret).update(`${version}.${kid}.${payloadEncoded}`).digest("base64url");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private ensureCacheCapacity(nowMs: number): void {
    const maxEntries = this.config.auth.verifyCacheMaxEntries;

    if (this.cache.size < maxEntries) return;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAtMs <= nowMs) this.cache.delete(key);
    }

    while (this.cache.size >= maxEntries) {
      const oldestKey = this.cache.keys().next().value;

      if (!oldestKey) break;

      this.cache.delete(oldestKey);
    }
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}
