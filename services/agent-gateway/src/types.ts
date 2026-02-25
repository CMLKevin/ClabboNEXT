export type RuntimeTarget = "e2b" | "internal-worker";
export type TrustTier = "external" | "partner" | "internal";

export interface AgentIdentityStats {
  actions_executed?: number;
  workflows_executed?: number;
}

export interface AgentIdentityOwner {
  handle?: string;
  display_name?: string;
  avatar_url?: string;
  verified?: boolean;
}

export interface AgentIdentityProfile {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_at?: string;
  owner?: AgentIdentityOwner;
  stats?: AgentIdentityStats;
  metadata?: Record<string, unknown>;
}

export interface AuthContext {
  provider: "clabbo";
  requestId: string;
  workspaceId: string;
  capabilities: string[];
  trustTier: TrustTier;
  runtimeTarget: RuntimeTarget;
  agent: AgentIdentityProfile;
}

export interface SessionRecord {
  sessionId: string;
  workspaceId: string;
  requestId: string;
  runtimeTarget: RuntimeTarget;
  trustTier: TrustTier;
  capabilities: string[];
  purpose: string | null;
  metadata: Record<string, unknown>;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  agent: AgentIdentityProfile;
}

export interface AuditEvent {
  event: string;
  at: string;
  requestId: string;
  workspaceId?: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  runtimeTarget?: RuntimeTarget;
  trustTier?: TrustTier;
  allowed?: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}
