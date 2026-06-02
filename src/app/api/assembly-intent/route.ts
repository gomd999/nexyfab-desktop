/**
 * POST /api/assembly-intent — regex-first / LLM-fallback bridge that turns
 * a natural-language assembly request into a structured {@link AssemblyPlan}.
 *
 * Mirrors the contract of /api/featureTree-intent (Agent-DDDD) so the two
 * routes can be reasoned about and operated identically:
 *
 *   1. Regex pass (`detectAssemblyIntent`) — pure, zero-latency. A non-
 *      `unparsed` result short-circuits with `{ ok:true, source:'regex' }`.
 *   2. LLM pass — only when (1) returned `unparsed` AND a provider is
 *      configured (either via `opts.llmFetcher` test injection or an env
 *      var: NEXYFAB_ANTHROPIC_KEY → ANTHROPIC_API_KEY →
 *      NEXYFAB_OPENAI_KEY → OPENAI_API_KEY). Anthropic preferred because it
 *      is the project's primary provider. The LLM is asked to emit JSON
 *      matching one of the four AssemblyPlan kinds, or the literal string
 *      "null". The response is validated against the discriminated union
 *      shape before being returned as `{ ok:true, source:'llm' }`.
 *   3. Fallback — when no provider is configured, the LLM throws/times out,
 *      the JSON is unparseable, the kind is unknown, or the fields don't
 *      typecheck: `{ ok:true, intent:{ kind:'unparsed' }, source:'fallback' }`.
 *
 * The handler NEVER returns 5xx on an LLM failure — the modal treats an
 * `unparsed` intent as "couldn't understand" and renders a banner. We
 * reserve 4xx for malformed requests (missing/empty/too-long text or bad
 * JSON body).
 *
 * Constants:
 *   - MAX_TEXT_LEN     = 1000 chars → 413 PAYLOAD_TOO_LARGE.
 *   - MAX_BODY_BYTES   = 5 MiB     → 413 PAYLOAD_TOO_LARGE.
 *   - LLM_TIMEOUT_MS   = 10_000    → enforced via AbortSignal.timeout.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  detectAssemblyIntent,
  BUILD_ASSEMBLY_PROMPT,
  ASSEMBLY_PLAN_KINDS,
  PAIR_MATE_KINDS,
  type AssemblyPlan,
} from '@/lib/ai/assemblyNlParser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LEN = 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const LLM_TIMEOUT_MS = 10_000;

export interface AssemblyIntentBody {
  text?: string;
}

export interface AssemblyIntentResponseOk {
  ok: true;
  intent: AssemblyPlan;
  source: 'regex' | 'llm' | 'fallback';
}

export interface AssemblyIntentResponseErr {
  ok: false;
  code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE';
  message: string;
}

/** Test-injection seam — pass `opts.llmFetcher` from unit tests to skip env+network. */
export interface AssemblyIntentOpts {
  llmFetcher?: (text: string, signal: AbortSignal) => Promise<unknown>;
}

/**
 * Resolve the LLM bridge. Precedence:
 *   1. opts.llmFetcher (test injection — wins over env so tests are hermetic)
 *   2. env vars in order:
 *        NEXYFAB_ANTHROPIC_KEY → ANTHROPIC_API_KEY
 *        NEXYFAB_OPENAI_KEY    → OPENAI_API_KEY
 *      Anthropic preferred because it is the project's primary provider.
 *   3. null → "no LLM available" sentinel (handler emits source:'fallback').
 */
