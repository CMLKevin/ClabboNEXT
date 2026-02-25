import {ActionDriver, ActionDriverRequest, ActionDriverResult} from "../types.js";

export class NoopActionDriver implements ActionDriver {
  public readonly name = "noop";

  public async execute(request: ActionDriverRequest): Promise<ActionDriverResult> {
    return {
      accepted: true,
      delivery: "final",
      result: {
        simulated: true,
        execution_id: request.executionId,
        command: request.bridgeCommand,
        input: request.input
      }
    };
  }
}
