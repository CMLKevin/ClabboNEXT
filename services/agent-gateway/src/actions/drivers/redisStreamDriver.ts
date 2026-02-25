import type {Redis as RedisClient} from "ioredis";

import {ActionDriver, ActionDriverRequest, ActionDriverResult} from "../types.js";

export class RedisStreamActionDriver implements ActionDriver {
  public readonly name = "redis-stream";

  constructor(
    private readonly redis: RedisClient,
    private readonly streamKey: string
  ) {}

  public async execute(request: ActionDriverRequest): Promise<ActionDriverResult> {
    try {
      const streamId = await this.redis.xadd(
        this.streamKey,
        "*",
        "execution_id",
        request.executionId,
        "workspace_id",
        request.workspaceId,
        "session_id",
        request.sessionId,
        "action_id",
        request.actionId,
        "bridge_command",
        request.bridgeCommand,
        "input",
        JSON.stringify(request.input),
        "metadata",
        JSON.stringify(request.metadata)
      );

      return {
        accepted: true,
        delivery: "queued",
        result: {
          stream_key: this.streamKey,
          stream_id: streamId,
          queued: true
        }
      };
    } catch (error) {
      return {
        accepted: false,
        retryable: true,
        error: error instanceof Error ? error.message : "redis_stream_enqueue_failed"
      };
    }
  }
}
