/**
 * eng-domain/civil/llmPlanner — WA-D pattern for CIVIL (통합판: 엔진-입력 스키마).
 *
 * Free text → LLM → JSON → coerced `CivilPlan` → the civil module runs each
 * member through the REAL engineering-core calculators. The plan therefore
 * carries the CALCULATOR inputs (Sx/Aw/Fy/Ag/baseFriction/allowableBearing…) —
 * the LLM must supply what the real calc needs; a missing load makes the calc
 * THROW and the gate fail (하중 날조 금지). Coercion rejects any malformed member.
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import {
  retrieveKdsClauses,
  formatKdsClausesBlock,
} from '@/lib/ai/reference/retrieveKdsClauses';
import type {
  CivilBeamMember,
  CivilBrief,
  CivilColumnMember,
  CivilMember,
  CivilPlan,
  CivilSlopeMember,
  CivilWallMember,
} from './module';

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

// ─── member coercion by kind (engine-input fields) ────────────────────────────

function coerceMember(v: unknown, path: string): CivilMember {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  const id = reqStr(o.id, `${path}.id`);
  const name = reqStr(o.name, `${path}.name`);

  if (kind === 'beam') {
    const m: CivilBeamMember = {
      kind: 'beam', id, name,
      spanMm: reqNum(o.spanMm, `${path}.spanMm`),
      yieldStrengthMPa: reqNum(o.yieldStrengthMPa, `${path}.yieldStrengthMPa`),
      sectionModulusMm3: reqNum(o.sectionModulusMm3, `${path}.sectionModulusMm3`),
      webShearAreaMm2: reqNum(o.webShearAreaMm2, `${path}.webShearAreaMm2`),
      inertiaMm4: reqNum(o.inertiaMm4, `${path}.inertiaMm4`),
    };
    const w = optNum(o.udlKNpm, `${path}.udlKNpm`);
    if (w !== undefined) m.udlKNpm = w;
    const P = optNum(o.pointLoadKN, `${path}.pointLoadKN`);
    if (P !== undefined) m.pointLoadKN = P;
    return m;
  }
  if (kind === 'column') {
    const m: CivilColumnMember = {
      kind: 'column', id, name,
      yieldStrengthMPa: reqNum(o.yieldStrengthMPa, `${path}.yieldStrengthMPa`),
      grossAreaMm2: reqNum(o.grossAreaMm2, `${path}.grossAreaMm2`),
      unbracedLengthMm: reqNum(o.unbracedLengthMm, `${path}.unbracedLengthMm`),
      radiusOfGyrationMm: reqNum(o.radiusOfGyrationMm, `${path}.radiusOfGyrationMm`),
      axialDemandKN: reqNum(o.axialDemandKN, `${path}.axialDemandKN`),
    };
    const k = optNum(o.effectiveLengthFactorK, `${path}.effectiveLengthFactorK`);
    if (k !== undefined) m.effectiveLengthFactorK = k;
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
      baseFriction: reqNum(o.baseFriction, `${path}.baseFriction`),
      allowableBearingKPa: reqNum(o.allowableBearingKPa, `${path}.allowableBearingKPa`),
    };
    const kh = optNum(o.seismicKh, `${path}.seismicKh`);
    if (kh !== undefined) m.seismicKh = kh;
    return m;
  }
  if (kind === 'slope') {
    const m: CivilSlopeMember = {
      kind: 'slope', id, name,
      slopeDeg: reqNum(o.slopeDeg, `${path}.slopeDeg`),
      phiDeg: reqNum(o.phiDeg, `${path}.phiDeg`),
      depthM: reqNum(o.depthM, `${path}.depthM`),
      gammaKNm3: reqNum(o.gammaKNm3, `${path}.gammaKNm3`),
      fsRequired: reqNum(o.fsRequired, `${path}.fsRequired`),
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

export const CIVIL_SYSTEM_PROMPT = `You are the planning stage of a CIVIL/STRUCTURAL design driver. Your ONLY output is a CivilPlan as a single JSON object. You never compute stresses or safety factors — a deterministic, KDS-verified engine (engineering-core) REAL-checks every member. Fabricated numbers are worthless; only a structurally valid plan the engine can verify is useful.

Return ONLY the JSON object (no prose, no markdown). If a required quantity (a LOAD, a section property, a soil parameter) is not given or clearly implied by the brief, do NOT invent it — return {"error":"unsupported","reason":"<what is missing>"} instead.

Any "Relevant KDS/KCS design-code clauses" listed under the brief are CITED, NON-AUTHORITATIVE references to the governing code — cite them where they apply, but NEVER copy their numbers into your plan as facts; the KDS-verified engine computes and checks every value.

CivilPlan schema (unknown fields dropped; wrong types rejected). Each member's fields are the ENGINE's inputs:
{
  "planId": string, "name": string,
  "members": [                          // >= 1; each is ONE of:
    { "kind":"beam", "id":string, "name":string,
      "spanMm":number, "yieldStrengthMPa":number, "sectionModulusMm3":number, "webShearAreaMm2":number, "inertiaMm4":number,
      "udlKNpm":number?, "pointLoadKN":number? },          // at least one load required — else the engine refuses
    { "kind":"column", "id":string, "name":string,
      "yieldStrengthMPa":number, "grossAreaMm2":number, "unbracedLengthMm":number, "radiusOfGyrationMm":number,
      "axialDemandKN":number, "effectiveLengthFactorK":number? },
    { "kind":"retaining-wall", "id":string, "name":string,
      "heightM":number, "stemThicknessM":number, "baseWidthM":number, "baseThicknessM":number, "toeLengthM":number,
      "gammaBackfillKNm3":number, "phiBackfillDeg":number, "baseFriction":number, "allowableBearingKPa":number, "seismicKh":number? },
    { "kind":"slope", "id":string, "name":string,
      "slopeDeg":number, "phiDeg":number, "depthM":number, "gammaKNm3":number, "fsRequired":number, "cohesionKPa":number?, "waterDepthM":number? }
  ]
}

HONESTY: never fabricate section properties, loads, or soil parameters. If the brief lacks them, REFUSE with {"error":"unsupported",...}. A verified draft is a licensed engineer's copilot output, NOT a replacement.`;

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
  // Lever C — deterministic in-repo KDS/KCS grounding: cite the governing
  // design-code clauses (from the calc catalog) so the model references rather
  // than invents them. Cited, NON-AUTHORITATIVE; the KDS-verified engine + the
  // coerce gate still decide truth, so no clause number becomes a plan value.
  const clauseBlock = formatKdsClausesBlock(retrieveKdsClauses(brief.text ?? ''));
  if (clauseBlock) user += `\n\n${clauseBlock}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user.length > 0 ? user : '(empty brief)' },
  ];
}

export function makeCivilLlmPlanner(deps: CivilLlmPlannerDeps): (brief: CivilBrief) => Promise<CivilPlan> {
  const systemPrompt = deps.systemPrompt ?? CIVIL_SYSTEM_PROMPT;
  return async (brief) => {
    const messages = buildMessages(brief, systemPrompt);
    const raw = await deps.complete(messages);
    return coerceCivilPlan(extractJson(raw));
  };
}

export function chatCompletionCivilPlanner(): (brief: CivilBrief) => Promise<CivilPlan> {
  return makeCivilLlmPlanner({
    complete: async (messages) => {
      const res = await chatCompletion({ messages, temperature: 0, maxTokens: 2000, timeoutMs: 60_000, task: 'civil-design-plan' });
      return res.text;
    },
  });
}
