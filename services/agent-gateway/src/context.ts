import {FastifyBaseLogger} from "fastify";

import {IdentityServiceLike} from "./auth/identityService.js";
import {AppConfig} from "./config.js";
import {ActionExecutor} from "./actions/actionExecutor.js";
import {ReplayStore} from "./stores/ReplayStore.js";
import {SessionStore} from "./stores/SessionStore.js";
import {ActionExecutionStore} from "./stores/ActionExecutionStore.js";
import {ActionRateLimitStore} from "./stores/ActionRateLimitStore.js";
import {WorkflowExecutionStore} from "./stores/WorkflowExecutionStore.js";
import {WorkflowQueueStore} from "./workflows/WorkflowQueueStore.js";
import {AuditService} from "./utils/audit.js";
import {WorkflowExecutor} from "./workflows/workflowExecutor.js";

export interface AppContext {
  config: AppConfig;
  logger: FastifyBaseLogger;
  identityService: IdentityServiceLike;
  replayStore: ReplayStore;
  sessionStore: SessionStore;
  actionExecutionStore: ActionExecutionStore;
  actionRateLimitStore: ActionRateLimitStore;
  actionExecutor: ActionExecutor;
  workflowExecutionStore: WorkflowExecutionStore;
  workflowQueueStore: WorkflowQueueStore;
  workflowExecutor: WorkflowExecutor;
  audit: AuditService;
}
