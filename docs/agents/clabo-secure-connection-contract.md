# Clabo Secure External Agent Connection Contract

## Purpose

Define one secure, reusable contract for any external coding agent connecting to Clabo.

## Required Security Controls

1. **Ephemeral identity only**
   - Agents receive short-lived access tokens (recommended TTL: 5-15 minutes).
   - No long-lived static API keys inside prompts, sandboxes, or repos.
2. **Workspace-scoped authorization**
   - Every token is bound to exactly one `workspace_id`.
   - Cross-workspace operations are rejected by default.
3. **Least-privilege capabilities**
   - Capabilities are explicit (`read_code`, `write_code`, `run_tests`, `deploy_preview`).
   - Write/deploy scopes are opt-in, never default.
4. **Egress restrictions**
   - Runtime egress is allowlisted (Clabo API + required package registries only).
   - Direct arbitrary outbound networking is blocked unless policy allows it.
5. **Auditability**
   - All tool calls and mutations include: `agent_id`, `workspace_id`, `request_id`, `trace_id`.

## Runtime Guidance

- Untrusted external agents run in isolated E2B sandboxes.
- Trusted internal automations may use pooled workers if policy allows.
- Both runtime types must use the same token and capability contract.

## Required Environment Variables

- `CLABO_BASE_URL`
- `CLABO_WORKSPACE_ID`
- `CLABO_AGENT_ID`
- `CLABO_ACCESS_TOKEN`
- `CLABO_CAPABILITIES` (comma-separated)

## Minimum API Handshake

1. Agent performs health check:
   - `GET /api/agent/v1/health`
2. Agent validates session:
   - `POST /api/agent/v1/session/validate`
3. Agent starts work session:
   - `POST /api/agent/v1/session/start`

All authenticated requests use:

- `Authorization: Bearer <CLABO_ACCESS_TOKEN>`
- `X-Clabo-Workspace-Id: <CLABO_WORKSPACE_ID>`
- `X-Clabo-Agent-Id: <CLABO_AGENT_ID>`
- `X-Clabo-Request-Id: <unique-id>`

## Failure Policy

- Invalid or expired token: hard fail, request fresh token from broker.
- Missing capability: hard fail, do not auto-escalate.
- Workspace mismatch: hard fail and audit event.
- Sandbox compromise suspicion: revoke token + terminate runtime.
