import {z} from "zod";

import {DEFAULT_CAPABILITIES} from "./capabilities/catalog.js";
import {estimateWorstCaseActionDurationMs} from "./utils/executionBudget.js";

const runtimePolicySchema = z.enum(["hybrid", "all-e2b", "internal-only"]);
const actionDriverSchema = z.enum(["noop", "http-bridge", "redis-stream"]);

const envSchema = z.object({
  PORT: z.string().default("8787").transform(Number).pipe(z.number().int().min(1).max(65535)),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  CLABO_PUBLIC_URL: z.string().url().default("https://clabo.example.com"),
  CLABO_APP_NAME: z.string().min(1).default("Clabo"),

  CLABO_AUTH_HEADER_NAME: z.string().default("X-Clabbo-Agent-Identity"),
  CLABO_AUTH_ISSUER: z.string().min(1).default("clabbo.identity"),
  CLABO_AUTH_AUDIENCE: z.string().min(1).default("clabbo.agent-gateway"),
  CLABO_AUTH_CURRENT_KID: z.string().regex(/^[a-zA-Z0-9_.-]{1,32}$/).default("v1"),
  CLABO_AUTH_KEYS: z.string().default("v1:clabbo_dev_secret_change_me"),
  CLABO_AUTH_TOKEN_MAX_TTL_SECONDS: z
    .string()
    .default("3600")
    .transform(Number)
    .pipe(z.number().int().min(60).max(86400)),
  CLABO_AUTH_CLOCK_SKEW_SECONDS: z
    .string()
    .default("30")
    .transform(Number)
    .pipe(z.number().int().min(0).max(300)),
  CLABO_AUTH_VERIFY_CACHE_TTL_SECONDS: z
    .string()
    .default("30")
    .transform(Number)
    .pipe(z.number().int().min(0).max(600)),
  CLABO_AUTH_VERIFY_CACHE_MAX_ENTRIES: z
    .string()
    .default("5000")
    .transform(Number)
    .pipe(z.number().int().min(100).max(100000)),
  CLABO_AUTH_ALLOW_TOKEN_ISSUE_ENDPOINT: z
    .string()
    .default("false")
    .transform(value => value === "true"),

  CLABO_RUNTIME_POLICY: runtimePolicySchema.default("hybrid"),
  CLABO_REQUIRE_E2B_FOR_EXTERNAL: z
    .string()
    .default("true")
    .transform(value => value === "true"),
  CLABO_ALLOWED_CAPABILITIES: z.string().default(DEFAULT_CAPABILITIES.join(",")),
  CLABO_SESSION_TTL_SECONDS: z
    .string()
    .default("3600")
    .transform(Number)
    .pipe(z.number().int().min(60).max(86400)),
  CLABO_INTERNAL_SERVICE_KEY: z.string().optional(),

  CLABO_REPLAY_TTL_SECONDS: z
    .string()
    .default("600")
    .transform(Number)
    .pipe(z.number().int().min(30).max(86400)),
  CLABO_RATE_LIMIT_MAX: z
    .string()
    .default("120")
    .transform(Number)
    .pipe(z.number().int().min(10).max(10000)),
  CLABO_RATE_LIMIT_WINDOW_SECONDS: z
    .string()
    .default("60")
    .transform(Number)
    .pipe(z.number().int().min(1).max(3600)),

  CLABO_ACTION_DRIVER: actionDriverSchema.default("noop"),
  CLABO_ACTION_BRIDGE_URL: z.string().url().optional(),
  CLABO_ACTION_BRIDGE_TIMEOUT_MS: z
    .string()
    .default("5000")
    .transform(Number)
    .pipe(z.number().int().min(250).max(60000)),
  CLABO_ACTION_BRIDGE_TOKEN: z.string().optional(),
  CLABO_ACTION_REDIS_STREAM_KEY: z.string().default("clabo:actions:stream"),
  CLABO_ACTION_EXECUTION_TTL_SECONDS: z
    .string()
    .default("86400")
    .transform(Number)
    .pipe(z.number().int().min(300).max(2592000)),
  CLABO_ACTION_EXECUTION_TIMEOUT_MS: z
    .string()
    .default("15000")
    .transform(Number)
    .pipe(z.number().int().min(500).max(120000)),
  CLABO_ACTION_EXECUTION_MAX_RETRIES: z
    .string()
    .default("2")
    .transform(Number)
    .pipe(z.number().int().min(0).max(10)),
  CLABO_ACTION_EXECUTION_RETRY_BACKOFF_MS: z
    .string()
    .default("300")
    .transform(Number)
    .pipe(z.number().int().min(25).max(5000)),
  CLABO_ACTION_SESSION_RATE_LIMIT_PER_MINUTE: z
    .string()
    .default("180")
    .transform(Number)
    .pipe(z.number().int().min(10).max(20000)),
  CLABO_ACTION_REQUIRE_APPROVAL_FOR_HIGH_RISK: z
    .string()
    .default("true")
    .transform(value => value === "true"),
  CLABO_ACTION_MAX_BATCH_SIZE: z
    .string()
    .default("25")
    .transform(Number)
    .pipe(z.number().int().min(1).max(200)),
  CLABO_WORKFLOW_EXECUTION_TTL_SECONDS: z
    .string()
    .default("86400")
    .transform(Number)
    .pipe(z.number().int().min(300).max(2592000)),
  CLABO_WORKFLOW_QUEUE_KEY: z.string().default("clabo:workflow:queue"),
  CLABO_WORKFLOW_QUEUE_LOCK_SECONDS: z
    .string()
    .default("120")
    .transform(Number)
    .pipe(z.number().int().min(15).max(3600)),
  CLABO_WORKFLOW_DRAIN_MAX_ITEMS: z
    .string()
    .default("12")
    .transform(Number)
    .pipe(z.number().int().min(1).max(500)),
  CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS: z
    .string()
    .default("25000")
    .transform(Number)
    .pipe(z.number().int().min(1000).max(300000)),
  CLABO_WORKFLOW_ASYNC_ENABLED: z
    .string()
    .default("true")
    .transform(value => value === "true"),
  CRON_SECRET: z.string().optional(),
  CLABO_REQUEST_EXECUTION_BUDGET_MS: z
    .string()
    .default("240000")
    .transform(Number)
    .pipe(z.number().int().min(5000).max(900000)),
  CLABO_ALLOW_IN_MEMORY_STATE_IN_PRODUCTION: z
    .string()
    .default("false")
    .transform(value => value === "true"),
  CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION: z
    .string()
    .default("false")
    .transform(value => value === "true"),

  REDIS_URL: z.string().url().optional()
});

