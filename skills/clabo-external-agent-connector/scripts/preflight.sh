#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  "CLABO_BASE_URL"
  "CLABO_WORKSPACE_ID"
  "CLABO_AGENT_IDENTITY_TOKEN"
  "CLABO_CAPABILITIES"
)

for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: ${key}" >&2
    exit 1
  fi
done

base_url="${CLABO_BASE_URL%/}"
runtime_target="${CLABO_RUNTIME_TARGET:-auto}"
trust_tier="${CLABO_TRUST_TIER:-external}"

common_headers=(
  -H "X-Clabbo-Agent-Identity: ${CLABO_AGENT_IDENTITY_TOKEN}"
  -H "X-Clabo-Workspace-Id: ${CLABO_WORKSPACE_ID}"
)

echo "Checking health endpoint..."
curl -fsS \
  "${common_headers[@]}" \
  -H "X-Clabo-Request-Id: preflight-health-$(date +%s)-$$" \
  "${base_url}/api/agent/v1/health" >/dev/null

echo "Checking readiness endpoint..."
curl -fsS \
  "${common_headers[@]}" \
  -H "X-Clabo-Request-Id: preflight-ready-$(date +%s)-$$" \
  "${base_url}/api/agent/v1/ready" >/dev/null

echo "Validating session..."
curl -fsS "${common_headers[@]}" \
  -H "X-Clabo-Request-Id: preflight-validate-$(date +%s)-$$" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "{\"workspace_id\":\"${CLABO_WORKSPACE_ID}\",\"capabilities\":\"${CLABO_CAPABILITIES}\",\"runtime_target\":\"${runtime_target}\",\"trust_tier\":\"${trust_tier}\"}" \
  "${base_url}/api/agent/v1/session/validate" >/dev/null

echo "Preflight passed for workspace '${CLABO_WORKSPACE_ID}' with runtime target '${runtime_target}' and trust tier '${trust_tier}'."
