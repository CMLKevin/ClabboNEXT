import {FastifyBaseLogger} from "fastify";

import {AuditEvent} from "../types.js";

export class AuditService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  public emit(event: AuditEvent): void {
    this.logger.info(
      {
        audit: true,
        ...event
      },
      "audit_event"
    );
  }
}
