/**
 * featureTree-intent handler — the testable core of POST /api/featureTree-intent,
 * split out of route.ts because a Next App Router route.ts may only value-export
 * method handlers (Next 16 route-type check). route.ts is the thin POST.
 *
 * Bridge between the regex intent detector
 * (`featureTreeIntentDetector.detectIntent`) and an optional LLM fallback,
 * returning a structured PlanIntent ready to feed into `planFromIntent`.
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

import { detectIntent } from '@/lib/ai/featureTreeIntentDetector';
import { INTENT_KINDS } from '@/lib/ai/featureTreeIntentDetector';
import { BUILD_INTENT_PROMPT } from '@/lib/ai/llmPrompt';
import { isAddableFeatureType } from '@/lib/ai/addableFeatureTypes';
import type { AiModelContext } from '@/lib/ai/modelContext';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';

const MAX_TEXT_LEN = 1000;
const LLM_TIMEOUT_MS = 10_000;

/**
 * Prompt template version surfaced in successful `source:'llm'` responses
 * (as optional `promptVersion` metadata). Bump when `BUILD_INTENT_PROMPT`
 * changes shape — the value is opaque to clients but useful for evals
 * (e.g. comparing acceptance rate across prompt revisions in logs).
 *
 *   v1 — original inline 6-kind prompt (pre-RRRR), replaced 2026-06-02.
 *   v2 — RRRR `BUILD_INTENT_PROMPT` covering all 12 INTENT_KINDS.
 */
const PROMPT_VERSION = 'v2';

export interface FeatureTreeIntentBody {
  text?: string;
  /** Compact model summary so the LLM can resolve context-dependent commands. */
  context?: AiModelContext;
}

export interface FeatureTreeIntentResponseOk {
  ok: true;
  intent: PlanIntent | null;
  source: 'regex' | 'llm' | 'fallback';
  /**
   * Optional prompt template version, present only when `source === 'llm'`.
   * Lets downstream eval / observability tooling correlate acceptance rate
   * with a specific revision of `BUILD_INTENT_PROMPT`.
   */
  promptVersion?: string;
}

export interface FeatureTreeIntentResponseErr {
  ok: false;
  code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE';
  message: string;
}

/** Test-injection seam: pass `opts.llmFetcher` from unit tests to skip env+network. */
export interface FeatureTreeIntentOpts {
  llmFetcher?: (text: string, context: AiModelContext | undefined, signal: AbortSignal) => Promise<unknown>;
}

/**
 * Resolve the LLM bridge. Precedence:
 *   1. opts.llmFetcher (test injection)
 *   2. env vars in order:
 *        NEXYFAB_DEEPSEEK_API_KEY → DEEPSEEK_API_KEY   (project's primary provider)
 *        NEXYFAB_ANTHROPIC_KEY    → ANTHROPIC_API_KEY
 *        NEXYFAB_OPENAI_KEY       → OPENAI_API_KEY
 *      DeepSeek is checked first because it is the only provider actually
 *      configured in this deployment (Anthropic/OpenAI keys are commented out
 *      in .env). Without this branch the long-tail LLM fallback never fired in
 *      production and every command outside the regex grammar silently failed.
 *   3. null → "no LLM available" sentinel (handler emits source:'fallback').
 */
function resolveLlmFetcher(
  opts: FeatureTreeIntentOpts,
): ((text: string, context: AiModelContext | undefined, signal: AbortSignal) => Promise<unknown>) | null {
  if (opts.llmFetcher) return opts.llmFetcher;

  const deepseekKey =
    process.env.NEXYFAB_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    return (text, context, signal) => callDeepSeek(text, context, deepseekKey, signal);
  }
  const anthropicKey =
    process.env.NEXYFAB_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return (text, context, signal) => callAnthropic(text, context, anthropicKey, signal);
  }
  const openaiKey =
    process.env.NEXYFAB_OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return (text, context, signal) => callOpenAI(text, context, openaiKey, signal);
  }
  return null;
}

/**
 * Build the LLM prompt for a single user text. Thin wrapper over RRRR's
 * `BUILD_INTENT_PROMPT` from `@/lib/ai/llmPrompt` so the route file stays
 * narrow and the canonical prompt template lives in one module (unit-tested
 * separately, reused by CLI tools + evals).
 *
 * Defaults to the full 12-kind `INTENT_KINDS` set — if a caller ever wants
 * to restrict the LLM to a subset (e.g. modifier-only quick actions), they
 * can build the prompt themselves and pass the body through an injected
 * `opts.llmFetcher`.
 */