export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;
export type ActionDriver = z.infer<typeof actionDriverSchema>;

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  claboPublicUrl: string;
  claboAppName: string;
  auth: {
    headerName: string;
    issuer: string;
    audience: string;
    currentKid: string;
    keys: Record<string, string>;
    tokenMaxTtlSeconds: number;
    clockSkewSeconds: number;
    verifyCacheTtlSeconds: number;
    verifyCacheMaxEntries: number;
    allowTokenIssueEndpoint: boolean;
  };
  runtimePolicy: RuntimePolicy;
  requireE2BForExternal: boolean;
  allowedCapabilities: string[];
  sessionTtlSeconds: number;
  internalServiceKey?: string;
  replayTtlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  actionDriver: ActionDriver;
  actionBridgeUrl?: string;
  actionBridgeTimeoutMs: number;
  actionBridgeToken?: string;
  actionRedisStreamKey: string;
  actionExecutionTtlSeconds: number;
  actionExecutionTimeoutMs: number;
  actionExecutionMaxRetries: number;
  actionExecutionRetryBackoffMs: number;
  actionSessionRateLimitPerMinute: number;
  actionRequireApprovalForHighRisk: boolean;
  actionMaxBatchSize: number;
  workflowExecutionTtlSeconds: number;
  workflowQueueKey: string;
  workflowQueueLockSeconds: number;
  workflowDrainMaxItems: number;
  workflowDrainTimeBudgetMs: number;
  workflowAsyncEnabled: boolean;
  cronSecret?: string;
  requestExecutionBudgetMs: number;
  allowInMemoryStateInProduction: boolean;
  allowNoopActionDriverInProduction: boolean;
  redisUrl?: string;
}

