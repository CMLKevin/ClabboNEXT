import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createTestConfig} from "./helpers.js";

describe("agent gateway health routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("returns health state", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/api/agent/v1/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "clabo-agent-gateway"
    });
  });

  it("returns ready state", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/api/agent/v1/ready"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      ready: true
    });
  });
});
