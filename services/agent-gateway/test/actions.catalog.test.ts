import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createTestConfig} from "./helpers.js";

describe("action catalog routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("returns action catalog with habbo operation definitions", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/api/agent/v1/actions/catalog"
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.actions)).toBe(true);
    expect(payload.actions.length).toBeGreaterThan(10);
    expect(payload.actions.some((action: {id: string}) => action.id === "room.user.ban")).toBe(true);
    expect(payload.actions.some((action: {id: string}) => action.id === "room.furni.multistate")).toBe(true);
  });
});
