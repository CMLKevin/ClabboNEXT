# Clabbo Maximal Adaptation (Clabbo Auth-Inspired, Vercel-Ready) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Clabbo into a scalable, secure, production-ready platform by separating Vercel control-plane concerns from persistent game websocket/data-plane concerns, while hardening netcode/chat/actions and finishing external-agent integration.

**Architecture:** Build a dual-plane architecture. Plane A runs on Vercel (static Nitro delivery, agent gateway, auth/session policy, audit API, observability hooks). Plane B runs on persistent infra (Arcturus websocket, MySQL-adjacent services, CMS). Add a policy-driven execution broker so external agents authenticate via Clabbo Auth, receive capability-scoped session grants, and are routed to E2B or internal workers by trust tier.

**Tech Stack:** TypeScript (Fastify, Zod, ioredis, Vitest), Nitro renderer patching, Docker Compose (persistent services), Vercel deployment primitives, E2B runtime for untrusted agents.

---

## Skill sequencing for implementation

1. `@writing-plans` (this document already created)
2. `@vercel-cli` (deployment wiring and rollout)
3. `@playwright` (smoke/E2E flows for chat/session UX)
4. `@security-best-practices` (TypeScript hardening pass for gateway and browser bridge)

---

### Task 1: Finish Agent Gateway Bootstrap and Runtime Wiring

**Files:**
- Create: `services/agent-gateway/src/server.ts`
- Create: `services/agent-gateway/src/app.ts`
- Modify: `services/agent-gateway/package.json`
- Test: `services/agent-gateway/test/server.health.test.ts`

**Step 1: Write the failing test**

```ts
import {describe, expect, it} from "vitest";
import {buildApp} from "../src/app.js";

describe("health endpoint", () => {
  it("returns healthy", async () => {
    const app = await buildApp();
    const res = await app.inject({method: "GET", url: "/api/agent/v1/health"});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ok: true});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/agent-gateway run test -- test/server.health.test.ts`
Expected: FAIL with missing `buildApp` and/or missing route.

**Step 3: Write minimal implementation**

```ts
// src/app.ts
import Fastify from "fastify";
export async function buildApp() {
  const app = Fastify({logger: true});
  app.get("/api/agent/v1/health", async () => ({ok: true, service: "agent-gateway"}));
  return app;
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/agent-gateway run test -- test/server.health.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/app.ts services/agent-gateway/src/server.ts services/agent-gateway/test/server.health.test.ts services/agent-gateway/package.json
git commit -m "feat(agent-gateway): bootstrap runnable fastify service with health route"
```

---

### Task 2: Fix Redis Types and Add Store Contract Tests

**Files:**
- Modify: `services/agent-gateway/src/stores/redisStores.ts`
- Create: `services/agent-gateway/test/stores.redis.test.ts`
- Test: `services/agent-gateway/test/stores.redis.test.ts`

**Step 1: Write the failing test**

```ts
import {describe, expect, it} from "vitest";
describe("redis stores typing", () => {
  it("typechecks redis store constructors", () => {
    expect(true).toBe(true);
  });
});
```

**Step 2: Run test/typecheck to verify it fails**

Run: `npm --prefix services/agent-gateway run typecheck`
Expected: FAIL on `Cannot use namespace 'Redis' as a type`.

**Step 3: Write minimal implementation**

```ts
import Redis from "ioredis";
type RedisClient = Redis;
```

Apply consistently to constructor types and add null-safe JSON parse guards.

**Step 4: Run test/typecheck to verify it passes**

Run:
- `npm --prefix services/agent-gateway run typecheck`
- `npm --prefix services/agent-gateway run test -- test/stores.redis.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/stores/redisStores.ts services/agent-gateway/test/stores.redis.test.ts
git commit -m "fix(agent-gateway): repair redis typing and validate store contracts"
```

---

### Task 3: Harden Clabbo Auth Identity Verification Client

**Files:**
- Modify: `services/agent-gateway/src/auth/clabbo-authClient.ts`
- Modify: `services/agent-gateway/src/auth/identityService.ts`
- Create: `services/agent-gateway/test/auth.clabbo-auth.test.ts`
- Test: `services/agent-gateway/test/auth.clabbo-auth.test.ts`

**Step 1: Write the failing test**

```ts
it("rejects malformed verify payload and returns provider_unexpected_response", async () => {
  // mock fetch with malformed json body
  // expect client.verifyIdentity(...) to produce valid=false + expected error key
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/agent-gateway run test -- test/auth.clabbo-auth.test.ts`
Expected: FAIL due current missing branch coverage and retry strategy.

**Step 3: Write minimal implementation**