function parseCapabilities(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
    )
  );
}

function parseAuthKeys(raw: string): Record<string, string> {
  const entries = raw
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(pair => {
      const separatorIndex = pair.indexOf(":");

      if (separatorIndex <= 0 || separatorIndex === pair.length - 1) {
        throw new Error(`Invalid CLABO_AUTH_KEYS entry '${pair}'. Use kid:secret format.`);
      }

      const kid = pair.slice(0, separatorIndex).trim();
      const secret = pair.slice(separatorIndex + 1).trim();

      if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(kid)) throw new Error(`Invalid auth key id '${kid}'.`);
      if (secret.length < 16) throw new Error(`Auth key '${kid}' is too short. Use at least 16 characters.`);

      return [kid, secret] as const;
    });

  if (!entries.length) throw new Error("CLABO_AUTH_KEYS cannot be empty");

  return Object.fromEntries(entries);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedCapabilities = parseCapabilities(parsed.CLABO_ALLOWED_CAPABILITIES);
  const authKeys = parseAuthKeys(parsed.CLABO_AUTH_KEYS);

  if (!allowedCapabilities.length) throw new Error("CLABO_ALLOWED_CAPABILITIES cannot be empty");
  if (!authKeys[parsed.CLABO_AUTH_CURRENT_KID]) {
    throw new Error(`CLABO_AUTH_CURRENT_KID '${parsed.CLABO_AUTH_CURRENT_KID}' is missing from CLABO_AUTH_KEYS`);
  }

  if (parsed.NODE_ENV === "production" && parsed.CLABO_AUTH_KEYS.includes("clabbo_dev_secret_change_me")) {
    throw new Error("Refusing to start in production with default CLABO_AUTH_KEYS secret");
  }
  if (parsed.CLABO_ACTION_DRIVER === "http-bridge" && !parsed.CLABO_ACTION_BRIDGE_URL) {
    throw new Error("CLABO_ACTION_DRIVER=http-bridge requires CLABO_ACTION_BRIDGE_URL");
  }
  if (parsed.CLABO_ACTION_DRIVER === "redis-stream" && !parsed.REDIS_URL) {
    throw new Error("CLABO_ACTION_DRIVER=redis-stream requires REDIS_URL");
  }
  if (
    parsed.NODE_ENV === "production" &&
    !parsed.REDIS_URL &&
    !parsed.CLABO_ALLOW_IN_MEMORY_STATE_IN_PRODUCTION
  ) {
    throw new Error(
      "REDIS_URL is required in production for replay/session/action stores. Set CLABO_ALLOW_IN_MEMORY_STATE_IN_PRODUCTION=true only for non-critical environments."
    );
  }
  if (
    parsed.NODE_ENV === "production" &&
    parsed.CLABO_ACTION_DRIVER === "noop" &&
    !parsed.CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION
  ) {
    throw new Error(
      "CLABO_ACTION_DRIVER=noop is disabled in production by default. Set CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION=true only for dry-run environments."
    );
  }

  const worstCaseActionDurationMs = estimateWorstCaseActionDurationMs({
    actionExecutionTimeoutMs: parsed.CLABO_ACTION_EXECUTION_TIMEOUT_MS,
    actionExecutionMaxRetries: parsed.CLABO_ACTION_EXECUTION_MAX_RETRIES,
    actionExecutionRetryBackoffMs: parsed.CLABO_ACTION_EXECUTION_RETRY_BACKOFF_MS,
    requestExecutionBudgetMs: parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS
  });

  if (worstCaseActionDurationMs > parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS) {
    throw new Error(
      `Request budget too small: worst-case action (${worstCaseActionDurationMs}ms) exceeds CLABO_REQUEST_EXECUTION_BUDGET_MS (${parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS}ms)`
    );
  }
  if (parsed.CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS > parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS) {
    throw new Error(
      `CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS (${parsed.CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS}ms) cannot exceed CLABO_REQUEST_EXECUTION_BUDGET_MS (${parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS}ms)`
    );
  }

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    claboPublicUrl: parsed.CLABO_PUBLIC_URL,
    claboAppName: parsed.CLABO_APP_NAME,
    auth: {
      headerName: parsed.CLABO_AUTH_HEADER_NAME,
      issuer: parsed.CLABO_AUTH_ISSUER,
      audience: parsed.CLABO_AUTH_AUDIENCE,
      currentKid: parsed.CLABO_AUTH_CURRENT_KID,
      keys: authKeys,
      tokenMaxTtlSeconds: parsed.CLABO_AUTH_TOKEN_MAX_TTL_SECONDS,
      clockSkewSeconds: parsed.CLABO_AUTH_CLOCK_SKEW_SECONDS,
      verifyCacheTtlSeconds: parsed.CLABO_AUTH_VERIFY_CACHE_TTL_SECONDS,
      verifyCacheMaxEntries: parsed.CLABO_AUTH_VERIFY_CACHE_MAX_ENTRIES,
      allowTokenIssueEndpoint: parsed.CLABO_AUTH_ALLOW_TOKEN_ISSUE_ENDPOINT
    },
    runtimePolicy: parsed.CLABO_RUNTIME_POLICY,
    requireE2BForExternal: parsed.CLABO_REQUIRE_E2B_FOR_EXTERNAL,
    allowedCapabilities,
    sessionTtlSeconds: parsed.CLABO_SESSION_TTL_SECONDS,
    internalServiceKey: parsed.CLABO_INTERNAL_SERVICE_KEY,
    replayTtlSeconds: parsed.CLABO_REPLAY_TTL_SECONDS,
    rateLimitMax: parsed.CLABO_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: parsed.CLABO_RATE_LIMIT_WINDOW_SECONDS,
    actionDriver: parsed.CLABO_ACTION_DRIVER,
    actionBridgeUrl: parsed.CLABO_ACTION_BRIDGE_URL,
    actionBridgeTimeoutMs: parsed.CLABO_ACTION_BRIDGE_TIMEOUT_MS,
    actionBridgeToken: parsed.CLABO_ACTION_BRIDGE_TOKEN,
    actionRedisStreamKey: parsed.CLABO_ACTION_REDIS_STREAM_KEY,
    actionExecutionTtlSeconds: parsed.CLABO_ACTION_EXECUTION_TTL_SECONDS,
    actionExecutionTimeoutMs: parsed.CLABO_ACTION_EXECUTION_TIMEOUT_MS,
    actionExecutionMaxRetries: parsed.CLABO_ACTION_EXECUTION_MAX_RETRIES,
    actionExecutionRetryBackoffMs: parsed.CLABO_ACTION_EXECUTION_RETRY_BACKOFF_MS,
    actionSessionRateLimitPerMinute: parsed.CLABO_ACTION_SESSION_RATE_LIMIT_PER_MINUTE,
    actionRequireApprovalForHighRisk: parsed.CLABO_ACTION_REQUIRE_APPROVAL_FOR_HIGH_RISK,
    actionMaxBatchSize: parsed.CLABO_ACTION_MAX_BATCH_SIZE,
    workflowExecutionTtlSeconds: parsed.CLABO_WORKFLOW_EXECUTION_TTL_SECONDS,
    workflowQueueKey: parsed.CLABO_WORKFLOW_QUEUE_KEY,
    workflowQueueLockSeconds: parsed.CLABO_WORKFLOW_QUEUE_LOCK_SECONDS,
    workflowDrainMaxItems: parsed.CLABO_WORKFLOW_DRAIN_MAX_ITEMS,
    workflowDrainTimeBudgetMs: parsed.CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS,
    workflowAsyncEnabled: parsed.CLABO_WORKFLOW_ASYNC_ENABLED,
    cronSecret: parsed.CRON_SECRET,
    requestExecutionBudgetMs: parsed.CLABO_REQUEST_EXECUTION_BUDGET_MS,
    allowInMemoryStateInProduction: parsed.CLABO_ALLOW_IN_MEMORY_STATE_IN_PRODUCTION,
    allowNoopActionDriverInProduction: parsed.CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION,
    redisUrl: parsed.REDIS_URL
  };
}
