export const MAX_CONTEXT_DEPTH = 4;
export const MAX_CONTEXT_BYTES = 4 * 1024;
const MAX_CONTEXT_KEYS = 64;
const MAX_CONTEXT_STRING_LEN = 512;

function boundContextValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_CONTEXT_STRING_LEN);
  if (depth >= MAX_CONTEXT_DEPTH) return '[truncated-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_CONTEXT_KEYS).map(entry => boundContextValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_CONTEXT_KEYS)) {
      result[key.slice(0, 128)] = boundContextValue(entry, depth + 1);
    }
    return result;
  }

  return undefined;
}

/** Bound untrusted context before it reaches audit logs or Sentry. */
export function boundTelemetryContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const bounded = boundContextValue(value, 0) as Record<string, unknown>;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(bounded)).byteLength;
    return bytes <= MAX_CONTEXT_BYTES ? bounded : { _truncated: true };
  } catch {
    return { _truncated: true };
  }
}
