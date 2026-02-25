import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createIdentityServiceStub, createTestConfig} from "./helpers.js";

const defaultHeaders = {
  "x-clabo-request-id": "11111111-1111-1111-1111-111111111111",
  "x-clabo-workspace-id": "workspace-test",
  "x-clabbo-agent-identity": "token-test"
};

describe("session routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("rejects external agents using internal-worker when e2b is required", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_1",
            name: "Test Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/validate",
      headers: defaultHeaders,
      payload: {
        workspace_id: "workspace-test",
        runtime_target: "internal-worker",
        trust_tier: "external",
        capabilities: ["room.chat.send"]
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "external_agents_must_use_e2b",
      valid: false
    });
  });

  it("starts, checks, and ends a valid e2b session", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_2",
            name: "Starter Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "22222222-2222-2222-2222-222222222222"
      },
      payload: {
        workspace_id: "workspace-test",
        runtime_target: "e2b",
        trust_tier: "external",
        capabilities: ["room.chat.send"],
        purpose: "test lifecycle"
      }
    });

    expect(startResponse.statusCode).toBe(201);
    const started = startResponse.json();
    expect(started.success).toBe(true);
    expect(started.session_id).toBeTypeOf("string");

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/agent/v1/session/status?session_id=${started.session_id}`,
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "33333333-3333-3333-3333-333333333333"
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      success: true,
      session_id: started.session_id,
      workspace_id: "workspace-test"
    });

    const endResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/end",
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "44444444-4444-4444-4444-444444444444"
      },
      payload: {
        workspace_id: "workspace-test",
        session_id: started.session_id,
        reason: "complete"
      }
    });

    expect(endResponse.statusCode).toBe(200);
    expect(endResponse.json()).toMatchObject({
      success: true,
      session_id: started.session_id
    });
  });

  it("resolves runtime_target=auto based on trust and policy", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        requireE2BForExternal: true
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_3",
            name: "Auto Runtime Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const externalValidate = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/validate",
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "55555555-5555-5555-5555-555555555555"
      },
      payload: {
        workspace_id: "workspace-test",
        runtime_target: "auto",
        trust_tier: "external",
        capabilities: ["room.chat.send"]
      }
    });

    expect(externalValidate.statusCode).toBe(200);
    expect(externalValidate.json()).toMatchObject({
      runtime_target: "e2b"
    });

    const internalValidate = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/validate",
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "66666666-6666-6666-6666-666666666666",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-test",
        runtime_target: "auto",
        trust_tier: "internal",
        capabilities: ["room.chat.send"]
      }
    });

    expect(internalValidate.statusCode).toBe(200);
    expect(internalValidate.json()).toMatchObject({
      runtime_target: "internal-worker"
    });
  });

  it("clamps requested trust tier to signed identity trust tier", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_4",
            name: "Tier Clamp Agent"
          },
          claims: {
            iss: "clabbo.test",
            aud: "clabbo.gateway.test",
            sub: "agent_4",
            wid: "workspace-test",
            trust_tier: "external",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            jti: "clamp-test-jti"
          }
        })
      }
    });
    closers.push(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/validate",
      headers: {
        ...defaultHeaders,
        "x-clabo-request-id": "77777777-7777-7777-7777-777777777777"
      },
      payload: {
        workspace_id: "workspace-test",
        runtime_target: "auto",
        trust_tier: "partner",
        capabilities: ["room.chat.send"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      trust_tier: "external"
    });
  });
});