function buildPrompt(text: string, context?: AiModelContext): string {
  return BUILD_INTENT_PROMPT(text, INTENT_KINDS, context);
}

async function callAnthropic(
  text: string,
  context: AiModelContext | undefined,
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
      messages: [{ role: 'user', content: buildPrompt(text, context) }],
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

/**
 * DeepSeek is OpenAI-compatible (`/chat/completions`, Bearer auth, same
 * response shape) — mirror callOpenAI but against the DeepSeek base URL.
 * This is the provider actually configured in production.
 */
async function callDeepSeek(
  text: string,
  context: AiModelContext | undefined,
  apiKey: string,
  signal: AbortSignal,
): Promise<unknown> {
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(text, context) }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseJsonOrNull(raw);
}

async function callOpenAI(
  text: string,
  context: AiModelContext | undefined,
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
      messages: [{ role: 'user', content: buildPrompt(text, context) }],
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
    // ── Phase 3.AI.2 — 6 additional kinds (mirror featureTreePlanner.PlanIntent)
    case 'create_box_with_chamfer': {
      if (!isVec3(obj.size)) return null;
      if (typeof obj.chamferDistance !== 'number') return null;
      return { kind, size: obj.size, chamferDistance: obj.chamferDistance };
    }
    case 'create_box_with_pocket': {
      if (!isVec3(obj.size)) return null;
      if (typeof obj.pocketDepth !== 'number') return null;
      if (typeof obj.pocketRadius !== 'number') return null;
      return {
        kind,
        size: obj.size,
        pocketDepth: obj.pocketDepth,
        pocketRadius: obj.pocketRadius,
      };
    }
    case 'create_cylinder_with_hole': {
      if (typeof obj.radius !== 'number') return null;
      if (typeof obj.height !== 'number') return null;
      if (typeof obj.holeRadius !== 'number') return null;
      return {
        kind,
        radius: obj.radius,
        height: obj.height,
        holeRadius: obj.holeRadius,
      };
    }
    case 'create_pattern_grid': {
      if (obj.baseFeature !== 'extrude_box' && obj.baseFeature !== 'cylinder') {
        return null;
      }
      const count = obj.count;
      if (!count || typeof count !== 'object') return null;
      const c = count as Record<string, unknown>;
      if (typeof c.x !== 'number' || typeof c.y !== 'number') return null;
      if (typeof obj.spacing !== 'number') return null;
      return {
        kind,
        baseFeature: obj.baseFeature,
        count: { x: c.x, y: c.y },
        spacing: obj.spacing,
      };
    }
    case 'create_revolve_axis': {
      if (obj.profile !== 'rectangle' && obj.profile !== 'triangle') return null;
      if (typeof obj.radius !== 'number') return null;
      if (typeof obj.height !== 'number') return null;
      return {
        kind,
        profile: obj.profile,
        radius: obj.radius,
        height: obj.height,
      };
    }
    case 'add_pattern_to_last': {
      if (obj.patternKind !== 'linear' && obj.patternKind !== 'circular') {
        return null;
      }
      if (typeof obj.count !== 'number') return null;
      // spacing required for linear, angle optional for circular (planner
      // defaults to 360°). Mirror the planner's contract — over-permissive
      // here would just push the rejection to the planner with a worse error.
      if (obj.patternKind === 'linear') {
        if (typeof obj.spacing !== 'number') return null;
        return {
          kind,
          patternKind: 'linear',
          count: obj.count,
          spacing: obj.spacing,
        };
      }
      // circular — angle is optional; planner defaults to 360 when omitted.
      const circular: Extract<PlanIntent, { kind: 'add_pattern_to_last' }> = {
        kind,
        patternKind: 'circular',
        count: obj.count,
      };
      if (typeof obj.angle === 'number') circular.angle = obj.angle;
      return circular;
    }
    case 'add_feature_to_last': {
      // Generic feature add: featureType must be in the allowlist; params is a
      // flat numeric record (non-numeric values dropped). Omitted params are
      // filled from registry defaults client-side, so {} is valid.
      if (!isAddableFeatureType(obj.featureType)) return null;
      const rawParams = obj.params;
      const params: Record<string, number> = {};
      if (rawParams && typeof rawParams === 'object') {
        for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
        }
      }
      return { kind, featureType: obj.featureType, params };
    }
    case 'update_last_param': {
      if (typeof obj.paramKey !== 'string' || obj.paramKey.length === 0) return null;
      if (typeof obj.value !== 'number' || !Number.isFinite(obj.value)) return null;
      return { kind, paramKey: obj.paramKey, value: obj.value };
    }
    case 'remove_last':
      return { kind };
    case 'create_sketch_extrude': {
      if (!Array.isArray(obj.profile)) return null;
      const profile = obj.profile
        .filter((p): p is { x: number; y: number } =>
          !!p && typeof p === 'object' &&
          typeof (p as Record<string, unknown>).x === 'number' && Number.isFinite((p as Record<string, unknown>).x as number) &&
          typeof (p as Record<string, unknown>).y === 'number' && Number.isFinite((p as Record<string, unknown>).y as number))
        .map((p) => ({ x: p.x, y: p.y }));
      if (profile.length < 3) return null;
      if (typeof obj.depth !== 'number' || !Number.isFinite(obj.depth) || obj.depth <= 0) return null;
      const plane = obj.plane === 'xz' || obj.plane === 'yz' ? obj.plane : 'xy';
      const operation = obj.operation === 'subtract' ? 'subtract' : 'add';
      return { kind, profile, depth: obj.depth, plane, operation };
    }
    case 'build_part': {
      const base = obj.base;
      if (!base || typeof base !== 'object') return null;
      const b = base as Record<string, unknown>;
      if (typeof b.shapeId !== 'string' || !BUILD_PART_BASES.has(b.shapeId)) return null;
      const baseParams = numericRecord(b.params);
      const featsRaw = Array.isArray(obj.features) ? obj.features : [];
      const features = featsRaw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !Array.isArray(f))
        .filter((f) => typeof f.type === 'string' && f.type.length > 0)
        .map((f) => ({ type: f.type as string, params: numericRecord(f.params) }));
      return { kind, base: { shapeId: b.shapeId, params: baseParams }, features };
    }
    case 'assemble_parts': {
      if (!Array.isArray(obj.parts)) return null;
      const parts = obj.parts
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p))
        .filter((p) => typeof p.shapeId === 'string' && ASSEMBLY_PART_SHAPES.has(p.shapeId as string))
        .map((p) => {
          const part: { name?: string; shapeId: string; params: Record<string, number>; position?: [number, number, number]; rotation?: [number, number, number] } = {
            shapeId: p.shapeId as string,
            params: numericRecord(p.params),
          };
          if (typeof p.name === 'string') part.name = p.name;
          const pos = vec3OrNull(p.position);
          if (pos) part.position = pos;
          const rot = vec3OrNull(p.rotation);
          if (rot) part.rotation = rot;
          return part;
        });
      if (parts.length < 2) return null; // an "assembly" needs ≥2 parts
      return { kind, parts };
    }
    default:
      return null;
  }
}

