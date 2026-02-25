import {CAPABILITY_CATALOG} from "../src/capabilities/catalog.js";
import {AppConfig} from "../src/config.js";
import {IdentityIssueResult, IdentityServiceLike, IdentityVerifyResult} from "../src/auth/identityService.js";

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    port: 8787,
    host: "127.0.0.1",
    nodeEnv: "test",
    logLevel: "silent",
    claboPublicUrl: "https://clabo.test",
    claboAppName: "Clabo",
    auth: {
      headerName: "X-Clabbo-Agent-Identity",
      issuer: "clabbo.test",
      audience: "clabbo.gateway.test",
      currentKid: "v1",
      keys: {
        v1: "test_super_secret_key_12345"
      },
      tokenMaxTtlSeconds: 3600,
      clockSkewSeconds: 30,
      verifyCacheTtlSeconds: 30,
      verifyCacheMaxEntries: 5000,
      allowTokenIssueEndpoint: true
    },
    runtimePolicy: "hybrid",
    requireE2BForExternal: true,
    allowedCapabilities: [...CAPABILITY_CATALOG],
    sessionTtlSeconds: 3600,
    replayTtlSeconds: 600,
    rateLimitMax: 200,
    rateLimitWindowSeconds: 60,
    actionDriver: "noop",
    actionBridgeTimeoutMs: 5000,
    actionRedisStreamKey: "clabo:test:stream",
    actionExecutionTtlSeconds: 3600,
    actionExecutionTimeoutMs: 10000,
    actionExecutionMaxRetries: 1,
    actionExecutionRetryBackoffMs: 50,
    actionSessionRateLimitPerMinute: 1000,
    actionRequireApprovalForHighRisk: true,
    actionMaxBatchSize: 25,
    workflowExecutionTtlSeconds: 3600,
    workflowQueueKey: "clabo:test:workflow:queue",
    workflowQueueLockSeconds: 30,
    workflowDrainMaxItems: 10,
    workflowDrainTimeBudgetMs: 5000,
    workflowAsyncEnabled: true,
    cronSecret: "cron_test_secret",
    requestExecutionBudgetMs: 240000,
    allowInMemoryStateInProduction: true,
    allowNoopActionDriverInProduction: false,
    redisUrl: undefined,
    internalServiceKey: "internal_test_secret"
  };

  return {
    ...base,
    ...overrides,
    auth: {
      ...base.auth,
      ...(overrides.auth ?? {})
    }
  };
}

export function createIdentityServiceStub(result: IdentityVerifyResult | {ok: true; agent: {id: string; name: string}}): IdentityServiceLike {
  const issueResult: IdentityIssueResult = {
    token: "clb1.v1.stub.signature",
    token_type: "clb1",
    kid: "v1",
    issued_at: new Date(0).toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    claims: {
      iss: "clabbo.test",
      aud: "clabbo.gateway.test",
      sub: "agent_stub",
      wid: "workspace-test",
      trust_tier: "external",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "stub-jti"
    }
  };

  return {
    verify: async (_token: string, expectedWorkspaceId?: string) => {
      if (!result.ok) return result;

      const now = Math.floor(Date.now() / 1000);
      const claims = "claims" in result && result.claims
        ? result.claims
        : {
            iss: "clabbo.test",
            aud: "clabbo.gateway.test",
            sub: result.agent.id,
            wid: expectedWorkspaceId ?? "workspace-test",
            trust_tier: "external" as const,
            iat: now,
            exp: now + 3600,
            jti: "stub-jti"
          };

      if (expectedWorkspaceId && claims.wid !== expectedWorkspaceId) {
        return {
          ok: false,
          error: "workspace_mismatch"
        };
      }

      return {
        ok: true,
        agent: result.agent,
        claims
      };
    },
    issue: async () => issueResult
  };
}
