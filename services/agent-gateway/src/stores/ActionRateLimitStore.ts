export interface ActionRateLimitDecision {
  allowed: boolean;
  count: number;
  maxAllowed: number;
  windowStart: string;
}

export interface ActionRateLimitStore {
  consume(sessionId: string, maxPerMinute: number): Promise<ActionRateLimitDecision>;
  close(): Promise<void>;
}