function resolveLlmFetcher(
  opts: AssemblyIntentOpts,
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
      max_tokens: 256,
      temperature: 0,
      messages: [{ role: 'user', content: BUILD_ASSEMBLY_PROMPT(text) }],
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
      max_tokens: 256,
      temperature: 0,
      messages: [{ role: 'user', content: BUILD_ASSEMBLY_PROMPT(text) }],
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
 * Returns `null` when no parseable JSON is present (signalling "unparsed").
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
 * Validate that an unknown LLM payload conforms to one of the four
 * AssemblyPlan branches. Returns the typed plan on success or `null` on any
 * shape mismatch (caller maps null → `{ kind: 'unparsed' }` + source:'fallback').
 *
 * We avoid throwing here so the route can attribute the failure to source:
 * 'fallback' rather than masking it as a 5xx.
 */
function validateAssemblyPlan(payload: unknown): AssemblyPlan | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string') return null;
  if (!(ASSEMBLY_PLAN_KINDS as readonly string[]).includes(kind)) return null;

  switch (kind) {
    case 'stacked': {
      if (!isPositiveInt(obj.count)) return null;
      const out: AssemblyPlan = { kind: 'stacked', count: obj.count };
      if (typeof obj.spacing === 'number' && obj.spacing >= 0 && Number.isFinite(obj.spacing)) {
        out.spacing = obj.spacing;
      }
      return out;
    }
    case 'grid': {
      if (!isPositiveInt(obj.rows)) return null;
      if (!isPositiveInt(obj.cols)) return null;
      const out: AssemblyPlan = { kind: 'grid', rows: obj.rows, cols: obj.cols };
      if (typeof obj.spacing === 'number' && obj.spacing >= 0 && Number.isFinite(obj.spacing)) {
        out.spacing = obj.spacing;
      }
      return out;
    }
    case 'ring': {
      if (!isPositiveInt(obj.count)) return null;
      // ring requires ≥ 2 parts to make geometric sense.
      if (obj.count < 2) return null;
      const out: AssemblyPlan = { kind: 'ring', count: obj.count };
      if (typeof obj.radius === 'number' && obj.radius > 0 && Number.isFinite(obj.radius)) {
        out.radius = obj.radius;
      }
      return out;
    }
    case 'pair': {
      const mate = obj.mate;
      if (typeof mate !== 'string') return null;
      if (!(PAIR_MATE_KINDS as readonly string[]).includes(mate)) return null;
      return { kind: 'pair', mate: mate as (typeof PAIR_MATE_KINDS)[number] };
    }
    default:
      return null;
  }
}

function isPositiveInt(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0
  );
}

/**
 * Core handler. Exported (alongside POST) so tests can inject `opts.llmFetcher`
 * without monkey-patching fetch.
 *
 * Returns `{ status, payload }` — POST then re-wraps it in a NextResponse.
 */
export async function handleAssemblyIntent(
  body: AssemblyIntentBody,
  opts: AssemblyIntentOpts = {},
): Promise<{
  status: number;
  payload: AssemblyIntentResponseOk | AssemblyIntentResponseErr;
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
  let regexIntent: AssemblyPlan;
  try {
    regexIntent = detectAssemblyIntent(trimmed);
  } catch {
    regexIntent = { kind: 'unparsed' };
  }
  if (regexIntent.kind !== 'unparsed') {
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
      payload: {
        ok: true,
        intent: { kind: 'unparsed' },
        source: 'fallback',
      },
    };
  }

  let llmRaw: unknown;
  try {
    llmRaw = await fetcher(trimmed, AbortSignal.timeout(LLM_TIMEOUT_MS));
  } catch {
    return {
      status: 200,
      payload: {
        ok: true,
        intent: { kind: 'unparsed' },
        source: 'fallback',
      },
    };
  }

  const validated = validateAssemblyPlan(llmRaw);
  if (validated === null) {
    return {
      status: 200,
      payload: {
        ok: true,
        intent: { kind: 'unparsed' },
        source: 'fallback',
      },
    };
  }
  return {
    status: 200,
    payload: { ok: true, intent: validated, source: 'llm' },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Body-size guard: peek at Content-Length so we don't buffer multi-MB
  // bodies just to discover they're too large. The Next request object
  // doesn't expose a hard byte cap by default; we add one here so a
  // pathological client can't OOM the route.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PAYLOAD_TOO_LARGE',
          message: `body bytes ${cl} exceeds maximum ${MAX_BODY_BYTES}`,
        },
        { status: 413 },
      );
    }
  }

  let body: AssemblyIntentBody;
  try {
    body = (await req.json()) as AssemblyIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleAssemblyIntent(body);
  return NextResponse.json(payload, { status });
}
