/**
 * eng-domain/construction/llmPlanner — WA-D pattern for CONSTRUCTION (다분야 확장 #2 LLM 플래너).
 *
 * The LLM's role is CONFINED to producing a `ConstructionPlan` from a free-text
 * brief — exactly the mechanical llmPlanner contract, replicated per domain. Model
 * text never reaches the gate chain unchecked:
 *   1. call an INJECTED `complete(messages)` (deterministic mock in tests),
 *   2. extract JSON (markdown-fence tolerant),
 *   3. coerce into the ConstructionPlan schema — unknown fields dropped, every
 *      required field + element kind type-checked; any violation THROWS (물량 날조 금지),
 *   4. the runner turns a throw into a stage:'plan' refusal.
 *
 * Determinism note: a live LLM is not byte-deterministic; the schema coercion
 * guarantees only that whatever passes is a structurally valid, gate-eligible
 * plan — correctness is still decided by the real construction gates (concrete/
 * rebar/formwork takeoff, CPM schedule, cost rollup, earthwork balance).
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import {
  retrieveKdsClauses,
  formatKdsClausesBlock,
} from '@/lib/ai/reference/retrieveKdsClauses';
import type { ConstructionBrief, ConstructionPlan } from './module';
import type {
  Activity,
  ConcreteElement,
  CostLineItem,
  FormworkElement,
  Predecessor,
  RebarGroup,
} from './checks';

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
function optStr(v: unknown, path: string): string | undefined {
  return v === undefined || v === null ? undefined : reqStr(v, path);
}

// ─── concrete elements ─────────────────────────────────────────────────────────

function coerceConcreteElement(v: unknown, path: string): ConcreteElement {
  const o = reqObj(v, path);
  const e: ConcreteElement = {
    b_m: reqNum(o.b_m, `${path}.b_m`),
    h_m: reqNum(o.h_m, `${path}.h_m`),
    L_m: reqNum(o.L_m, `${path}.L_m`),
  };
  const tag = optStr(o.tag, `${path}.tag`);
  if (tag !== undefined) e.tag = tag;
  const count = optNum(o.count, `${path}.count`);
  if (count !== undefined) e.count = count;
  return e;
}

// ─── rebar groups ──────────────────────────────────────────────────────────────

function coerceRebarGroup(v: unknown, path: string): RebarGroup {
  const o = reqObj(v, path);
  const g: RebarGroup = {
    nominalDia_mm: reqNum(o.nominalDia_mm, `${path}.nominalDia_mm`),
    length_m: reqNum(o.length_m, `${path}.length_m`),
  };
  const tag = optStr(o.tag, `${path}.tag`);
  if (tag !== undefined) g.tag = tag;
  const count = optNum(o.count, `${path}.count`);
  if (count !== undefined) g.count = count;
  return g;
}

// ─── activities (with FS predecessors, string | {id,lag_days?}) ─────────────────

function coercePredecessor(v: unknown, path: string): Predecessor {
  if (typeof v === 'string') {
    if (v.length === 0) throw new Error(`${path}: expected a non-empty string`);
    return v;
  }
  const o = reqObj(v, path);
  const p: { id: string; lag_days?: number } = { id: reqStr(o.id, `${path}.id`) };
  const lag = optNum(o.lag_days, `${path}.lag_days`);
  if (lag !== undefined) p.lag_days = lag;
  return p;
}

function coerceActivity(v: unknown, path: string): Activity {
  const o = reqObj(v, path);
  const a: Activity = {
    id: reqStr(o.id, `${path}.id`),
    duration_days: reqNum(o.duration_days, `${path}.duration_days`),
  };
  if (o.predecessors !== undefined && o.predecessors !== null) {
    const raw = reqArray(o.predecessors, `${path}.predecessors`);
    a.predecessors = raw.map((p, i) => coercePredecessor(p, `${path}.predecessors[${i}]`));
  }
  return a;
}

// ─── formwork elements (discriminated by type) ──────────────────────────────────

function coerceFormworkElement(v: unknown, path: string): FormworkElement {
  const o = reqObj(v, path);
  const type = reqStr(o.type, `${path}.type`);
  const tag = optStr(o.tag, `${path}.tag`);
  const count = optNum(o.count, `${path}.count`);
  const withTagCount = <T extends object>(base: T): T & { tag?: string; count?: number } => {
    const e = base as T & { tag?: string; count?: number };
    if (tag !== undefined) e.tag = tag;
    if (count !== undefined) e.count = count;
    return e;
  };

  if (type === 'beam') {
    return withTagCount({
      type: 'beam' as const,
      b_m: reqNum(o.b_m, `${path}.b_m`),
      h_m: reqNum(o.h_m, `${path}.h_m`),
      L_m: reqNum(o.L_m, `${path}.L_m`),
    });
  }
  if (type === 'column') {
    return withTagCount({
      type: 'column' as const,
      b_m: reqNum(o.b_m, `${path}.b_m`),
      h_m: reqNum(o.h_m, `${path}.h_m`),
      L_m: reqNum(o.L_m, `${path}.L_m`),
    });
  }
  if (type === 'wall') {
    const e = withTagCount({
      type: 'wall' as const,
      L_m: reqNum(o.L_m, `${path}.L_m`),
      h_m: reqNum(o.h_m, `${path}.h_m`),
    }) as FormworkElement & { sides?: number };
    const sides = optNum(o.sides, `${path}.sides`);
    if (sides !== undefined) e.sides = sides;
    return e;
  }
  if (type === 'slab-soffit') {
    return withTagCount({
      type: 'slab-soffit' as const,
      b_m: reqNum(o.b_m, `${path}.b_m`),
      L_m: reqNum(o.L_m, `${path}.L_m`),
    });
  }
  throw new Error(`${path}.type='${type}' invalid (beam|column|wall|slab-soffit)`);
}

// ─── cost line items ───────────────────────────────────────────────────────────

function coerceCostLineItem(v: unknown, path: string): CostLineItem {
  const o = reqObj(v, path);
  const li: CostLineItem = {
    quantity: reqNum(o.quantity, `${path}.quantity`),
    unitRate: reqNum(o.unitRate, `${path}.unitRate`),
  };
  const description = optStr(o.description, `${path}.description`);
  if (description !== undefined) li.description = description;
  return li;
}

// ─── earthwork ─────────────────────────────────────────────────────────────────

function coerceEarthwork(v: unknown, path: string): NonNullable<ConstructionPlan['earthwork']> {
  const o = reqObj(v, path);
  const e: NonNullable<ConstructionPlan['earthwork']> = {
    cutBankM3: reqNum(o.cutBankM3, `${path}.cutBankM3`),
    fillCompactedM3: reqNum(o.fillCompactedM3, `${path}.fillCompactedM3`),
  };
  const cf = optNum(o.compactionFactor, `${path}.compactionFactor`);
  if (cf !== undefined) e.compactionFactor = cf;
  const tol = optNum(o.toleranceM3, `${path}.toleranceM3`);
  if (tol !== undefined) e.toleranceM3 = tol;
  return e;
}

/** Coerce arbitrary parsed JSON into a ConstructionPlan, or throw (물량 날조 금지). */
export function coerceConstructionPlan(v: unknown): ConstructionPlan {
  const o = reqObj(v, 'plan');
  if (o.error === 'unsupported') {
    const reason = typeof o.reason === 'string' ? o.reason : 'no reason given';
    throw new Error(`planner declined the brief as unsupported: ${reason}`);
  }

  const concreteRaw = reqArray(o.concreteElements, 'plan.concreteElements');
  if (concreteRaw.length === 0) throw new Error('plan.concreteElements: at least one element required');
  const rebarRaw = reqArray(o.rebarGroups, 'plan.rebarGroups');
  if (rebarRaw.length === 0) throw new Error('plan.rebarGroups: at least one group required');
  const activitiesRaw = reqArray(o.activities, 'plan.activities');
  if (activitiesRaw.length === 0) throw new Error('plan.activities: at least one activity required');

  const plan: ConstructionPlan = {
    planId: reqStr(o.planId, 'plan.planId'),
    name: reqStr(o.name, 'plan.name'),
    concreteElements: concreteRaw.map((e, i) => coerceConcreteElement(e, `plan.concreteElements[${i}]`)),
    claimedConcreteM3: reqNum(o.claimedConcreteM3, 'plan.claimedConcreteM3'),
    rebarGroups: rebarRaw.map((g, i) => coerceRebarGroup(g, `plan.rebarGroups[${i}]`)),
    claimedRebarKg: reqNum(o.claimedRebarKg, 'plan.claimedRebarKg'),
    activities: activitiesRaw.map((a, i) => coerceActivity(a, `plan.activities[${i}]`)),
  };

  const wasteFactor = optNum(o.wasteFactor, 'plan.wasteFactor');
  if (wasteFactor !== undefined) plan.wasteFactor = wasteFactor;
  const rebarToleranceKg = optNum(o.rebarToleranceKg, 'plan.rebarToleranceKg');
  if (rebarToleranceKg !== undefined) plan.rebarToleranceKg = rebarToleranceKg;
  const deadlineDays = optNum(o.deadlineDays, 'plan.deadlineDays');
  if (deadlineDays !== undefined) plan.deadlineDays = deadlineDays;

  // ── optional formwork block ──
  if (o.formworkElements !== undefined && o.formworkElements !== null) {
    const fwRaw = reqArray(o.formworkElements, 'plan.formworkElements');
    plan.formworkElements = fwRaw.map((e, i) => coerceFormworkElement(e, `plan.formworkElements[${i}]`));
  }
  const claimedFormworkM2 = optNum(o.claimedFormworkM2, 'plan.claimedFormworkM2');
  if (claimedFormworkM2 !== undefined) plan.claimedFormworkM2 = claimedFormworkM2;
  const formworkToleranceM2 = optNum(o.formworkToleranceM2, 'plan.formworkToleranceM2');
  if (formworkToleranceM2 !== undefined) plan.formworkToleranceM2 = formworkToleranceM2;

  // ── optional cost block ──
  if (o.costLineItems !== undefined && o.costLineItems !== null) {
    const ciRaw = reqArray(o.costLineItems, 'plan.costLineItems');
    plan.costLineItems = ciRaw.map((li, i) => coerceCostLineItem(li, `plan.costLineItems[${i}]`));
  }
  const budget = optNum(o.budget, 'plan.budget');
  if (budget !== undefined) plan.budget = budget;
  const contingencyFactor = optNum(o.contingencyFactor, 'plan.contingencyFactor');
  if (contingencyFactor !== undefined) plan.contingencyFactor = contingencyFactor;

  // ── optional earthwork block ──
  if (o.earthwork !== undefined && o.earthwork !== null) {
    plan.earthwork = coerceEarthwork(o.earthwork, 'plan.earthwork');
  }

  return plan;
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

export const CONSTRUCTION_SYSTEM_PROMPT = `You are the planning stage of a CONSTRUCTION quantity-takeoff / scheduling driver. Your ONLY output is a ConstructionPlan as a single JSON object. You never compute volumes, weights, critical paths or costs — a deterministic engine REAL-checks every takeoff and schedule. Fabricated numbers are worthless; only a structurally valid plan the engine can verify is useful.

Return ONLY the JSON object (no prose, no markdown). If the request cannot be expressed within the schema, return {"error":"unsupported","reason":"<why>"} instead of guessing.

Any "Relevant KDS/KCS design-code clauses" listed under the brief are CITED, NON-AUTHORITATIVE references to the governing code — cite them where they apply, but NEVER copy their numbers into your plan as facts; the code-verified engine computes and checks every value.

ConstructionPlan schema (unknown fields dropped; wrong types rejected):
{
  "planId": string, "name": string,
  "concreteElements": [ { "tag":string?, "count":number?, "b_m":number, "h_m":number, "L_m":number } ],   // >= 1
  "claimedConcreteM3": number,
  "wasteFactor": number?,
  "rebarGroups": [ { "tag":string?, "nominalDia_mm":number, "length_m":number, "count":number? } ],         // >= 1
  "claimedRebarKg": number,
  "rebarToleranceKg": number?,
  "activities": [ { "id":string, "duration_days":number, "predecessors": (string | {"id":string,"lag_days":number?})[]? } ], // >= 1
  "deadlineDays": number?,
  // ── optional blocks (each gate runs only if present) ──
  "formworkElements": [ ONE of
     {"type":"beam","tag":string?,"count":number?,"b_m":number,"h_m":number,"L_m":number},
     {"type":"column","tag":string?,"count":number?,"b_m":number,"h_m":number,"L_m":number},
     {"type":"wall","tag":string?,"count":number?,"L_m":number,"h_m":number,"sides":number?},
     {"type":"slab-soffit","tag":string?,"count":number?,"b_m":number,"L_m":number}
  ]?,
  "claimedFormworkM2": number?, "formworkToleranceM2": number?,
  "costLineItems": [ { "description":string?, "quantity":number, "unitRate":number } ]?,
  "budget": number?, "contingencyFactor": number?,
  "earthwork": { "cutBankM3":number, "fillCompactedM3":number, "compactionFactor":number?, "toleranceM3":number? }?
}

HONESTY: never fabricate quantities, unit rates or masses not implied by the brief — if a needed quantity is missing, REFUSE with {"error":"unsupported","reason":...}. A verified takeoff is a licensed engineer/QS's copilot output, NOT a replacement; any quantified structural member remains a licensed engineer's responsibility.`;

// ─── the planner ───────────────────────────────────────────────────────────────

export interface ConstructionLlmPlannerDeps {
  complete: (messages: ChatMessage[]) => Promise<string>;
  systemPrompt?: string;
}

function buildMessages(brief: ConstructionBrief, systemPrompt: string): ChatMessage[] {
  let user = (brief.text ?? '').trim();
  if (brief.params && Object.keys(brief.params).length > 0) {
    user += `\n\nStructured parameters (JSON): ${JSON.stringify(brief.params)}`;
  }
  // Lever C — deterministic in-repo KDS/KCS grounding (cited, NON-AUTHORITATIVE);
  // the code-verified engine + coerce gate still decide truth.
  const clauseBlock = formatKdsClausesBlock(retrieveKdsClauses(brief.text ?? ''));
  if (clauseBlock) user += `\n\n${clauseBlock}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user.length > 0 ? user : '(empty brief)' },
  ];
}

/** Build a ConstructionPlan LLM planner over an injected completion (tests pass a mock). */
export function makeConstructionLlmPlanner(
  deps: ConstructionLlmPlannerDeps,
): (brief: ConstructionBrief) => Promise<ConstructionPlan> {
  const systemPrompt = deps.systemPrompt ?? CONSTRUCTION_SYSTEM_PROMPT;
  return async (brief) => {
    const messages = buildMessages(brief, systemPrompt);
    const raw = await deps.complete(messages);
    return coerceConstructionPlan(extractJson(raw));
  };
}

/** Production planner: wired to the shared chatCompletion provider chain. */
export function chatCompletionConstructionPlanner(): (brief: ConstructionBrief) => Promise<ConstructionPlan> {
  return makeConstructionLlmPlanner({
    complete: async (messages) => {
      const res = await chatCompletion({ messages, temperature: 0, maxTokens: 2000, timeoutMs: 60_000, task: 'construction-plan' });
      return res.text;
    },
  });
}
