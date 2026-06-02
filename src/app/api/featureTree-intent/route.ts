/**
 * POST /api/featureTree-intent — Phase 3.AI.API bridge between the regex
 * intent detector (`featureTreeIntentDetector.detectIntent`) and an optional
 * LLM fallback, returning a structured PlanIntent ready to feed into
 * `planFromIntent`.
 *
 * Pipeline (in order — first non-null wins):
 *   1. `detectIntent(text)` — pure regex, zero latency / zero cost.
 *      Hit → `{ ok: true, intent, source: 'regex' }`.
 *   2. LLM call — only when (1) returned null AND a provider is configured
 *      (either via `opts.llmFetcher` test injection, or an env var:
 *      `NEXYFAB_ANTHROPIC_KEY` → `ANTHROPIC_API_KEY` →
 *      `NEXYFAB_OPENAI_KEY` → `OPENAI_API_KEY`).
 *      LLM is asked to emit JSON matching the PlanIntent schema or the
 *      literal string "null". Response is validated against INTENT_KINDS
 *      before being returned as `{ ok: true, intent, source: 'llm' }`.
 *   3. Anything else (no provider, LLM threw, LLM timed out at 10s, JSON
 *      invalid, kind not in INTENT_KINDS) → graceful fallback:
 *      `{ ok: true, intent: null, source: 'fallback' }`.
 *
 * Why never 5xx on LLM failure?
 *   - The planner panel treats `null` intent as "could not understand" and
 *     surfaces that to the user. We mirror that contract: a fallback is
 *     always recoverable on the client. Hard 4xx is reserved for
 *     malformed requests (missing/empty/too-long text).
 *
 * Constants:
 *   - `MAX_TEXT_LEN` = 1000 chars → 413 PAYLOAD_TOO_LARGE.
 *   - `LLM_TIMEOUT_MS` = 10_000 → enforced via AbortSignal.timeout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectIntent } from '@/lib/ai/featureTreeIntentDetector';
import { INTENT_KINDS } from '@/lib/ai/featureTreeIntentDetector';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LEN = 1000;
const LLM_TIMEOUT_MS = 10_000;

export interface FeatureTreeIntentBody {
  text?: string;
}

export interface FeatureTreeIntentResponseOk {
  ok: true;
  intent: PlanIntent | null;
  source: 'regex' | 'llm' | 'fallback';
}

export interface FeatureTreeIntentResponseErr {
  ok: false;
  code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE';
  message: string;
}

/** Test-injection seam: pass `opts.llmFetcher` from unit tests to skip env+network. */
export interface FeatureTreeIntentOpts {
  llmFetcher?: (text: string, signal: AbortSignal) => Promise<unknown>;
}

/**
 * Resolve the LLM bridge. Precedence:
 *   1. opts.llmFetcher (test injection)
 *   2. env vars in order:
 *        NEXYFAB_ANTHROPIC_KEY → ANTHROPIC_API_KEY
 *        NEXYFAB_OPENAI_KEY    → OPENAI_API_KEY
 *      Anthropic preferred because it is the project's primary provider.
 *   3. null → "no LLM available" sentinel (handler emits source:'fallback').
 */
function resolveLlmFetcher(
  opts: FeatureTreeIntentOpts,
): ((text: string, signal: AbortSignal) => Promise<unknown>) | null {
  if (opts.llmFetcher) return opts.llmFetcher;

  const anthropicKey =
    process.env.NEXYFAB_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return (text, signal) => callAnthropic(text, anthropicKey, signal);
  }
  const openaiKey =
    process.env.NEXYFAB_OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return (text, signal) => callOpenAI(text, openaiKey, signal);
  }
  return null;
}

function buildPrompt(text: string): string {
  const kinds = INTENT_KINDS.join(', ');
  return [
    `You are a CAD design assistant. Convert the user's natural language request to a JSON intent.`,
    `Allowed kinds: [${kinds}].`,
    `Examples:`,
    `  "box 50x50x30" → {"kind":"create_cylinder", ...}  // NO`,
    `  "box 50x50x30" → {"kind":"create_box_with_holes","size":{"x":50,"y":50,"z":30},"holes":[]}`,
    `  "cylinder r 10 h 20" → {"kind":"create_cylinder","radius":10,"height":20}`,
    `  "add fillet 3" → {"kind":"add_fillet_to_last","radius":3}`,
    `Return ONLY valid JSON (no prose, no markdown fences) or the literal "null".`,
    `User: "${text.replace(/"/g, '\\"')}"`,
  ].join('\n');
}

async function callAnthropic(
  text: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(text) }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  return parseJsonOrNull(raw);
}

async function callOpenAI(
  text: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(text) }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseJsonOrNull(raw);
}

