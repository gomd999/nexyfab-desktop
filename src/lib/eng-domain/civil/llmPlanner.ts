/**
 * eng-domain/civil/llmPlanner — WA-D pattern for CIVIL (다분야 확장 #2 LLM 플래너).
 *
 * The LLM's role is CONFINED to producing a `CivilPlan` from a free-text brief —
 * exactly the mechanical llmPlanner contract, replicated per domain. Model text
 * never reaches the gate chain unchecked:
 *   1. call an INJECTED `complete(messages)` (deterministic mock in tests),
 *   2. extract JSON (markdown-fence tolerant),
 *   3. coerce into the CivilPlan schema — unknown fields dropped, every required
 *      field + member kind type-checked; any violation THROWS (계획 날조 금지),
 *   4. the runner turns a throw into a stage:'plan' refusal.
 *
 * Determinism note: a live LLM is not byte-deterministic; the schema coercion
 * guarantees only that whatever passes is a structurally valid, gate-eligible
 * plan — correctness is still decided by the real civil gates.
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import type {
  CivilBeamMember,
  CivilBrief,
  CivilColumnMember,
  CivilMember,
  CivilPlan,
  CivilSlopeMember,
  CivilWallMember,
} from './module';
import type { BeamLoad } from './checks';

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
function optMaterial(v: unknown, path: string): 'steel' | 'concrete' | undefined {
  if (v === undefined || v === null) return undefined;
  const s = reqStr(v, path);
  if (s !== 'steel' && s !== 'concrete') throw new Error(`${path}='${s}' invalid (steel|concrete)`);
  return s;
}

// ─── beam load ───────────────────────────────────────────────────────────────

function coerceBeamLoad(v: unknown, path: string): BeamLoad {
  const o = reqObj(v, path);
  const type = reqStr(o.type, `${path}.type`);
  if (type === 'moment') return { type: 'moment', momentKNm: reqNum(o.momentKNm, `${path}.momentKNm`) };
  if (type === 'udl') return { type: 'udl', w_kNpm: reqNum(o.w_kNpm, `${path}.w_kNpm`), span_m: reqNum(o.span_m, `${path}.span_m`) };
  if (type === 'point') return { type: 'point', P_kN: reqNum(o.P_kN, `${path}.P_kN`), span_m: reqNum(o.span_m, `${path}.span_m`) };
  throw new Error(`${path}.type='${type}' invalid (moment|udl|point)`);
}

// ─── member coercion by kind ──────────────────────────────────────────────────

function coerceMember(v: unknown, path: string): CivilMember {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  const id = reqStr(o.id, `${path}.id`);
  const name = reqStr(o.name, `${path}.name`);
  const material = optMaterial(o.material, `${path}.material`);

  if (kind === 'beam') {
    const m: CivilBeamMember = {
      kind: 'beam', id, name,
      spanM: reqNum(o.spanM, `${path}.spanM`),
      load: coerceBeamLoad(o.load, `${path}.load`),
      sectionModulusMm3: reqNum(o.sectionModulusMm3, `${path}.sectionModulusMm3`),
      inertiaMm4: reqNum(o.inertiaMm4, `${path}.inertiaMm4`),
      allowableStressMPa: reqNum(o.allowableStressMPa, `${path}.allowableStressMPa`),
    };
    if (material) m.material = material;
    const dld = optNum(o.deflectionLimitDenominator, `${path}.deflectionLimitDenominator`);
    if (dld !== undefined) m.deflectionLimitDenominator = dld;
    return m;
  }
  if (kind === 'column') {
    const m: CivilColumnMember = {
      kind: 'column', id, name,
      inertiaMm4: reqNum(o.inertiaMm4, `${path}.inertiaMm4`),
      effectiveLengthFactorK: reqNum(o.effectiveLengthFactorK, `${path}.effectiveLengthFactorK`),
      unbracedLengthMm: reqNum(o.unbracedLengthMm, `${path}.unbracedLengthMm`),
      radiusOfGyrationMm: reqNum(o.radiusOfGyrationMm, `${path}.radiusOfGyrationMm`),
      axialDemandKN: reqNum(o.axialDemandKN, `${path}.axialDemandKN`),
      requiredSF: reqNum(o.requiredSF, `${path}.requiredSF`),
    };
    if (material) m.material = material;
    const sl = optNum(o.slendernessLimit, `${path}.slendernessLimit`);
    if (sl !== undefined) m.slendernessLimit = sl;
    return m;
  }
  if (kind === 'retaining-wall') {
    const m: CivilWallMember = {
      kind: 'retaining-wall', id, name,
      heightM: reqNum(o.heightM, `${path}.heightM`),
      stemThicknessM: reqNum(o.stemThicknessM, `${path}.stemThicknessM`),
      baseWidthM: reqNum(o.baseWidthM, `${path}.baseWidthM`),
      baseThicknessM: reqNum(o.baseThicknessM, `${path}.baseThicknessM`),
      toeLengthM: reqNum(o.toeLengthM, `${path}.toeLengthM`),
      gammaBackfillKNm3: reqNum(o.gammaBackfillKNm3, `${path}.gammaBackfillKNm3`),
      phiBackfillDeg: reqNum(o.phiBackfillDeg, `${path}.phiBackfillDeg`),
      requiredFS: reqNum(o.requiredFS, `${path}.requiredFS`),
    };
    const sur = optNum(o.surchargeKPa, `${path}.surchargeKPa`);
    if (sur !== undefined) m.surchargeKPa = sur;
    return m;
  }
  if (kind === 'slope') {
    const m: CivilSlopeMember = {
      kind: 'slope', id, name,
      slopeDeg: reqNum(o.slopeDeg, `${path}.slopeDeg`),
      phiDeg: reqNum(o.phiDeg, `${path}.phiDeg`),
      depthM: reqNum(o.depthM, `${path}.depthM`),
      gammaKNm3: reqNum(o.gammaKNm3, `${path}.gammaKNm3`),
      requiredFS: reqNum(o.requiredFS, `${path}.requiredFS`),
    };
    const coh = optNum(o.cohesionKPa, `${path}.cohesionKPa`);
    if (coh !== undefined) m.cohesionKPa = coh;
    const wd = optNum(o.waterDepthM, `${path}.waterDepthM`);
    if (wd !== undefined) m.waterDepthM = wd;
    return m;
  }
  throw new Error(`${path}.kind='${kind}' invalid (beam|column|retaining-wall|slope)`);
}

/** Coerce arbitrary parsed JSON into a CivilPlan, or throw (계획 날조 금지). */
export function coerceCivilPlan(v: unknown): CivilPlan {
  const o = reqObj(v, 'plan');
  if (isObj(o) && o.error === 'unsupported') {
    const reason = typeof o.reason === 'string' ? o.reason : 'no reason given';
    throw new Error(`planner declined the brief as unsupported: ${reason}`);
  }
  const membersRaw = reqArray(o.members, 'plan.members');
  if (membersRaw.length === 0) throw new Error('plan.members: at least one member required');
  return {
    planId: reqStr(o.planId, 'plan.planId'),
    name: reqStr(o.name, 'plan.name'),
    members: membersRaw.map((m, i) => coerceMember(m, `plan.members[${i}]`)),
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

export const CIVIL_SYSTEM_PROMPT = `You are the planning stage of a CIVIL/STRUCTURAL design driver. Your ONLY output is a CivilPlan as a single JSON object. You never compute stresses or safety factors — a deterministic engine REAL-checks every member against code. Fabricated numbers are worthless; only a structurally valid plan the engine can verify is useful.

Return ONLY the JSON object (no prose, no markdown). If the request cannot be expressed within the schema, return {"error":"unsupported","reason":"<why>"} instead of guessing.

CivilPlan schema (unknown fields dropped; wrong types rejected):
{
  "planId": string, "name": string,
  "members": [                       // >= 1; each member is ONE of:
    { "kind":"beam", "id":string, "name":string, "material":"steel"|"concrete"?,
      "spanM":number, "load":{"type":"udl","w_kNpm":number,"span_m":number} | {"type":"point","P_kN":number,"span_m":number} | {"type":"moment","momentKNm":number},
      "sectionModulusMm3":number, "inertiaMm4":number, "allowableStressMPa":number, "deflectionLimitDenominator":number? },
    { "kind":"column", "id":string, "name":string, "material":"steel"|"concrete"?,
      "inertiaMm4":number, "effectiveLengthFactorK":number, "unbracedLengthMm":number, "radiusOfGyrationMm":number,
      "axialDemandKN":number, "requiredSF":number, "slendernessLimit":number? },
    { "kind":"retaining-wall", "id":string, "name":string,
      "heightM":number, "stemThicknessM":number, "baseWidthM":number, "baseThicknessM":number, "toeLengthM":number,
      "gammaBackfillKNm3":number, "phiBackfillDeg":number, "surchargeKPa":number?, "requiredFS":number },
    { "kind":"slope", "id":string, "name":string,
      "slopeDeg":number, "phiDeg":number, "cohesionKPa":number?, "depthM":number, "gammaKNm3":number, "waterDepthM":number?, "requiredFS":number }
  ]
}

HONESTY: never fabricate section properties or loads not implied by the brief — if a needed quantity is missing, REFUSE with {"error":"unsupported","reason":...}. A verified draft is a licensed engineer's copilot output, NOT a replacement.`;

// ─── the planner ───────────────────────────────────────────────────────────────

export interface CivilLlmPlannerDeps {
  complete: (messages: ChatMessage[]) => Promise<string>;
  systemPrompt?: string;
}

function buildMessages(brief: CivilBrief, systemPrompt: string): ChatMessage[] {
  let user = (brief.text ?? '').trim();
  if (brief.params && Object.keys(brief.params).length > 0) {
    user += `\n\nStructured parameters (JSON): ${JSON.stringify(brief.params)}`;
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user.length > 0 ? user : '(empty brief)' },
  ];
}

/** Build a CivilPlan LLM planner over an injected completion (tests pass a mock). */
export function makeCivilLlmPlanner(deps: CivilLlmPlannerDeps): (brief: CivilBrief) => Promise<CivilPlan> {
  const systemPrompt = deps.systemPrompt ?? CIVIL_SYSTEM_PROMPT;
  return async (brief) => {
    const messages = buildMessages(brief, systemPrompt);
    const raw = await deps.complete(messages);
    return coerceCivilPlan(extractJson(raw));
  };
}

/** Production planner: wired to the shared chatCompletion provider chain. */
export function chatCompletionCivilPlanner(): (brief: CivilBrief) => Promise<CivilPlan> {
  return makeCivilLlmPlanner({
    complete: async (messages) => {
      const res = await chatCompletion({ messages, temperature: 0, maxTokens: 2000, timeoutMs: 60_000, task: 'civil-design-plan' });
      return res.text;
    },
  });
}
