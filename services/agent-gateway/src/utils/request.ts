import {FastifyRequest} from "fastify";

export function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];

  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;

  return undefined;
}

export function getRequiredHeader(request: FastifyRequest, name: string): string {
  const value = getHeader(request, name);

  if (!value) throw new Error(`missing_header:${name}`);

  return value;
}

export function getRequestIdHeader(request: FastifyRequest): string | undefined {
  return getHeader(request, "x-clabo-request-id");
}

export function getWorkspaceIdHeader(request: FastifyRequest): string | undefined {
  return getHeader(request, "x-clabo-workspace-id");
}

export function getInternalServiceKeyHeader(request: FastifyRequest): string | undefined {
  return getHeader(request, "x-clabo-internal-key");
}
