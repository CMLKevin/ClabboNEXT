import {describe, expect, it} from "vitest";

import {loadConfig} from "../src/config.js";

function baseProductionEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    CLABO_AUTH_KEYS: "v1:production_secret_that_is_long_enough",
    CLABO_HUMAN_PORTAL_ENABLED: "false",
    ...overrides
  };
}

describe("production readiness config guards", () => {
  it("requires redis in production by default", () => {
    expect(() => loadConfig(baseProductionEnv({CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION: "true"}))).toThrow(
      /REDIS_URL is required in production/
    );
  });

  it("requires explicit noop opt-in in production", () => {
    expect(() =>
      loadConfig(
        baseProductionEnv({
          REDIS_URL: "redis://localhost:6379",
          CLABO_ACTION_DRIVER: "noop"
        })
      )
    ).toThrow(/CLABO_ACTION_DRIVER=noop is disabled in production/);
  });

  it("requires bridge url when action driver is http-bridge", () => {
    expect(() =>
      loadConfig(
        baseProductionEnv({
          REDIS_URL: "redis://localhost:6379",
          CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION: "true",
          CLABO_ACTION_DRIVER: "http-bridge"
        })
      )
    ).toThrow(/requires CLABO_ACTION_BRIDGE_URL/);
  });

  it("loads valid production config when required dependencies are provided", () => {
    const config = loadConfig(
      baseProductionEnv({
        REDIS_URL: "redis://localhost:6379",
        CLABO_ACTION_DRIVER: "http-bridge",
        CLABO_ACTION_BRIDGE_URL: "https://bridge.clabbo.example",
        CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION: "false"
      })
    );

    expect(config.nodeEnv).toBe("production");
    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.actionDriver).toBe("http-bridge");
  });

  it("rejects workflow drain budget larger than request budget", () => {
    expect(() =>
      loadConfig(
        baseProductionEnv({
          REDIS_URL: "redis://localhost:6379",
          CLABO_ACTION_DRIVER: "http-bridge",
          CLABO_ACTION_BRIDGE_URL: "https://bridge.clabbo.example",
          CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS: "80000",
          CLABO_REQUEST_EXECUTION_BUDGET_MS: "70000"
        })
      )
    ).toThrow(/cannot exceed CLABO_REQUEST_EXECUTION_BUDGET_MS/);
  });

  it("rejects default human portal access code in production", () => {
    expect(() =>
      loadConfig(
        baseProductionEnv({
          REDIS_URL: "redis://localhost:6379",
          CLABO_ACTION_DRIVER: "http-bridge",
          CLABO_ACTION_BRIDGE_URL: "https://bridge.clabbo.example",
          CLABO_HUMAN_PORTAL_ENABLED: "true",
          CLABO_HUMAN_PORTAL_ACCESS_CODES: "clabbo-demo-access"
        })
      )
    ).toThrow(/default CLABO_HUMAN_PORTAL_ACCESS_CODES/);
  });
});
