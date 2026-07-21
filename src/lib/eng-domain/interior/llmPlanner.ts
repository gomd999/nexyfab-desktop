/**
 * eng-domain/interior/llmPlanner — WA-D pattern for INTERIOR (다분야 확장 #2 LLM 플래너).
 *
 * The LLM's role is CONFINED to producing an `InteriorPlan` from a free-text brief —
 * exactly the mechanical llmPlanner contract, replicated per domain. Model text
 * never reaches the gate chain unchecked:
 *   1. call an INJECTED `complete(messages)` (deterministic mock in tests),
 *   2. extract JSON (markdown-fence tolerant),
 *   3. coerce into the InteriorPlan schema — unknown fields dropped, every required
 *      field type-checked; any violation THROWS (계획 날조 금지),
 *   4. the runner turns a throw into a stage:'plan' refusal.
 *
 * Determinism note: a live LLM is not byte-deterministic; the schema coercion
 * guarantees only that whatever passes is a structurally valid, gate-eligible
 * plan — code-compliance is still decided by the real interior building-code gates.
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import type { InteriorBrief, InteriorPlan, InteriorSpace } from './module';
import type { UseGroup } from './checks';

// ─── coercion primitives (violation ⇒ throw = plan refusal) ─────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function reqObj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new Error(`${path}: expected an object`);
  return v;
}
function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${path}: expected an array`);
  return v;
}
function reqStr(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${path}: expected a non-empty string`);
  return v;
}
function reqNum(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${path}: expected a finite number`);
  return v;
}
function optNum(v: unknown, path: string): number | undefined {
  return v === undefined || v === null ? undefined : reqNum(v, path);
}
function reqBool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${path}: expected a boolean`);
  return v;
}

// The valid UseGroup values, enumerated for runtime validation (mirrors the
// UseGroup union in ./checks — kept in sync; an unknown group THROWS).
const VALID_USE_GROUPS: readonly UseGroup[] = [
  'assembly-concentrated',
  'assembly-unconcentrated',
  'assembly-standing',
  'business',
  'educational',
  'mercantile',
  'residential',
  'industrial',
  'storage',
];

function reqUseGroup(v: unknown, path: string): UseGroup {
  const s = reqStr(v, path);
  if (!(VALID_USE_GROUPS as readonly string[]).includes(s)) {
    throw new Error(`${path}='${s}' invalid useGroup (one of: ${VALID_USE_GROUPS.join('|')})`);
  }
  return s as UseGroup;
}

// ─── space coercion ────────────────────────────────────────────────────────────

function coerceSpace(v: unknown, path: string): InteriorSpace {
  const o = reqObj(v, path);
  const space: InteriorSpace = {
    id: reqStr(o.id, `${path}.id`),
    name: reqStr(o.name, `${path}.name`),
    useGroup: reqUseGroup(o.useGroup, `${path}.useGroup`),
    floorAreaM2: reqNum(o.floorAreaM2, `${path}.floorAreaM2`),
    sprinklered: reqBool(o.sprinklered, `${path}.sprinklered`),
    measuredTravelM: reqNum(o.measuredTravelM, `${path}.measuredTravelM`),
    providedEgressWidthMm: reqNum(o.providedEgressWidthMm, `${path}.providedEgressWidthMm`),
    measuredCorridorWidthMm: reqNum(o.measuredCorridorWidthMm, `${path}.measuredCorridorWidthMm`),
    providedWaterClosets: reqNum(o.providedWaterClosets, `${path}.providedWaterClosets`),
    measuredCeilingHeightMm: reqNum(o.measuredCeilingHeightMm, `${path}.measuredCeilingHeightMm`),
  };
  const pol = optNum(o.postedOccupantLimit, `${path}.postedOccupantLimit`);
  if (pol !== undefined) space.postedOccupantLimit = pol;
  return space;
}

/** Coerce arbitrary parsed JSON into an InteriorPlan, or throw (계획 날조 금지). */
export function coerceInteriorPlan(v: unknown): InteriorPlan {
  const o = reqObj(v, 'plan');
  if (isObj(o) && o.error === 'unsupported') {
    const reason = typeof o.reason === 'string' ? o.reason : 'no reason given';
    throw new Error(`planner declined the brief as unsupported: ${reason}`);
  }
  const spacesRaw = reqArray(o.spaces, 'plan.spaces');
  if (spacesRaw.length === 0) throw new Error('plan.spaces: at least one space required');
  return {
    planId: reqStr(o.planId, 'plan.planId'),
    name: reqStr(o.name, 'plan.name'),
    spaces: spacesRaw.map((s, i) => coerceSpace(s, `plan.spaces[${i}]`)),
  };
}

