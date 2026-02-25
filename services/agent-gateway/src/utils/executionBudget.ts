export interface ExecutionTimingConfig {
  actionExecutionTimeoutMs: number;
  actionExecutionMaxRetries: number;
  actionExecutionRetryBackoffMs: number;
  requestExecutionBudgetMs: number;
}

const MIN_FIXED_OVERHEAD_MS = 250;

export function estimateWorstCaseActionDurationMs(config: ExecutionTimingConfig): number {
  const attempts = config.actionExecutionMaxRetries + 1;
  const timeoutPortionMs = attempts * config.actionExecutionTimeoutMs;
  const minJitterPerRetryMs = Math.max(25, config.actionExecutionRetryBackoffMs);
  let retryBackoffPortionMs = 0;

  for (let retryIndex = 0; retryIndex < config.actionExecutionMaxRetries; retryIndex += 1) {
    retryBackoffPortionMs += config.actionExecutionRetryBackoffMs * 2 ** retryIndex;
    retryBackoffPortionMs += minJitterPerRetryMs;
  }

  return timeoutPortionMs + retryBackoffPortionMs + MIN_FIXED_OVERHEAD_MS;
}

export function estimateWorstCaseBatchDurationMs(config: ExecutionTimingConfig, actionCount: number): number {
  return estimateWorstCaseActionDurationMs(config) * Math.max(0, actionCount) + 500;
}

export function estimateWorstCaseWorkflowDurationMs(config: ExecutionTimingConfig, stepCount: number): number {
  return estimateWorstCaseActionDurationMs(config) * Math.max(0, stepCount) + 1000;
}

export function estimateMaxSynchronousActions(config: ExecutionTimingConfig): number {
  const perActionMs = estimateWorstCaseActionDurationMs(config);

  if (perActionMs <= 0) return 0;

  const raw = Math.floor((config.requestExecutionBudgetMs - 500) / perActionMs);

  return Math.max(1, raw);
}

export function estimateMaxSynchronousWorkflowSteps(config: ExecutionTimingConfig): number {
  const perStepMs = estimateWorstCaseActionDurationMs(config);

  if (perStepMs <= 0) return 0;

  const raw = Math.floor((config.requestExecutionBudgetMs - 1000) / perStepMs);

  return Math.max(1, raw);
}
