import {FastifyBaseLogger} from "fastify";

import {ActionDriver, ActionDriverRequest, ActionDriverResult} from "../types.js";

export interface HttpBridgeDriverOptions {
  baseUrl: string;
  timeoutMs: number;
  authToken?: string;
}

export class HttpBridgeActionDriver implements ActionDriver {
  public readonly name = "http-bridge";

  constructor(
    private readonly options: HttpBridgeDriverOptions,
    private readonly logger: FastifyBaseLogger
  ) {}

  public async execute(request: ActionDriverRequest): Promise<ActionDriverResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const endpoint = `${this.options.baseUrl.replace(/\/+$/, "")}/api/hotel/actions/execute`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.authToken ? {"authorization": `Bearer ${this.options.authToken}`} : {})
        },
        body: JSON.stringify({
          execution_id: request.executionId,
          workspace_id: request.workspaceId,
          session_id: request.sessionId,
          command: request.bridgeCommand,
          input: request.input,
          metadata: request.metadata
        }),
        signal: controller.signal
      });

      const payload = await response
        .json()
        .then(value => (value && typeof value === "object" ? (value as Record<string, unknown>) : {}))
        .catch(() => ({} as Record<string, unknown>));

      if (!response.ok) {
        return {
          accepted: false,
          retryable: response.status >= 500 || response.status === 429,
          error: (payload.error as string | undefined) ?? "hotel_bridge_request_failed",
          result: payload
        };
      }

      const delivery = payload.queued === true || payload.status === "queued" ? "queued" : "final";

      return {
        accepted: true,
        delivery,
        result: payload
      };
    } catch (error) {
      this.logger.error({error, executionId: request.executionId}, "http bridge driver request failed");

      return {
        accepted: false,
        retryable: true,
        error: "hotel_bridge_unreachable"
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