/** Base primitives a build_part may stand on (scene-store shape-picker ids). */
const BUILD_PART_BASES = new Set(['box', 'cylinder', 'sphere', 'cone', 'disk', 'pipe', 'torus']);

/** Shapes an assemble_parts part may be (real per-part geometry via SHAPE_MAP). */
const ASSEMBLY_PART_SHAPES = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'disk', 'pipe', 'torus', 'hexNut', 'washer',
  'bolt', 'gear', 'flange', 'roundedBox', 'wedge',
]);

/** Parse an unknown into a finite [x,y,z] tuple, or null. */
function vec3OrNull(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** Coerce an unknown into a flat record of finite numbers (drops the rest). */
function numericRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    }
  }
  return out;
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
    llmRaw = await fetcher(trimmed, body.context, AbortSignal.timeout(LLM_TIMEOUT_MS));
  } catch (err) {
    // Observability: surface WHY the LLM fallback engaged (provider error /
    // timeout / network). Swallowed for the client (graceful fallback) but
    // logged so prod issues like a rejected key or blocked egress are visible.
    console.warn('[featureTree-intent] LLM fetcher failed → fallback:', (err as Error)?.message ?? err);
    return {
      status: 200,
      payload: { ok: true, intent: null, source: 'fallback' },
    };
  }

  const validated = validatePlanIntent(llmRaw);
  if (validated === null) {
    console.warn('[featureTree-intent] LLM output failed validation → fallback:', JSON.stringify(llmRaw)?.slice(0, 200));
    return {
      status: 200,
      payload: { ok: true, intent: null, source: 'fallback' },
    };
  }
  return {
    status: 200,
    payload: {
      ok: true,
      intent: validated,
      source: 'llm',
      promptVersion: PROMPT_VERSION,
    },
  };
}