// ─── JSON extraction (markdown-fence tolerant) ─────────────────────────────────

function extractJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error('planner returned an empty response');
  const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('planner response contains no JSON object');
  try {
    return JSON.parse(stripped.slice(first, last + 1).trim());
  } catch {
    throw new Error('planner response is not valid JSON');
  }
}

// ─── system prompt ─────────────────────────────────────────────────────────────

export const INTERIOR_SYSTEM_PROMPT = `You are the planning stage of an INTERIOR / space-planning design driver. Your ONLY output is an InteriorPlan as a single JSON object. You never decide code compliance — a deterministic engine REAL-checks every space against building code (occupant load, egress, corridor, plumbing, ceiling height). Fabricated numbers are worthless; only a structurally valid plan the engine can verify is useful.

Return ONLY the JSON object (no prose, no markdown). If the request cannot be expressed within the schema, return {"error":"unsupported","reason":"<why>"} instead of guessing.

InteriorPlan schema (unknown fields dropped; wrong types rejected):
{
  "planId": string, "name": string,
  "spaces": [                        // >= 1; each space:
    { "id":string, "name":string,
      "useGroup":"assembly-concentrated"|"assembly-unconcentrated"|"assembly-standing"|"business"|"educational"|"mercantile"|"residential"|"industrial"|"storage",
      "floorAreaM2":number, "sprinklered":boolean,
      "measuredTravelM":number, "providedEgressWidthMm":number, "measuredCorridorWidthMm":number,
      "providedWaterClosets":number, "measuredCeilingHeightMm":number,
      "postedOccupantLimit":number? }
  ]
}

HONESTY: never fabricate measured dimensions, fixture counts, or areas not implied by the brief — if a needed quantity is missing, REFUSE with {"error":"unsupported","reason":...}. A verified draft is a licensed 건축사(建築士)'s copilot output, NOT a replacement; the permit set remains 인허가 확인 대상.`;

// ─── the planner ───────────────────────────────────────────────────────────────

export interface InteriorLlmPlannerDeps {
  complete: (messages: ChatMessage[]) => Promise<string>;
  systemPrompt?: string;
}

function buildMessages(brief: InteriorBrief, systemPrompt: string): ChatMessage[] {
  let user = (brief.text ?? '').trim();
  if (brief.params && Object.keys(brief.params).length > 0) {
    user += `\n\nStructured parameters (JSON): ${JSON.stringify(brief.params)}`;
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user.length > 0 ? user : '(empty brief)' },
  ];
}

/** Build an InteriorPlan LLM planner over an injected completion (tests pass a mock). */
export function makeInteriorLlmPlanner(deps: InteriorLlmPlannerDeps): (brief: InteriorBrief) => Promise<InteriorPlan> {
  const systemPrompt = deps.systemPrompt ?? INTERIOR_SYSTEM_PROMPT;
  return async (brief) => {
    const messages = buildMessages(brief, systemPrompt);
    const raw = await deps.complete(messages);
    return coerceInteriorPlan(extractJson(raw));
  };
}

/** Production planner: wired to the shared chatCompletion provider chain. */
export function chatCompletionInteriorPlanner(): (brief: InteriorBrief) => Promise<InteriorPlan> {
  return makeInteriorLlmPlanner({
    complete: async (messages) => {
      const res = await chatCompletion({ messages, temperature: 0, maxTokens: 2000, timeoutMs: 60_000, task: 'interior-design-plan' });
      return res.text;
    },
  });
}
