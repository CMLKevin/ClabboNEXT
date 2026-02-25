import {afterEach, describe, expect, it} from "vitest";

import {buildApp} from "../src/app.js";
import {createIdentityServiceStub, createTestConfig} from "./helpers.js";

describe("workflow execution routes", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0, closers.length)) {
      await close();
    }
  });

  it("executes a catalog workflow and persists execution state", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_workflow_1",
            name: "Workflow Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "81818181-8181-8181-8181-818181818181",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        runtime_target: "e2b",
        trust_tier: "partner"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const workflowResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/workflows/execute",
      headers: {
        "x-clabo-request-id": "82828282-8282-8282-8282-828282828282",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        session_id: session.session_id,
        workflow_id: "room.onboarding.greeter",
        payload: {
          room_id: 99,
          public_welcome_text: "Welcome!",
          private_hint_text: "Need help? Ask me.",
          recipient_name: "guest",
          style_id: 0
        }
      }
    });

    expect(workflowResponse.statusCode).toBe(201);
    const workflow = workflowResponse.json();
    expect(workflow.workflow_execution.status).toBe("succeeded");
    expect(workflow.workflow_execution.steps).toHaveLength(3);
  });

  it("supports inline workflows and validates action ids", async () => {
    const {app} = await buildApp({
      config: createTestConfig(),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_workflow_2",
            name: "Inline Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "83838383-8383-8383-8383-838383838383",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        runtime_target: "e2b",
        trust_tier: "external"
      }
    });
    expect(sessionStart.statusCode).toBe(201);

    const session = sessionStart.json();
    const invalidWorkflow = await app.inject({
      method: "POST",
      url: "/api/agent/v1/workflows/execute",
      headers: {
        "x-clabo-request-id": "84848484-8484-8484-8484-848484848484",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        session_id: session.session_id,
        inline_steps: [
          {
            id: "step-one",
            action_id: "room.action.unknown",
            mode: "execute",
            halt_on_error: true,
            input: {}
          }
        ]
      }
    });

    expect(invalidWorkflow.statusCode).toBe(400);
    expect(invalidWorkflow.json()).toMatchObject({
      error: "inline_workflow_unknown_action"
    });
  });

  it("rejects workflows that exceed synchronous request budget", async () => {
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
            id: "agent_workflow_3",
            name: "Budget Workflow Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "85858585-8585-8585-8585-858585858585",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        runtime_target: "e2b",
        trust_tier: "external"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const workflowResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/workflows/execute",
      headers: {
        "x-clabo-request-id": "86868686-8686-8686-8686-868686868686",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        session_id: session.session_id,
        inline_steps: [
          {
            id: "step-one",
            action_id: "room.chat.send",
            mode: "execute",
            halt_on_error: true,
            input: {room_id: 1, text: "hello"}
          },
          {
            id: "step-two",
            action_id: "room.chat.send",
            mode: "execute",
            halt_on_error: true,
            input: {room_id: 1, text: "again"}
          }
        ]
      }
    });

    expect(workflowResponse.statusCode).toBe(409);
    expect(workflowResponse.json()).toMatchObject({
      error: "workflow_exceeds_execution_budget"
    });
  });

  it("dispatches workflows durably and drains them via internal route", async () => {
    const {app} = await buildApp({
      config: createTestConfig({
        workflowAsyncEnabled: true
      }),
      fastify: {logger: false},
      dependencies: {
        identityService: createIdentityServiceStub({
          ok: true,
          agent: {
            id: "agent_workflow_4",
            name: "Async Workflow Agent"
          }
        })
      }
    });
    closers.push(() => app.close());

    const sessionStart = await app.inject({
      method: "POST",
      url: "/api/agent/v1/session/start",
      headers: {
        "x-clabo-request-id": "87878787-8787-8787-8787-878787878787",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        runtime_target: "e2b",
        trust_tier: "partner"
      }
    });

    expect(sessionStart.statusCode).toBe(201);
    const session = sessionStart.json();

    const dispatchResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/workflows/dispatch",
      headers: {
        "x-clabo-request-id": "88888888-8888-8888-8888-888888888888",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      },
      payload: {
        workspace_id: "workspace-workflows",
        session_id: session.session_id,
        workflow_id: "room.onboarding.greeter",
        payload: {
          room_id: 200,
          public_welcome_text: "Welcome async!",
          private_hint_text: "Ask for help anytime.",
          recipient_name: "guest",
          style_id: 0
        }
      }
    });

    expect(dispatchResponse.statusCode).toBe(202);
    const dispatched = dispatchResponse.json();
    expect(dispatched.queued).toBe(true);
    expect(dispatched.workflow_execution.status).toBe("queued");

    const drainResponse = await app.inject({
      method: "POST",
      url: "/api/agent/v1/internal/workflows/drain",
      headers: {
        "x-clabo-internal-key": "internal_test_secret"
      },
      payload: {}
    });

    expect(drainResponse.statusCode).toBe(200);
    const drain = drainResponse.json();
    expect(drain.summary.processed).toBeGreaterThanOrEqual(1);

    const executionStatus = await app.inject({
      method: "GET",
      url: `/api/agent/v1/workflows/executions/${dispatched.workflow_execution.workflowExecutionId}`,
      headers: {
        "x-clabo-request-id": "89898989-8989-8989-8989-898989898989",
        "x-clabo-workspace-id": "workspace-workflows",
        "x-clabbo-agent-identity": "token-workflow"
      }
    });

    expect(executionStatus.statusCode).toBe(200);
    expect(executionStatus.json().workflow_execution.status).toBe("succeeded");
  });
});
