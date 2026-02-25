import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createIdentityServiceStub, createTestConfig} from "./helpers.js";

function extractCookieValue(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;
  const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!first) return null;

  return first.split(";")[0] ?? null;
}

describe("portal routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("allows login and profile fetch for a human player", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_portal_test",
            name: "Portal Test Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/portal/v1/login",
      payload: {
        player_name: "HotelHuman",
        access_code: "portal-test-access",
        workspace_id: "workspace-test"
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    const cookie = extractCookieValue(loginResponse.headers["set-cookie"]);
    expect(cookie).toBeTruthy();

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/portal/v1/me",
      headers: {
        cookie: cookie ?? ""
      }
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      player_name: "HotelHuman",
      workspace_id: "workspace-test",
      trust_tier: "external"
    });
  });

  it("starts, checks, and ends runtime session through portal auth", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/portal/v1/login",
      payload: {
        player_name: "Runner",
        access_code: "portal-test-access",
        workspace_id: "workspace-test"
      }
    });
    const cookie = extractCookieValue(loginResponse.headers["set-cookie"]) ?? "";

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/portal/v1/session/start",
      headers: {
        cookie
      },
      payload: {
        runtime_target: "auto",
        purpose: "play test"
      }
    });

    expect(startResponse.statusCode).toBe(201);
    expect(startResponse.json()).toMatchObject({
      success: true,
      runtime_target: "e2b",
      trust_tier: "external"
    });
    const startedSessionId = startResponse.json().session_id as string;

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/portal/v1/session/status?session_id=${startedSessionId}`,
      headers: {
        cookie
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      success: true,
      session_id: startedSessionId,
      workspace_id: "workspace-test"
    });

    const endResponse = await app.inject({
      method: "POST",
      url: "/api/portal/v1/session/end",
      headers: {
        cookie
      },
      payload: {
        session_id: startedSessionId,
        reason: "session complete"
      }
    });

    expect(endResponse.statusCode).toBe(200);
    expect(endResponse.json()).toMatchObject({
      success: true,
      session_id: startedSessionId
    });
  });

  it("rejects invalid access code", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/portal/v1/login",
      payload: {
        player_name: "WrongCodeUser",
        access_code: "wrong-access-code",
        workspace_id: "workspace-test"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "access_code_invalid"
    });
  });
});
