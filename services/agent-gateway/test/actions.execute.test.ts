import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {ActionDriver} from "../src/actions/types.js";
import {createIdentityServiceStub, createTestConfig} from "./helpers.js";

describe("action execution routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("executes and idempotently replays a low-risk room action", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        actionRequireApprovalForHighRisk: true
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_actions_1",
            name: "Action Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        runtime_target: "e2b",
        trust_tier: "partner"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const executeResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.chat.send",
        idempotency_key: "action-1",
        mode: "execute",
        input: {
          room_id: 123,
          text: "hello hotel"
        }
      }
    });

    expect(executeResponse.statusCode).toBe(201);
    const created = executeResponse.json();
    expect(created.success).toBe(true);
    expect(created.execution.status).toBe("succeeded");

    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.chat.send",
        idempotency_key: "action-1",
        mode: "execute",
        input: {
          room_id: 123,
          text: "hello hotel"
        }
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    const replay = replayResponse.json();
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.execution.executionId).toBe(created.execution.executionId);
  });

  it("requires approval for high-risk actions when configured", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        actionRequireApprovalForHighRisk: true
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_actions_2",
            name: "Risk Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-actions",
        runtime_target: "e2b",
        trust_tier: "internal"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const executeResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.user.ban",
        idempotency_key: "risk-action",
        mode: "execute",
        input: {
          room_id: 123,
          user_id: 9,
          ban_type: "perm"
        }
      }
    });

    expect(executeResponse.statusCode).toBe(409);
    expect(executeResponse.json()).toMatchObject({
      error: "human_approval_required"
    });
  });

  it("tracks queued execution and allows internal status reporting", async () => {
    const queuedDriver: ActionDriver = {
      name: "test-queued-driver",
      async execute() {
        return {
          accepted: true,
          delivery: "queued",
          result: {queued: true}
        };
      }
    };

    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        actionDriver: queuedDriver,
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_actions_3",
            name: "Queue Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "12121212-1212-1212-1212-121212121212",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        runtime_target: "e2b",
        trust_tier: "partner"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const queuedResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "13131313-1313-1313-1313-131313131313",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.chat.send",
        input: {
          room_id: 10,
          text: "queued"
        }
      }
    });

    expect(queuedResponse.statusCode).toBe(201);
    const queued = queuedResponse.json();
    expect(queued.execution.status).toBe("queued");

    const reportResponse = await app.inject({
      method: "POST",
      url: `/api/agent/v1/actions/executions/${queued.execution.executionId}/report`,
      headers: {
        "x-clabo-request-id": "14141414-1414-1414-1414-141414141414",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {
        workspace_id: "workspace-actions",
        status: "succeeded",
        result: {
          bridge_result: "ok"
        }
      }
    });

    expect(reportResponse.statusCode).toBe(202);
    expect(reportResponse.json().execution.status).toBe("succeeded");
  });

  it("enforces per-session action rate limits", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        actionSessionRateLimitPerMinute: 1
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_actions_4",
            name: "Rate Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "15151515-1515-1515-1515-151515151515",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        runtime_target: "e2b",
        trust_tier: "external"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const first = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "16161616-1616-1616-1616-161616161616",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.chat.send",
        idempotency_key: "rate-1",
        input: {
          room_id: 2,
          text: "first"
        }
      }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/execute",
      headers: {
        "x-clabo-request-id": "17171717-1717-1717-1717-171717171717",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        action_id: "room.chat.send",
        idempotency_key: "rate-2",
        input: {
          room_id: 2,
          text: "second"
        }
      }
    });

    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      error: "action_rate_limit_exceeded"
    });
  });

  it("rejects batches that exceed the synchronous request budget", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        actionExecutionTimeoutMs: 1000,
        actionExecutionMaxRetries: 0,
        actionExecutionRetryBackoffMs: 50,
        requestExecutionBudgetMs: 1600
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_actions_5",
            name: "Budget Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "18181818-1818-1818-1818-181818181818",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        runtime_target: "e2b",
        trust_tier: "external"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const batchResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/actions/batch",
      headers: {
        "x-clabo-request-id": "19191919-1919-1919-1919-191919191919",
        "x-clabo-workspace-id": "workspace-actions",
        "x-clabbo-agent-identity": "token-actions"
      },
      payload: {
        workspace_id: "workspace-actions",
        session_id: session.session_id,
        actions: [
          {
            action_id: "room.chat.send",
            input: {room_id: 1, text: "one"}
          },
          {
            action_id: "room.chat.send",
            input: {room_id: 1, text: "two"}
          }
        ]
      }
    });

    expect(batchResponse.statusCode).toBe(409);
    expect(batchResponse.json()).toMatchObject({
      error: "batch_exceeds_execution_budget"
    });
  });
});