```ts
// add bounded retry for transient 5xx/429 with jitter
// keep strict zod payload validation
// preserve explicit error taxonomy for callers
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/agent-gateway run test -- test/auth.clabbo-auth.test.ts`
Expected: PASS with stable deterministic mocks.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/auth/clabbo-authClient.ts services/agent-gateway/src/auth/identityService.ts services/agent-gateway/test/auth.clabbo-auth.test.ts
git commit -m "feat(agent-gateway): harden clabbo-auth verification with strict error taxonomy"
```

---

### Task 4: Implement Policy Plugin, Request Context, and Auth Guards

**Files:**
- Modify: `services/agent-gateway/src/routes/sessionRoutes.ts`
- Create: `services/agent-gateway/src/plugins/authContext.ts`
- Create: `services/agent-gateway/test/routes.session.validate.test.ts`
- Test: `services/agent-gateway/test/routes.session.validate.test.ts`

**Step 1: Write the failing test**

```ts
it("returns 403 when external agent requests internal-worker and policy requires e2b", async () => {
  // assert error external_agents_must_use_e2b
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/agent-gateway run test -- test/routes.session.validate.test.ts`
Expected: FAIL before plugin/route integration is complete.

**Step 3: Write minimal implementation**

```ts
// register preHandler that enforces:
// - request id
// - workspace header
// - replay protection
// - clabbo-auth identity verification
// - trust-tier + runtime policy resolution
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/agent-gateway run test -- test/routes.session.validate.test.ts`
Expected: PASS with allowed and denied policy matrix scenarios.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/plugins/authContext.ts services/agent-gateway/src/routes/sessionRoutes.ts services/agent-gateway/test/routes.session.validate.test.ts
git commit -m "feat(agent-gateway): enforce policy guardrails and validated session handshake"
```

---

### Task 5: Add Domain Capability Model for Game/Chat/Moderation Actions

**Files:**
- Modify: `services/agent-gateway/src/config.ts`
- Create: `services/agent-gateway/src/capabilities/catalog.ts`
- Create: `services/agent-gateway/src/capabilities/mapping.ts`
- Create: `services/agent-gateway/test/capabilities.mapping.test.ts`
- Test: `services/agent-gateway/test/capabilities.mapping.test.ts`

**Step 1: Write the failing test**

```ts
it("maps room.mod.kick to required trust tier and runtime constraints", () => {
  // expect capability metadata to enforce elevated trust requirements
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/agent-gateway run test -- test/capabilities.mapping.test.ts`
Expected: FAIL since domain capability catalog does not exist yet.

**Step 3: Write minimal implementation**

```ts
export const CAPABILITIES = {
  "room.chat.send": {...},
  "room.chat.whisper": {...},
  "room.mod.kick": {...},
  "room.mod.mute": {...},
  "room.mod.ban": {...},
  "room.furni.place": {...},
  "room.furni.move": {...}
} as const;
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/agent-gateway run test -- test/capabilities.mapping.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/capabilities services/agent-gateway/src/config.ts services/agent-gateway/test/capabilities.mapping.test.ts
git commit -m "feat(agent-gateway): add game-domain capability catalog and validation mapping"
```

---

### Task 6: Build Runtime Broker Interface (E2B vs Internal Worker)

**Files:**
- Create: `services/agent-gateway/src/runtime/runtimeBroker.ts`
- Create: `services/agent-gateway/src/runtime/e2bBroker.ts`
- Create: `services/agent-gateway/src/runtime/internalBroker.ts`
- Create: `services/agent-gateway/test/runtime.broker.test.ts`
- Test: `services/agent-gateway/test/runtime.broker.test.ts`

**Step 1: Write the failing test**

```ts
it("routes untrusted external sessions to e2b broker", async () => {
  // expect broker target e2b for external trust tier
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/agent-gateway run test -- test/runtime.broker.test.ts`
Expected: FAIL before broker abstraction is implemented.

**Step 3: Write minimal implementation**

```ts
export interface RuntimeBroker {
  provision(session: SessionRecord): Promise<{runtimeId: string; target: "e2b" | "internal-worker"}>;
}
```

Implement policy-bound routing + typed stubs for E2B/internal adapters.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/agent-gateway run test -- test/runtime.broker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/agent-gateway/src/runtime services/agent-gateway/test/runtime.broker.test.ts
git commit -m "feat(agent-gateway): add trust-tier runtime broker abstraction"
```

---

### Task 7: Netcode Reconnect State Corrections and Regression Tests

**Files:**
- Modify: `vendor/nitro/libs/renderer/src/core/communication/SocketConnection.ts`
- Modify: `nitro/patches/0001-netcode-reconnect-and-buffer-hardening.patch`
- Create: `vendor/nitro/libs/renderer/src/core/communication/__tests__/SocketConnection.reconnect.test.ts`
- Test: `vendor/nitro/libs/renderer/src/core/communication/__tests__/SocketConnection.reconnect.test.ts`

**Step 1: Write the failing test**

```ts
it("resets readiness/auth state when a new socket is initialized", () => {
  // simulate close -> reconnect -> assert _isReady reset semantics via public behavior
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix vendor/nitro run test -- SocketConnection.reconnect.test.ts`
Expected: FAIL due readiness lifecycle drift.

**Step 3: Write minimal implementation**

```ts
// on createSocket/onClose:
// - reset _isReady for fresh handshake lifecycle
// - clear pending server/client queues on hard reconnect boundaries as needed
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix vendor/nitro run test -- SocketConnection.reconnect.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add vendor/nitro/libs/renderer/src/core/communication/SocketConnection.ts nitro/patches/0001-netcode-reconnect-and-buffer-hardening.patch vendor/nitro/libs/renderer/src/core/communication/__tests__/SocketConnection.reconnect.test.ts
git commit -m "fix(netcode): correct reconnect readiness lifecycle and protect message queues"
```

---

### Task 8: Chat Correctness and Render Performance Hardening

**Files:**
- Modify: `vendor/nitro/apps/frontend/src/hooks/rooms/widgets/useChatWidget.ts`
- Modify: `vendor/nitro/apps/frontend/src/components/room/widgets/chat/ChatWidgetView.tsx`
- Modify: `vendor/nitro/apps/frontend/src/hooks/events/useMessageEvent.tsx`
- Create: `vendor/nitro/apps/frontend/src/hooks/rooms/widgets/__tests__/useChatWidget.behavior.test.ts`
- Test: `vendor/nitro/apps/frontend/src/hooks/rooms/widgets/__tests__/useChatWidget.behavior.test.ts`

**Step 1: Write the failing test**

```ts
it("uses correct localization key and target user for pet fertilize chat events", () => {
  // verify text key and user source selection are correct
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix vendor/nitro run test -- useChatWidget.behavior.test.ts`
Expected: FAIL for current key/index bug.

**Step 3: Write minimal implementation**

```ts
// fix key typo: widget.chatbubble.petrefertilized
// use newRoomObject/event.extraParam user lookup
// replace in-place state mutations with immutable updates
// introduce stable handler refs in event hooks where needed
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix vendor/nitro run test -- useChatWidget.behavior.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add vendor/nitro/apps/frontend/src/hooks/rooms/widgets/useChatWidget.ts vendor/nitro/apps/frontend/src/components/room/widgets/chat/ChatWidgetView.tsx vendor/nitro/apps/frontend/src/hooks/events/useMessageEvent.tsx vendor/nitro/apps/frontend/src/hooks/rooms/widgets/__tests__/useChatWidget.behavior.test.ts nitro/patches/0001-netcode-reconnect-and-buffer-hardening.patch
git commit -m "fix(chat): correct event mapping and remove mutable render-path updates"
```

---

### Task 9: Legacy External Interface Security Hardening

**Files:**
- Modify: `vendor/nitro/libs/renderer/src/nitro/externalInterface/LegacyExternalInterface.ts`
- Modify: `nitro/example-renderer-config.json`
- Create: `vendor/nitro/libs/renderer/src/nitro/externalInterface/__tests__/LegacyExternalInterface.security.test.ts`
- Test: `vendor/nitro/libs/renderer/src/nitro/externalInterface/__tests__/LegacyExternalInterface.security.test.ts`

**Step 1: Write the failing test**

```ts
it("rejects postMessage from untrusted origins", () => {
  // expect no callback execution for disallowed origin
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix vendor/nitro run test -- LegacyExternalInterface.security.test.ts`
Expected: FAIL because origin checks are not enforced.

**Step 3: Write minimal implementation**

```ts
// enforce allowlisted origins from config
// replace "*" targetOrigin with computed trusted origin(s)
// require strict message envelope validation
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix vendor/nitro run test -- LegacyExternalInterface.security.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add vendor/nitro/libs/renderer/src/nitro/externalInterface/LegacyExternalInterface.ts vendor/nitro/libs/renderer/src/nitro/externalInterface/__tests__/LegacyExternalInterface.security.test.ts nitro/example-renderer-config.json nitro/patches/0001-netcode-reconnect-and-buffer-hardening.patch
git commit -m "feat(security): lock legacy external interface to trusted origins"
```

---

### Task 10: Add Vercel Control Plane Project and Config

**Files:**
- Create: `apps/control-plane/package.json`
- Create: `apps/control-plane/vercel.json`
- Create: `apps/control-plane/README.md`
- Modify: `README.md`
- Test: `apps/control-plane/README.md` (manual deploy checklist)

**Step 1: Write the failing test/check**

```bash
vercel --cwd apps/control-plane --prod --yes --token $VERCEL_TOKEN
```

Expected initial state: FAIL because project/config does not exist.

**Step 2: Run command to verify it fails**

Run with `@vercel-cli` workflow in non-interactive mode.

**Step 3: Write minimal implementation**

```json
{
  "functions": {"api/**/*.ts": {"memory": 1024}},
  "headers": [{"source": "/(.*)", "headers": [{"key": "x-frame-options", "value": "SAMEORIGIN"}]}]
}
```

Include rewrites for agent API endpoints and explicit environment variable requirements.

**Step 4: Run deploy command to verify it passes**

Run:
- `vercel --cwd apps/control-plane --yes`
- `vercel --cwd apps/control-plane --prod --yes`

Expected: successful preview + production deploy records.

**Step 5: Commit**

```bash
git add apps/control-plane README.md
git commit -m "feat(deploy): add vercel control-plane project scaffolding and ops docs"
```

---

### Task 11: Split Persistent Data Plane Deployment Manifests

**Files:**
- Create: `deploy/persistent/compose.game.yaml`
- Create: `deploy/persistent/compose.cms.yaml`
- Create: `deploy/persistent/README.md`
- Modify: `compose.yaml`
- Test: `deploy/persistent/README.md` (smoke command matrix)

**Step 1: Write the failing check**

Run: `docker compose -f deploy/persistent/compose.game.yaml config`
Expected: FAIL because split manifests do not exist.

**Step 2: Run check to verify it fails**

Execute command above and capture parser failure.

**Step 3: Write minimal implementation**

```yaml
# compose.game.yaml
services:
  arcturus: ...
  db: ...
  assets: ...
```

Move persistent services into explicit data-plane manifests.

**Step 4: Run check to verify it passes**

Run:
- `docker compose -f deploy/persistent/compose.game.yaml config`
- `docker compose -f deploy/persistent/compose.cms.yaml config`

Expected: valid composed configs.

**Step 5: Commit**

```bash
git add deploy/persistent compose.yaml
git commit -m "refactor(infra): split persistent data-plane manifests from control-plane concerns"
```

---

### Task 12: End-to-End Validation, Load Tests, and Rollout Playbook

**Files:**
- Create: `docs/plans/rollout-validation-checklist.md`
- Create: `scripts/load/chat-soak.mjs`
- Create: `scripts/load/session-broker-soak.mjs`
- Modify: `README.md`
- Test: `scripts/load/*.mjs` + smoke tests

**Step 1: Write the failing validation checklist item**

```md
- [ ] sustain 2,000 chat events/min in a test room without client FPS collapse
- [ ] reconnect storm recovers within configured backoff window
- [ ] policy denies all out-of-scope capability requests
```

**Step 2: Run load scripts to verify initial failure/baseline**

Run:
- `node scripts/load/chat-soak.mjs`
- `node scripts/load/session-broker-soak.mjs`

Expected: baseline report with at least one unmet SLO before tuning.

**Step 3: Write minimal implementation**

```js
// emit percentile latency, reconnect success ratio, dropped message ratio
// generate JSON + markdown report artifacts
```

**Step 4: Re-run to verify pass thresholds**

Run scripts again with tuned configs; attach report under `artifacts/load/`.
Expected: all required rollout gates meet target thresholds.

**Step 5: Commit**

```bash
git add docs/plans/rollout-validation-checklist.md scripts/load README.md
git commit -m "chore(release): add soak tests and deployment validation playbook"
```

---

## Production rollout gates (must pass before full cutover)

1. Agent gateway test suite green (`typecheck`, `unit`, route integration).
2. Nitro patch regression suite green (netcode reconnect + chat correctness + bridge security).
3. Preview deploy green on Vercel control-plane.
4. Persistent plane smoke checks green.
5. Soak test thresholds pass for chat throughput, reconnect recovery, and policy enforcement.

## Non-negotiable architecture decisions

1. Keep Arcturus websocket server on persistent infrastructure (not Vercel Functions).
2. Use Vercel for control-plane + static frontend delivery + observability integration.
3. Route untrusted external agents to E2B by default; only allow internal-worker for trusted tiers.
4. Enforce workspace-scoped capability tokens and replay-safe request IDs on every agent API call.

