# Clabo Agent Gateway

Policy-driven external agent ingress for Clabo with proprietary Clabbo auth (`clb1` token scheme), scoped sessions, action execution controls, and workflow orchestration.

## Core endpoints

- `GET /api/agent/v1/health`
- `GET /api/agent/v1/ready`
- `GET /portal` (human browser portal)
- `GET /api/portal/v1/config`
- `POST /api/portal/v1/login`
- `POST /api/portal/v1/logout`
- `GET /api/portal/v1/me`
- `POST /api/portal/v1/session/start`
- `GET /api/portal/v1/session/status?session_id=<uuid>`
- `POST /api/portal/v1/session/end`
- `GET /api/agent/v1/auth/config`
- `POST /api/agent/v1/auth/token/issue` (internal key required, optional by config)
- `POST /api/agent/v1/auth/token/introspect` (internal key required)
- `POST /api/agent/v1/session/validate`
- `POST /api/agent/v1/session/start`
- `GET /api/agent/v1/session/status?session_id=<uuid>`
- `POST /api/agent/v1/session/end`

## Action endpoints

- `GET /api/agent/v1/actions/catalog`
- `POST /api/agent/v1/actions/execute`
- `POST /api/agent/v1/actions/batch`
- `GET /api/agent/v1/actions/executions/:executionId`
- `POST /api/agent/v1/actions/executions/:executionId/report` (internal key required)

## Workflow endpoints

- `GET /api/agent/v1/workflows/catalog`
- `POST /api/agent/v1/workflows/execute`
- `POST /api/agent/v1/workflows/dispatch` (durable async queue)
- `GET /api/agent/v1/workflows/executions/:workflowExecutionId`
- `POST /api/agent/v1/internal/workflows/drain` (internal key or cron secret)
- `GET /api/agent/v1/internal/workflows/cron` (cron secret)

## Local run

```bash
npm install
npm run typecheck
npm run test
npm run dev
```

## Vercel deployment

```bash
vercel
vercel --prod
```

Before `--prod`, set your Vercel project Root Directory to `services/agent-gateway` and configure required production env vars.

## Auth environment variables

- `CLABO_PUBLIC_URL`
- `CLABO_APP_NAME`
- `CLABO_HUMAN_PORTAL_ENABLED`
- `CLABO_HUMAN_PORTAL_TITLE`
- `CLABO_HUMAN_PORTAL_GAME_URL`
- `CLABO_HUMAN_PORTAL_ALLOW_EMBED`
- `CLABO_HUMAN_PORTAL_ACCESS_CODES`
- `CLABO_HUMAN_PORTAL_DEFAULT_WORKSPACE_ID`
- `CLABO_HUMAN_PORTAL_ALLOWED_WORKSPACE_IDS`
- `CLABO_HUMAN_PORTAL_SESSION_TTL_SECONDS`
- `CLABO_HUMAN_PORTAL_COOKIE_NAME`
- `CLABO_HUMAN_PORTAL_SESSION_SECRET`
- `CLABO_HUMAN_PORTAL_ISSUED_TRUST_TIER`
- `CLABO_HUMAN_PORTAL_ISSUED_CAPABILITIES`
- `CLABO_AUTH_HEADER_NAME`
- `CLABO_AUTH_ISSUER`
- `CLABO_AUTH_AUDIENCE`
- `CLABO_AUTH_CURRENT_KID`
- `CLABO_AUTH_KEYS` (comma list, `kid:secret`)
- `CLABO_AUTH_TOKEN_MAX_TTL_SECONDS`
- `CLABO_AUTH_CLOCK_SKEW_SECONDS`
- `CLABO_AUTH_VERIFY_CACHE_TTL_SECONDS`
- `CLABO_AUTH_VERIFY_CACHE_MAX_ENTRIES`
- `CLABO_AUTH_ALLOW_TOKEN_ISSUE_ENDPOINT`
- `CLABO_REQUEST_EXECUTION_BUDGET_MS`
- `CLABO_ALLOW_IN_MEMORY_STATE_IN_PRODUCTION`
- `CLABO_ALLOW_NOOP_ACTION_DRIVER_IN_PRODUCTION`
- `REDIS_URL`
- `UPSTASH_REDIS_REST_URL` (optional compatibility env for REST workers/tooling)
- `UPSTASH_REDIS_REST_TOKEN` (optional compatibility env for REST workers/tooling)
- `CLABO_WORKFLOW_QUEUE_KEY`
- `CLABO_WORKFLOW_QUEUE_LOCK_SECONDS`
- `CLABO_WORKFLOW_DRAIN_MAX_ITEMS`
- `CLABO_WORKFLOW_DRAIN_TIME_BUDGET_MS`
- `CLABO_WORKFLOW_ASYNC_ENABLED`
- `CRON_SECRET`
- `E2B_API_KEY` (for downstream E2B worker runtimes)
- `CLABO_E2B_API_KEY` (alias for broker/worker compatibility)

## Notes

- Human portal uses invite-code login and signed HTTP-only cookies.
- In production, default portal code `clabbo-demo-access` is rejected at startup.
- Set `CLABO_HUMAN_PORTAL_GAME_URL` to the Nitro/game client origin so users can launch gameplay.
- Default auth header: `X-Clabbo-Agent-Identity`
- Token format: `clb1.<kid>.<payload>.<signature>`
- Use unique `X-Clabo-Request-Id` for mutation routes.
- In production, `REDIS_URL` is required by default for cross-instance consistency.
- Large batch/workflow runs are rejected if they exceed the configured synchronous request budget.
- Use `POST /workflows/dispatch` for long-running workflows; cron/drain endpoints process queued jobs durably.
