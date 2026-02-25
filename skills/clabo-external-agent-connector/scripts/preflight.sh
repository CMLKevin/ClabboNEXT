#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  "CLABO_BASE_URL"
  "CLABO_WORKSPACE_ID"
  "CLABO_AGENT_ID"
  "CLABO_ACCESS_TOKEN"
  "CLABO_CAPABILITIES"
)

for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: ${key}" >&2
    exit 1
  fi
done

base_url="${CLABO_BASE_URL%/}"
request_id="preflight-$(date +%s)-$$"

common_headers=(
  -H "Authorization: Bearer ${CLABO_ACCESS_TOKEN}"
  -H "X-Clabo-Workspace-Id: ${CLABO_WORKSPACE_ID}"
  -H "X-Clabo-Agent-Id: ${CLABO_AGENT_ID}"
  -H "X-Clabo-Request-Id: ${request_id}"
)

echo "Checking health endpoint..."
curl -fsS "${common_headers[@]}" "${base_url}/api/agent/v1/health" >/dev/null

echo "Validating session..."
curl -fsS "${common_headers[@]}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "{\"workspace_id\":\"${CLABO_WORKSPACE_ID}\",\"capabilities\":\"${CLABO_CAPABILITIES}\"}" \
  "${base_url}/api/agent/v1/session/validate" >/dev/null

echo "Preflight passed for agent '${CLABO_AGENT_ID}' in workspace '${CLABO_WORKSPACE_ID}'."
