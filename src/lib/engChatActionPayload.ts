export type EngChatActionPayload = {
  type: 'calc' | 'scad' | 'assembly' | 'wiring' | 'reply';
  id?: string;
  input?: Record<string, unknown>;
  prompt?: string;
  reply?: string;
  cables?: unknown[];
  plan?: import('@/lib/ai/cadActionPlan').CadActionPlan;
};

const ACTION_TYPES = new Set<EngChatActionPayload['type']>([
  'calc', 'scad', 'assembly', 'wiring', 'reply',
]);

/**
 * Some providers occasionally emit a CAD action and a MUST_ASK confirmation
 * question in the same envelope.  A question cannot also be authorization to
 * generate, so both the API and client use this deterministic safety gate.
 */
export function actionReplyRequiresConfirmation(value: unknown): boolean {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return /(?:이\s*치수로\s*진행할까요|진행할까요|\b기본값(?:으로)?\s*진행\b.*답|조정하고\s*싶으시면\s*알려|알려\s*주시면\s*(?:바로\s*)?생성|shall\s+i\s+proceed|would\s+you\s+like\s+(?:me\s+to\s+)?(?:adjust|change)|reply\s+[`'"]?default.*(?:proceed|generate)|この寸法で進めますか|默认值.*(?:继续|生成)|¿desea\s+(?:continuar|ajustar)|هل\s+تريد\s+(?:المتابعة|تعديل))/i.test(text);
}

function stripFenceAndExtractObject(raw: string): string {
  let value = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first !== -1 && last > first) value = value.slice(first, last + 1);
  return value;
}

function parseStringPayload(raw: string): unknown {
  const candidate = stripFenceAndExtractObject(raw);
  const attempts = [
    candidate,
    // Some OpenAI-compatible providers return an already JSON-escaped object
    // without the surrounding JSON string quotes: {\"type\":...}.
    candidate.replace(/\\"/g, '"'),
  ];
  for (const attempt of attempts) {
    try { return JSON.parse(attempt); } catch { /* try the next representation */ }
  }
  return null;
}

/**
 * Normalizes provider output and API responses, including double-encoded JSON
 * and the historic `{ type: 'reply', reply: '{...action...}' }` fallback.
 */
export function normalizeEngChatActionPayload(value: unknown, depth = 0): EngChatActionPayload | null {
  if (depth > 3) return null;

  if (typeof value === 'string') {
    const parsed = parseStringPayload(value);
    return parsed === null ? null : normalizeEngChatActionPayload(parsed, depth + 1);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (!ACTION_TYPES.has(type as EngChatActionPayload['type'])) return null;

  // If the server had to fall back to a plain reply but that reply is itself a
  // valid action envelope, recover the action instead of printing JSON to chat.
  if (type === 'reply' && typeof record.reply === 'string') {
    const nested = normalizeEngChatActionPayload(record.reply, depth + 1);
    if (nested && nested.type !== 'reply') return nested;
  }

  return {
    type: type as EngChatActionPayload['type'],
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(record.input && typeof record.input === 'object' && !Array.isArray(record.input)
      ? { input: record.input as Record<string, unknown> }
      : {}),
    ...(typeof record.prompt === 'string' ? { prompt: record.prompt } : {}),
    ...(typeof record.reply === 'string' ? { reply: record.reply } : {}),
    ...(Array.isArray(record.cables) ? { cables: record.cables } : {}),
    ...(record.plan && typeof record.plan === 'object' ? { plan: record.plan as EngChatActionPayload['plan'] } : {}),
  };
}
