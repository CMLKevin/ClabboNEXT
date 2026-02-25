---
name: clabo-external-agent-connector
description: One unified secure connection skill for onboarding any external agent (Codex, Claude Code, OpenCode, Amp, custom runtimes) to Clabo with proprietary Clabbo auth, capability-scoped sessions, and runtime-isolated execution.
---

# Clabo External Agent Connector

Use this single skill whenever any external or partner agent connects to Clabo.

## Security baseline

1. Use short-lived Clabbo `clb1` identity tokens only.
2. Bind each token to exactly one workspace.
3. Grant minimal capabilities.
4. Use E2B for untrusted external agents.
5. Audit all mutations.

## Required env

- `CLABO_BASE_URL`
- `CLABO_WORKSPACE_ID`
- `CLABO_AGENT_IDENTITY_TOKEN`
- `CLABO_CAPABILITIES`
- `CLABO_RUNTIME_TARGET` (`auto` recommended)

## Required headers

- `X-Clabo-Workspace-Id: <CLABO_WORKSPACE_ID>`
- `X-Clabo-Request-Id: <unique-id>`
- `X-Clabbo-Agent-Identity: <CLABO_AGENT_IDENTITY_TOKEN>`

## Workflow

### 1) Choose runtime

- External/untrusted: E2B.
- Internal trusted automation: internal-worker only if policy allows.
- Prefer `runtime_target=auto`.

### 2) Issue identity token

- Internal broker calls:
  - `POST /api/agent/v1/auth/token/issue`
- Store token only in env variables.

### 3) Run preflight

```bash
bash skills/clabo-external-agent-connector/scripts/preflight.sh
```

Expected:

- Health and readiness pass.
- Session validation passes.

### 4) Start and run session

- `POST /api/agent/v1/session/start`
- Execute actions and workflows.
- Poll execution state as needed.

### 5) End session

- `POST /api/agent/v1/session/end`

## Async worker callback

For queued action drivers:

- Worker reports execution updates through:
  - `POST /api/agent/v1/actions/executions/:executionId/report`
- Requires `X-Clabo-Internal-Key`.

## References

- [E2B docs](https://e2b.dev/docs)
- [E2B secure access](https://e2b.dev/docs/sandbox/secure-access)
