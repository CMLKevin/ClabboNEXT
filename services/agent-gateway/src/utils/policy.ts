import {AppConfig, RuntimePolicy} from "../config.js";
import {RuntimeTarget, TrustTier} from "../types.js";

const TRUST_TIER_RANK: Record<TrustTier, number> = {
  external: 1,
  partner: 2,
  internal: 3
};

export interface RuntimeDecision {
  allowed: boolean;
  reason?: string;
}

export function parseCapabilities(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return Array.from(new Set(value.map(entry => String(entry).trim()).filter(Boolean)));
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map(entry => entry.trim())
          .filter(Boolean)
      )
    );
  }

  return [];
}

export function normalizeTrustTier(raw: unknown): TrustTier {
  if (raw === "partner" || raw === "internal") return raw;

  return "external";
}

export function resolveTrustTier(rawTrustTier: unknown, internalServiceAuthorized: boolean): TrustTier {
  const requestedTier = normalizeTrustTier(rawTrustTier);

  if (!internalServiceAuthorized && requestedTier === "internal") return "external";

  return requestedTier;
}

export function clampTrustTierToIdentity(
  requestedTier: TrustTier,
  identityTier: TrustTier,
  internalServiceAuthorized: boolean
): TrustTier {
  if (internalServiceAuthorized) return requestedTier;

  if (TRUST_TIER_RANK[requestedTier] > TRUST_TIER_RANK[identityTier]) {
    return identityTier;
  }

  return requestedTier;
}

export function evaluateRuntimePolicy(
  policy: RuntimePolicy,
  runtimeTarget: RuntimeTarget,
  trustTier: TrustTier,
  requireE2BForExternal: boolean
): RuntimeDecision {
  if (policy === "all-e2b" && runtimeTarget !== "e2b") {
    return {
      allowed: false,
      reason: "runtime_policy_requires_e2b"
    };
  }

  if (policy === "internal-only" && runtimeTarget === "e2b") {
    return {
      allowed: false,
      reason: "runtime_policy_disallows_e2b"
    };
  }

  if (requireE2BForExternal && trustTier === "external" && runtimeTarget !== "e2b") {
    return {
      allowed: false,
      reason: "external_agents_must_use_e2b"
    };
  }

  return {allowed: true};
}

export function chooseRuntimeTarget(
  policy: RuntimePolicy,
  requestedTarget: RuntimeTarget | "auto",
  trustTier: TrustTier,
  requireE2BForExternal: boolean
): RuntimeTarget {
  if (requestedTarget !== "auto") return requestedTarget;

  if (policy === "all-e2b") return "e2b";
  if (policy === "internal-only") return "internal-worker";
  if (requireE2BForExternal && trustTier === "external") return "e2b";

  if (trustTier === "internal") return "internal-worker";

  return "e2b";
}

export function evaluateCapabilities(
  requestedCapabilities: string[],
  allowedCapabilities: string[]
): {granted: string[]; missing: string[]} {
  const allowedSet = new Set(allowedCapabilities);
  const granted: string[] = [];
  const missing: string[] = [];

  for (const capability of requestedCapabilities) {
    if (allowedSet.has(capability)) granted.push(capability);
    else missing.push(capability);
  }

  return {granted, missing};
}

export function computeSessionExpiration(now: Date, config: AppConfig): Date {
  return new Date(now.getTime() + config.sessionTtlSeconds * 1000);
}
