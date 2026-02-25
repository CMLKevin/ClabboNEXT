# Clabo Secure External Agent Connection Contract

## Purpose

Define one secure, reusable contract for any external agent connecting to Clabo for sessions, actions, and workflows.

## Required Security Controls

1. Proprietary Clabbo identity tokens only
   - Use short-lived `clb1` tokens signed by Clabbo-controlled keys.
   - Never embed long-lived static secrets in prompts or repos.
2. Workspace-scoped authorization
   - Each token is bound to exactly one `workspace_id` claim.
   - Cross-workspace requests are rejected.
3. Least-privilege capabilities
   - Capability scopes are explicit and auditable.
4. Mutation replay protection
   - Mutation routes require unique `X-Clabo-Request-Id`.
5. Auditability
   - All session/action/workflow mutation paths emit audit events.

## Runtime Guidance

- Untrusted external agents: E2B sandbox runtime.
- Trusted internal automation: internal-worker runtime if policy allows.
- Prefer `runtime_target=auto` so gateway policy resolves target.

## Required Environment Variables

- `CLABO_BASE_URL`
- `CLABO_WORKSPACE_ID`
- `CLABO_CAPABILITIES`
- `CLABO_AGENT_IDENTITY_TOKEN`
- `CLABO_REQUEST_ID`

## Required Headers

- `X-Clabo-Workspace-Id: <CLABO_WORKSPACE_ID>`
- `X-Clabo-Request-Id: <unique-id>`
- `X-Clabbo-Agent-Identity: <CLABO_AGENT_IDENTITY_TOKEN>`

Optional internal header:

- `X-Clabo-Internal-Key: <internal-service-key>`

## Minimum API Handshake

1. `GET /api/agent/v1/health`
2. `GET /api/agent/v1/ready`
3. `POST /api/agent/v1/session/validate`
4. `POST /api/agent/v1/session/start`
5. `GET /api/agent/v1/session/status?session_id=<id>`
6. `POST /api/agent/v1/session/end`

## Auth Operations

- `GET /api/agent/v1/auth/config`
- `POST /api/agent/v1/auth/token/issue` (internal key + enabled setting)
- `POST /api/agent/v1/auth/token/introspect` (internal key)

## Token Format

- Scheme: `clb1`
- Structure: `clb1.<kid>.<payload>.<signature>`
- Signature: HMAC-SHA256 over `version.kid.payload`

## Failure Policy

- Invalid token signature/claims: hard fail.
- Missing capability: hard fail.
- Workspace mismatch: hard fail and audit.
- Session owner mismatch: hard fail unless internal key is authorized.
