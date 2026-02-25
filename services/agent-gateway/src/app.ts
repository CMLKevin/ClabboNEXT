import {randomUUID} from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import Fastify, {FastifyInstance, FastifyServerOptions} from "fastify";
import {Redis as RedisClient} from "ioredis";

import {ActionExecutor} from "./actions/actionExecutor.js";
import {createActionDriver} from "./actions/driverFactory.js";
import {ActionDriver} from "./actions/types.js";
import {IdentityService, IdentityServiceLike} from "./auth/identityService.js";
import {loadConfig, AppConfig} from "./config.js";
import {AppContext} from "./context.js";
import {registerActionRoutes} from "./routes/actionRoutes.js";
import {registerAuthRoutes} from "./routes/authRoutes.js";
import {registerSessionRoutes} from "./routes/sessionRoutes.js";
import {registerWorkflowRoutes} from "./routes/workflowRoutes.js";
import {ActionExecutionStore} from "./stores/ActionExecutionStore.js";
import {ActionRateLimitStore} from "./stores/ActionRateLimitStore.js";
import {ReplayStore} from "./stores/ReplayStore.js";
import {SessionStore} from "./stores/SessionStore.js";
import {WorkflowExecutionStore} from "./stores/WorkflowExecutionStore.js";
import {InMemoryActionRateLimitStore, RedisActionRateLimitStore} from "./stores/actionRateLimitStores.js";
import {InMemoryActionExecutionStore, RedisActionExecutionStore} from "./stores/actionExecutionStores.js";
import {InMemoryReplayStore, InMemorySessionStore} from "./stores/memoryStores.js";
import {RedisReplayStore, RedisSessionStore} from "./stores/redisStores.js";
import {InMemoryWorkflowExecutionStore, RedisWorkflowExecutionStore} from "./stores/workflowExecutionStores.js";
import {InMemoryWorkflowQueueStore, RedisWorkflowQueueStore} from "./stores/workflowQueueStores.js";
import {AuditService} from "./utils/audit.js";
import {getRequestIdHeader} from "./utils/request.js";
import {WorkflowQueueStore} from "./workflows/WorkflowQueueStore.js";
import {WorkflowExecutor} from "./workflows/workflowExecutor.js";

interface AppDependencies {
  identityService?: IdentityServiceLike;
  replayStore?: ReplayStore;
  sessionStore?: SessionStore;
  actionExecutionStore?: ActionExecutionStore;
  actionRateLimitStore?: ActionRateLimitStore;
  workflowExecutionStore?: WorkflowExecutionStore;
  workflowQueueStore?: WorkflowQueueStore;
  actionDriver?: ActionDriver;
  actionExecutor?: ActionExecutor;
  workflowExecutor?: WorkflowExecutor;
  audit?: AuditService;
  redis?: RedisClient;
}

export interface BuildAppOptions {
  config?: AppConfig;
  fastify?: FastifyServerOptions;
  dependencies?: AppDependencies;
}

export interface BuiltApp {
  app: FastifyInstance;
  config: AppConfig;
  context: AppContext;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    trustProxy: true,
    ...options.fastify,
    logger: options.fastify?.logger ?? {level: config.logLevel}
  });

  const dependencies = options.dependencies ?? {};
  const redis =
    dependencies.redis ??
    (config.redisUrl ? new RedisClient(config.redisUrl, {maxRetriesPerRequest: 2, lazyConnect: false}) : null);
  const ownsRedis = !dependencies.redis && !!redis;

  if (redis) {
    redis.on("error", error => {
      app.log.error({error}, "redis client error");
    });
  }

  const replayStore = dependencies.replayStore ?? (redis ? new RedisReplayStore(redis) : new InMemoryReplayStore());
  const sessionStore = dependencies.sessionStore ?? (redis ? new RedisSessionStore(redis) : new InMemorySessionStore());
  const actionExecutionStore = dependencies.actionExecutionStore ?? (redis ? new RedisActionExecutionStore(redis) : new InMemoryActionExecutionStore());
  const actionRateLimitStore = dependencies.actionRateLimitStore ?? (redis ? new RedisActionRateLimitStore(redis) : new InMemoryActionRateLimitStore());
  const workflowExecutionStore =
    dependencies.workflowExecutionStore ?? (redis ? new RedisWorkflowExecutionStore(redis) : new InMemoryWorkflowExecutionStore());
  const workflowQueueStore =
    dependencies.workflowQueueStore ?? (redis ? new RedisWorkflowQueueStore(redis, config.workflowQueueKey) : new InMemoryWorkflowQueueStore());
  const identityService = dependencies.identityService ?? new IdentityService(config, app.log);
  const audit = dependencies.audit ?? new AuditService(app.log);
  const actionDriver = dependencies.actionDriver ?? createActionDriver(config, app.log, redis);
  const actionExecutor = dependencies.actionExecutor ?? new ActionExecutor(config, actionDriver, actionExecutionStore, actionRateLimitStore, audit);
  const workflowExecutor = dependencies.workflowExecutor ?? new WorkflowExecutor(config, actionExecutor, workflowExecutionStore, audit);

  const context: AppContext = {
    config,
    logger: app.log,
    identityService,
    replayStore,
    sessionStore,
    actionExecutionStore,
    actionRateLimitStore,
    actionExecutor,
    workflowExecutionStore,
    workflowQueueStore,
    workflowExecutor,
    audit
  };

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: `${config.rateLimitWindowSeconds} seconds`,
    keyGenerator: request => {
      const workspaceId = (request.headers["x-clabo-workspace-id"] as string | undefined) ?? "unknown-workspace";

      return `${request.ip}:${workspaceId}`;
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const existingRequestId = getRequestIdHeader(request);
    const requestId = existingRequestId && existingRequestId.trim().length ? existingRequestId : randomUUID();

    request.headers["x-clabo-request-id"] = requestId;
    reply.header("x-clabo-request-id", requestId);
  });

  app.get("/api/agent/v1/health", async () => ({
    ok: true,
    service: "clabo-agent-gateway",
    now: new Date().toISOString()
  }));

  app.get("/api/agent/v1/ready", async (request, reply) => {
    try {
      if (redis) {
        await redis.ping();
      }

      return {
        ok: true,
        ready: true,
        redis: !!redis,
        state_backend: redis ? "redis" : "memory",
        request_budget_ms: config.requestExecutionBudgetMs
      };
    } catch (error) {
      request.log.error({error}, "readiness check failed");

      return reply.code(503).send({
        ok: true,
        ready: false,
        redis: !!redis,
        state_backend: redis ? "redis" : "memory"
      });
    }
  });

  await registerAuthRoutes(app, context);
  await registerSessionRoutes(app, context);
  await registerActionRoutes(app, context);
  await registerWorkflowRoutes(app, context);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({error: "not_found"});
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({error}, "uncaught request error");

    if (reply.sent) return;

    reply.code(500).send({error: "internal_error"});
  });

  app.addHook("onClose", async () => {
    await replayStore.close();
    await sessionStore.close();
    await actionExecutionStore.close();
    await actionRateLimitStore.close();
    await workflowExecutionStore.close();
    await workflowQueueStore.close();

    if (ownsRedis && redis) {
      await redis.quit();
    }
  });

  return {
    app,
    config,
    context
  };
}

// Compatibility export for platform builders that expect a default Fastify app export.
export default async function createFastifyAppForPlatform(): Promise<FastifyInstance> {
  const {app} = await buildApp();

  return app;
}
