---
name: clabo-external-agent-connector
description: Use when onboarding or connecting any external agent (Codex, Claude Code, OpenCode, Amp, or similar) to Clabo with secure-by-default identity, scoped permissions, and runtime isolation.
---

# Clabo External Agent Connector

Use this skill whenever an external agent needs to connect to Clabo.

## Scope

This is one unified workflow for:

- Codex
- Claude Code
- OpenCode
- Amp
- Any other external agent runtime

## Security Baseline (Do Not Skip)

1. Use short-lived access tokens only (5-15 minute TTL).
2. Bind token to one workspace (`CLABO_WORKSPACE_ID`).
3. Grant minimum capabilities only.
4. Run untrusted external agents in isolated E2B sandboxes.
5. Enforce egress allowlist and audit all actions.

Read contract first:
- `docs/agents/clabo-secure-connection-contract.md`

## Required Inputs

- Agent type (`codex`, `claude-code`, `opencode`, `amp`, `other`)
- Workspace ID
- Capability set (for example: `read_code,write_code,run_tests`)
- Clabo base URL
- Runtime target (`e2b` or `internal-worker`)

## Workflow

### Step 1: Decide runtime

- If agent is external/untrusted: use E2B.
- If internal trusted automation: internal worker runtime is allowed by policy.

### Step 2: Issue ephemeral credentials

- Mint `CLABO_ACCESS_TOKEN` from your broker.
- Set required env:
  - `CLABO_BASE_URL`
  - `CLABO_WORKSPACE_ID`
  - `CLABO_AGENT_ID`
  - `CLABO_ACCESS_TOKEN`
  - `CLABO_CAPABILITIES`

### Step 3: Run preflight

Run:

```bash
bash skills/clabo-external-agent-connector/scripts/preflight.sh
```

Expected:
- Health endpoint reachable
- Session validation successful
- Workspace and capability checks accepted

### Step 4: Apply agent-specific launch template

- For E2B use the appropriate agent template from E2B docs, then inject the same secure env variables.
- Keep launch command non-interactive and reproducible.

### Step 5: Enforce guardrails

- Reject actions outside token capabilities.
- Reject actions outside workspace scope.
- Rotate token on long-running sessions.
- Emit audit events for every mutation call.

## Agent-Specific Notes

### Codex
- Use Codex-compatible E2B template.
- Pass credentials as environment variables, never in prompt text.

### Claude Code
- Use Claude Code template and same env contract.
- Disable broad outbound network unless explicitly required.

### OpenCode
- Use OpenCode template and same env contract.
- Keep filesystem scope to assigned project path.

### Amp
- Use Amp template and same env contract.
- Require explicit capability for deployment operations.

### Other agents
- Reuse the same env contract and preflight.
- If no native E2B template exists, run inside a generic secure E2B sandbox with the same policy.

## References

- [E2B docs](https://e2b.dev/docs)
- [E2B agents](https://e2b.dev/docs/agents)
- [E2B secure access](https://e2b.dev/docs/sandbox/secure-access)
