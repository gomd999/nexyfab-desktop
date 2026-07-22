/**
 * eng-domain/landscape/llmPlanner — WA-D pattern for LANDSCAPE (다분야 확장 #2 LLM 플래너).
 *
 * The LLM's role is CONFINED to producing a `LandscapePlan` from a free-text brief —
 * exactly the mechanical llmPlanner contract, replicated per domain. Model text
 * never reaches the gate chain unchecked:
 *   1. call an INJECTED `complete(messages)` (deterministic mock in tests),
 *   2. extract JSON (markdown-fence tolerant),
 *   3. coerce into the LandscapePlan schema — unknown fields dropped, every required
 *      field type-checked, every enum field validated against its real union values;
 *      any violation THROWS (계획 날조 금지),
 *   4. the runner turns a throw into a stage:'plan' refusal.
 *
 * Determinism note: a live LLM is not byte-deterministic; the schema coercion
 * guarantees only that whatever passes is a structurally valid, gate-eligible
 * plan — correctness is still decided by the real landscape gates (조례/AHJ 우선).
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import {
  retrieveKdsClauses,
  formatKdsClausesBlock,
} from '@/lib/ai/reference/retrieveKdsClauses';
import type { LandscapeBrief, LandscapePlan } from './module';
import type { DrainageSurface, LandUseZone, SoilCategory, SpacingCategory } from './checks';

// ─── coercion primitives (violation ⇒ throw = plan refusal) ─────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function reqObj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new Error(`${path}: expected an object`);
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

// ─── enum validators (unknown value ⇒ throw = plan refusal) ──────────────────

const ZONES: readonly LandUseZone[] = ['residential', 'commercial', 'industrial', 'green', 'general'];
const DRAINAGE_SURFACES: readonly DrainageSurface[] = ['paving', 'permeablePaving', 'lawn', 'plantingBed', 'plaza', 'sportsField'];
const SOIL_CATEGORIES: readonly SoilCategory[] = ['교목', '아교목', '관목', '지피초화류'];
const SPACING_CATEGORIES: readonly SpacingCategory[] = ['교목', '아교목', '관목', '생울타리', '지피초화류'];

function optZone(v: unknown, path: string): LandUseZone | undefined {
  if (v === undefined || v === null) return undefined;
  const s = reqStr(v, path);
  if (!(ZONES as readonly string[]).includes(s)) throw new Error(`${path}='${s}' invalid (${ZONES.join('|')})`);
  return s as LandUseZone;
}
function optDrainageSurface(v: unknown, path: string): DrainageSurface | undefined {
  if (v === undefined || v === null) return undefined;
  const s = reqStr(v, path);
  if (!(DRAINAGE_SURFACES as readonly string[]).includes(s)) throw new Error(`${path}='${s}' invalid (${DRAINAGE_SURFACES.join('|')})`);
  return s as DrainageSurface;
}
function optSpacingCategory(v: unknown, path: string): SpacingCategory | undefined {
  if (v === undefined || v === null) return undefined;
  const s = reqStr(v, path);
  if (!(SPACING_CATEGORIES as readonly string[]).includes(s)) throw new Error(`${path}='${s}' invalid (${SPACING_CATEGORIES.join('|')})`);
  return s as SpacingCategory;
}
function reqSoilCategory(v: unknown, path: string): SoilCategory {
  const s = reqStr(v, path);
  if (!(SOIL_CATEGORIES as readonly string[]).includes(s)) throw new Error(`${path}='${s}' invalid (${SOIL_CATEGORIES.join('|')})`);
  return s as SoilCategory;
}

// ─── nested-block coercion ────────────────────────────────────────────────────

function coerceIrrigation(v: unknown, path: string): LandscapePlan['irrigation'] {
  const o = reqObj(v, path);
  const out: LandscapePlan['irrigation'] = {
    headCount: reqNum(o.headCount, `${path}.headCount`),
    coverageRadiusM: reqNum(o.coverageRadiusM, `${path}.coverageRadiusM`),
    targetAreaM2: reqNum(o.targetAreaM2, `${path}.targetAreaM2`),
  };
  const overlap = optNum(o.overlapFactor, `${path}.overlapFactor`);
  if (overlap !== undefined) out.overlapFactor = overlap;
  const uniformity = optNum(o.requiredUniformity, `${path}.requiredUniformity`);
  if (uniformity !== undefined) out.requiredUniformity = uniformity;
  return out;
}

function coerceDrainage(v: unknown, path: string): LandscapePlan['drainage'] {
  const o = reqObj(v, path);
  const out: LandscapePlan['drainage'] = {
    measuredGradePct: reqNum(o.measuredGradePct, `${path}.measuredGradePct`),
  };
  const surface = optDrainageSurface(o.surfaceType, `${path}.surfaceType`);
  if (surface !== undefined) out.surfaceType = surface;
  return out;
}

function coercePlanting(v: unknown, path: string): LandscapePlan['planting'] {
  const o = reqObj(v, path);
  const out: LandscapePlan['planting'] = {
    plantCount: reqNum(o.plantCount, `${path}.plantCount`),
    areaM2: reqNum(o.areaM2, `${path}.areaM2`),
  };
  const category = optSpacingCategory(o.category, `${path}.category`);
  if (category !== undefined) out.category = category;
  const override = optNum(o.minSpacingMOverride, `${path}.minSpacingMOverride`);
  if (override !== undefined) out.minSpacingMOverride = override;
  return out;
}

function coerceSoil(v: unknown, path: string): LandscapePlan['soil'] {
  const o = reqObj(v, path);
  return {
    category: reqSoilCategory(o.category, `${path}.category`),
    providedDepthM: reqNum(o.providedDepthM, `${path}.providedDepthM`),
  };
}

/** Coerce arbitrary parsed JSON into a LandscapePlan, or throw (계획 날조 금지). */
export function coerceLandscapePlan(v: unknown): LandscapePlan {
  const o = reqObj(v, 'plan');
  if (o.error === 'unsupported') {
    const reason = typeof o.reason === 'string' ? o.reason : 'no reason given';
    throw new Error(`planner declined the brief as unsupported: ${reason}`);
  }
  const out: LandscapePlan = {
    planId: reqStr(o.planId, 'plan.planId'),
    name: reqStr(o.name, 'plan.name'),
    siteAreaM2: reqNum(o.siteAreaM2, 'plan.siteAreaM2'),
    landscapedAreaM2: reqNum(o.landscapedAreaM2, 'plan.landscapedAreaM2'),
    irrigation: coerceIrrigation(o.irrigation, 'plan.irrigation'),
    drainage: coerceDrainage(o.drainage, 'plan.drainage'),
    planting: coercePlanting(o.planting, 'plan.planting'),
    soil: coerceSoil(o.soil, 'plan.soil'),
  };
  const zone = optZone(o.zone, 'plan.zone');
  if (zone !== undefined) out.zone = zone;
  const greenOverride = optNum(o.greenMinRatioOverride, 'plan.greenMinRatioOverride');
  if (greenOverride !== undefined) out.greenMinRatioOverride = greenOverride;
  return out;
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

export const LANDSCAPE_SYSTEM_PROMPT = `You are the planning stage of a LANDSCAPE design driver. Your ONLY output is a LandscapePlan as a single JSON object. You never decide pass/fail — a deterministic engine REAL-checks the plan against 관수 커버리지·배수 구배·식재 간격·조경면적 비율·객토 깊이. Fabricated numbers are worthless; only a structurally valid plan the engine can verify is useful.

Return ONLY the JSON object (no prose, no markdown). If the request cannot be expressed within the schema, return {"error":"unsupported","reason":"<why>"} instead of guessing.

Any "Relevant KDS/KCS design-code clauses" listed under the brief are CITED, NON-AUTHORITATIVE references to the governing code — cite them where they apply, but NEVER copy their numbers into your plan as facts; the code-verified engine computes and checks every value.

LandscapePlan schema (unknown fields dropped; wrong types rejected; enum values must match exactly):
{
  "planId": string, "name": string,
  "siteAreaM2": number, "landscapedAreaM2": number,
  "zone": "residential"|"commercial"|"industrial"|"green"|"general"?,
  "greenMinRatioOverride": number?,                              // fraction e.g. 0.15
  "irrigation": { "headCount":number, "coverageRadiusM":number, "targetAreaM2":number, "overlapFactor":number?, "requiredUniformity":number? },
  "drainage":   { "measuredGradePct":number, "surfaceType":"paving"|"permeablePaving"|"lawn"|"plantingBed"|"plaza"|"sportsField"? },
  "planting":   { "plantCount":number, "areaM2":number, "category":"교목"|"아교목"|"관목"|"생울타리"|"지피초화류"?, "minSpacingMOverride":number? },
  "soil":       { "category":"교목"|"아교목"|"관목"|"지피초화류", "providedDepthM":number }
}

HONESTY: never fabricate areas, slopes, counts, or soil depths not implied by the brief — if a needed quantity is missing, REFUSE with {"error":"unsupported","reason":...}. 조경면적·배수 등 실제 기준은 지자체 조례/AHJ가 정하므로 인허가 도서는 조경/건축 전문가·조례 확인 대상이다. A verified draft is a licensed 조경/건축 professional's copilot output, NOT a replacement.`;

// ─── the planner ───────────────────────────────────────────────────────────────

export interface LandscapeLlmPlannerDeps {
  complete: (messages: ChatMessage[]) => Promise<string>;
  systemPrompt?: string;
}

function buildMessages(brief: LandscapeBrief, systemPrompt: string): ChatMessage[] {
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

/** Build a LandscapePlan LLM planner over an injected completion (tests pass a mock). */
export function makeLandscapeLlmPlanner(deps: LandscapeLlmPlannerDeps): (brief: LandscapeBrief) => Promise<LandscapePlan> {
  const systemPrompt = deps.systemPrompt ?? LANDSCAPE_SYSTEM_PROMPT;
  return async (brief) => {
    const messages = buildMessages(brief, systemPrompt);
    const raw = await deps.complete(messages);
    return coerceLandscapePlan(extractJson(raw));
  };
}

/** Production planner: wired to the shared chatCompletion provider chain. */
export function chatCompletionLandscapePlanner(): (brief: LandscapeBrief) => Promise<LandscapePlan> {
  return makeLandscapeLlmPlanner({
    complete: async (messages) => {
      const res = await chatCompletion({ messages, temperature: 0, maxTokens: 2000, timeoutMs: 60_000, task: 'landscape-plan' });
      return res.text;
    },
  });
}
