import {createHmac, timingSafeEqual} from "node:crypto";

import {TrustTier} from "../types.js";

const PORTAL_SESSION_SCHEME = "clbhs1";

export interface HumanPortalSessionClaims {
  sid: string;
  player_name: string;
  workspace_id: string;
  trust_tier: TrustTier;
  capabilities: string[];
  iat: number;
  exp: number;
}

export interface HumanPortalSessionIssueInput {
  sid: string;
  playerName: string;
  workspaceId: string;
  trustTier: TrustTier;
  capabilities: string[];
  ttlSeconds: number;
  now?: Date;
}

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload<T>(encoded: string): T | null {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function issueHumanPortalSessionToken(input: HumanPortalSessionIssueInput, secret: string): {token: string; claims: HumanPortalSessionClaims} {
  const now = input.now ?? new Date();
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + input.ttlSeconds;
  const claims: HumanPortalSessionClaims = {
    sid: input.sid,
    player_name: input.playerName,
    workspace_id: input.workspaceId,
    trust_tier: input.trustTier,
    capabilities: input.capabilities,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds
  };
  const encodedPayload = encodePayload(claims);
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${PORTAL_SESSION_SCHEME}.${encodedPayload}.${signature}`,
    claims
  };
}

export function verifyHumanPortalSessionToken(token: string, secret: string, now: Date = new Date()): HumanPortalSessionClaims | null {
  const [scheme, encodedPayload, signature] = token.split(".");

  if (scheme !== PORTAL_SESSION_SCHEME) return null;
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload, secret);

  if (!secureStringEquals(signature, expectedSignature)) return null;

  const claims = decodePayload<HumanPortalSessionClaims>(encodedPayload);
  if (!claims) return null;
  if (!claims.sid || !claims.player_name || !claims.workspace_id) return null;
  if (!claims.iat || !claims.exp || claims.exp <= claims.iat) return null;
  if (!Array.isArray(claims.capabilities)) return null;
  if (claims.trust_tier !== "external" && claims.trust_tier !== "partner" && claims.trust_tier !== "internal") return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (claims.exp <= nowSeconds) return null;

  return claims;
}