/**
 * Extract the first JSON object from `raw` (or detect a "null" sentinel),
 * tolerating markdown fences + surrounding prose that some models emit.
 * Returns `null` when no parseable JSON is present.
 */
function parseJsonOrNull(raw: string): unknown {
  const stripped = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  if (stripped === '' || stripped.toLowerCase() === 'null') return null;
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  const slice =
    firstBrace !== -1 && lastBrace > firstBrace
      ? stripped.slice(firstBrace, lastBrace + 1)
      : stripped;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * Validate that an unknown LLM payload conforms to the PlanIntent schema.
 * Only the `kind` discriminator is checked structurally; per-kind required
 * fields are validated just enough that `planFromIntent` can run without
 * throwing (deeper numeric validation lives in the planner itself).
 */
function validatePlanIntent(payload: unknown): PlanIntent | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string') return null;
  if (!(INTENT_KINDS as readonly string[]).includes(kind)) return null;

  switch (kind) {
    case 'create_box_with_holes': {
      if (!isVec3(obj.size)) return null;
      if (!Array.isArray(obj.holes)) return null;
      const holes = obj.holes.filter(
        (h): h is { x: number; y: number; diameter: number } =>
          !!h &&
          typeof h === 'object' &&
          typeof (h as Record<string, unknown>).x === 'number' &&
          typeof (h as Record<string, unknown>).y === 'number' &&
          typeof (h as Record<string, unknown>).diameter === 'number',
      );
      return { kind, size: obj.size, holes };
    }
    case 'create_box_with_fillet': {
      if (!isVec3(obj.size)) return null;
      if (typeof obj.filletRadius !== 'number') return null;
      return { kind, size: obj.size, filletRadius: obj.filletRadius };
    }
    case 'create_cylinder': {
      if (typeof obj.radius !== 'number') return null;
      if (typeof obj.height !== 'number') return null;
      return { kind, radius: obj.radius, height: obj.height };
    }
    case 'add_fillet_to_last': {
      if (typeof obj.radius !== 'number') return null;
      return { kind, radius: obj.radius };
    }
    case 'add_chamfer_to_last': {
      if (typeof obj.distance !== 'number') return null;
      return { kind, distance: obj.distance };
    }
    case 'create_assembly_stack': {
      if (typeof obj.partCount !== 'number') return null;
      const spacing = typeof obj.spacing === 'number' ? obj.spacing : 10;
      return { kind, partCount: obj.partCount, spacing };
    }
    default:
      return null;
  }
}

function isVec3(v: unknown): v is { x: number; y: number; z: number } {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number'
  );
}

/**
 * Core handler. Exported (alongside POST) so tests can inject `opts.llmFetcher`
 * without needing to monkey-patch fetch.
 */
export async function handleFeatureTreeIntent(
  body: FeatureTreeIntentBody,
  opts: FeatureTreeIntentOpts = {},
): Promise<{
  status: number;
  payload: FeatureTreeIntentResponseOk | FeatureTreeIntentResponseErr;
}> {
  const text = typeof body.text === 'string' ? body.text : '';
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return {
      status: 400,
      payload: {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'text is required and must be a non-empty string',
      },
    };
  }
  if (text.length > MAX_TEXT_LEN) {
    return {
      status: 413,
      payload: {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `text length ${text.length} exceeds maximum ${MAX_TEXT_LEN}`,
      },
    };
  }

  // 1. regex
  let regexIntent: PlanIntent | null = null;
  try {
    regexIntent = detectIntent(trimmed);
  } catch {
    regexIntent = null;
  }
  if (regexIntent !== null) {
    return {
      status: 200,
      payload: { ok: true, intent: regexIntent, source: 'regex' },
    };
  }

  // 2. LLM (only when configured)
  const fetcher = resolveLlmFetcher(opts);
  if (!fetcher) {
    return {
      status: 200,
      payload: { ok: true, intent: null, source: 'fallback' },
    };
  }

  let llmRaw: unknown;
  try {
    llmRaw = await fetcher(trimmed, AbortSignal.timeout(LLM_TIMEOUT_MS));
  } catch {
    return {
      status: 200,
      payload: { ok: true, intent: null, source: 'fallback' },
    };
  }

  const validated = validatePlanIntent(llmRaw);
  if (validated === null) {
    return {
      status: 200,
      payload: { ok: true, intent: null, source: 'fallback' },
    };
  }
  return {
    status: 200,
    payload: { ok: true, intent: validated, source: 'llm' },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FeatureTreeIntentBody;
  try {
    body = (await req.json()) as FeatureTreeIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleFeatureTreeIntent(body);
  return NextResponse.json(payload, { status });
}
