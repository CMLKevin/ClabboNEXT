import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createTestConfig} from "./helpers.js";

describe("clabbo auth routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("issues and introspects proprietary clb1 identity tokens", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
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
        }
      }),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const issue = await app.inject({
      method: "POST",
      url: "/api/agent/v1/auth/token/issue",
      headers: {
        "x-clabo-request-id": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
        "x-clabo-workspace-id": "workspace-auth",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-auth",
        trust_tier: "partner",
        capabilities: ["room.chat.send"],
        agent: {
          id: "agent_auth_1",
          name: "Auth Agent"
        }
      }
    });

    expect(issue.statusCode).toBe(201);
    const issued = issue.json();
    expect(issued.token_type).toBe("clb1");
    expect(typeof issued.token).toBe("string");
    expect(issued.token.split(".")).toHaveLength(4);

    const introspect = await app.inject({
      method: "POST",
      url: "/api/agent/v1/auth/token/introspect",
      headers: {
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        token: issued.token,
        workspace_id: "workspace-auth"
      }
    });

    expect(introspect.statusCode).toBe(200);
    expect(introspect.json()).toMatchObject({
      valid: true
    });
  });

  it("uses issued token for session validation without external identity provider", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
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
        }
      }),
      fastify: {logger: false}
    });
    closers.push(() => app.close());

    const issue = await app.inject({
      method: "POST",
      url: "/api/agent/v1/auth/token/issue",
      headers: {
        "x-clabo-request-id": "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1",
        "x-clabo-workspace-id": "workspace-auth",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-auth",
        trust_tier: "external",
        capabilities: ["room.chat.send"],
        agent: {
          id: "agent_auth_2",
          name: "Session Agent"
        }
      }
    });
    expect(issue.statusCode).toBe(201);
    const token = issue.json().token;

    const validate = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/validate",
      headers: {
        "x-clabo-request-id": "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1",
        "x-clabo-workspace-id": "workspace-auth",
        "x-clabbo-agent-identity": token
      },
      payload: {
        workspace_id: "workspace-auth",
        runtime_target: "auto",
        capabilities: ["room.chat.send"]
      }
    });

    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({
      valid: true,
      provider: "clabbo"
    });
  });
});
