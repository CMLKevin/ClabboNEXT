import type {FastifyBaseLogger} from "fastify";
import type {Redis as RedisClient} from "ioredis";

import {AppConfig} from "../config.js";
import {ActionDriver} from "./types.js";
import {HttpBridgeActionDriver} from "./drivers/httpBridgeDriver.js";
import {NoopActionDriver} from "./drivers/noopDriver.js";
import {RedisStreamActionDriver} from "./drivers/redisStreamDriver.js";

export function createActionDriver(config: AppConfig, logger: FastifyBaseLogger, redis: RedisClient | null): ActionDriver {
  switch (config.actionDriver) {
    case "http-bridge":
      if (!config.actionBridgeUrl) return new NoopActionDriver();

      return new HttpBridgeActionDriver(
        {
          baseUrl: config.actionBridgeUrl,
          timeoutMs: config.actionBridgeTimeoutMs,
          authToken: config.actionBridgeToken
        },
        logger
      );
    case "redis-stream":
      if (!redis) return new NoopActionDriver();

      return new RedisStreamActionDriver(redis, config.actionRedisStreamKey);
    case "noop":
    default:
      return new NoopActionDriver();
  }
}
