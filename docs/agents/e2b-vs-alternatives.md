# Clabo Agent Runtime Decision: E2B Per-Agent vs Alternatives

## Executive Decision

Use a **hybrid runtime strategy**:

1. Run **external and untrusted agents** in isolated E2B sandboxes (one sandbox per active agent task or session).
2. Run **trusted internal automation** on a pooled in-house worker platform (Kubernetes + gVisor/Kata, or Nomad + microVM workers) when cost and throughput matter more than strict tenant isolation.

This gives us better security than a single shared runner while avoiding the cost overhead of putting every tiny internal job into its own E2B box.

## Why E2B Is Strong For External Agents

E2B gives Clabo a consistent, disposable execution environment with strong blast-radius control and operational ergonomics:

- Agent-specific templates for Codex, Claude Code, OpenCode, and Amp.
- Secure access model with challenge/response and proxy controls.
- Disposable sessions, controlled file system and process space, and clearer audit boundaries.
- Good fit for unknown third-party prompts, arbitrary code execution, and toolchains that we do not fully trust.

## Where E2B-Per-Agent Is Not Always Optimal

For high-volume, low-risk background work (trusted first-party jobs), full per-agent sandboxing can become expensive and slower to scale:

- Startup and warmup overhead for every job.
- Higher per-task runtime cost.
- Harder to optimize for extreme throughput workloads where tasks are homogeneous and trusted.

## Alternatives Considered

### Alternative A: Shared Multi-Tenant Worker Fleet

- Best for: trusted internal workloads with strict SLO and cost sensitivity.
- Security profile: weaker tenant isolation than per-sandbox unless heavily hardened.
- Required controls: namespace isolation, syscall filtering, egress policies, signed workload identity.

### Alternative B: In-House MicroVM Pool

- Best for: regulated workloads needing stronger isolation than plain containers.
- Security profile: strong isolation, but higher operational burden than managed sandboxing.
- Tradeoff: more control, more infrastructure ownership.

### Alternative C: All Agents On E2B

- Best for: maximum simplicity in security posture and strict isolation.
- Tradeoff: higher spend and potentially lower throughput efficiency for trusted internal batch workloads.

## Recommended Architecture For Clabo

### Trust Tiering

- Tier 0 (untrusted/external agents): mandatory E2B.
- Tier 1 (partner-managed but contract-bound): E2B by default, with exception process.
- Tier 2 (trusted internal agents): pooled worker runtime allowed.

### Control Plane Requirements

- Central broker issues short-lived credentials (no static agent secrets).
- All agents call Clabo through a narrow agent gateway API.
- Tool permissions are scope-based and workspace-bound.
- Egress allowlists enforced per runtime.
- Full audit events for tool calls and file mutations.

### Rollout

1. Start with E2B for all external agents.
2. Collect cost/latency telemetry for 2 weeks.
3. Move only selected Tier 2 jobs to pooled runtime.
4. Keep incident rollback path: any workflow can be forced back to E2B.

## Reference Links

- [E2B Docs](https://e2b.dev/docs)
- [E2B Agent templates](https://e2b.dev/docs/agents)
- [E2B secure access](https://e2b.dev/docs/sandbox/secure-access)
- [E2B proxy tunneling](https://e2b.dev/docs/sandbox/proxy-tunneling)
