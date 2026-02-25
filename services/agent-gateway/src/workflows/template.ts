const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function renderTemplate<T>(template: T, context: Record<string, unknown>): T {
  return renderTemplateValue(template, context) as T;
}

function renderTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => renderTemplateValue(entry, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderTemplateValue(entry, context)])
    );
  }

  if (typeof value !== "string") return value;
  if (!value.includes("{{")) return value;

  const wholeMatch = value.match(/^\s*\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\s*$/);

  if (wholeMatch?.[1]) {
    return resolvePath(context, wholeMatch[1]) ?? null;
  }

  return value.replaceAll(PLACEHOLDER_REGEX, (_raw, path: string) => {
    const resolved = resolvePath(context, path);

    if (resolved === undefined || resolved === null) return "";
    if (typeof resolved === "string") return resolved;
    if (typeof resolved === "number" || typeof resolved === "boolean") return String(resolved);

    return JSON.stringify(resolved);
  });
}

function resolvePath(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = context;

  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}
