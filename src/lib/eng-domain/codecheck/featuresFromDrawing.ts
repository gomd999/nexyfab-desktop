/**
 * eng-domain/codecheck/featuresFromDrawing.ts — 도면(2D)에서 코드체크 피처 후보를 추출한다.
 *
 * WHY THIS IS ONLY A SUGGESTER (정직 계약):
 *  원본 DXF/DWG 도면은 "이 치수가 복도 유효너비다" 같은 의미 라벨을 스스로 갖지 않는다.
 *  치수 엔티티는 실측값(코드 42)과 (있으면) 표시 텍스트(코드 1)만 있고, 원은 반지름만,
 *  범위는 도면 전체 bbox 뿐이다. 따라서 자동 추출은 대부분 "후보 제안"에 그치고, 어느
 *  의미 슬롯에 배정할지는 사람이 확인한다(맹목 자동배정 = 거짓 PASS/FAIL 위험).
 *
 *  AUTO-FILL 은 오직 다음이 모두 성립할 때만 한다(모호하면 후보로 남긴다):
 *   1) DIMENSION 엔티티다(범위/원은 본질적으로 모호 → 자동배정 안 함).
 *   2) 표시 텍스트가 카테고리 키워드(주차·복도·경사로…)와 역할 키워드(폭·길이·높이…)를
 *      모두 담아 단 하나의 피처 키로 확정된다.
 *   3) 도면이 단위를 선언했다(mm/in). 미선언이면 metre 값을 지어낼 수 없으므로(정직 불변식
 *      "mm 추측 금지") 자동배정하지 않고 후보로만 둔다.
 *
 *  Units honesty: 도면이 단위를 선언하지 않으면 unit=null·meters=null (mm/m 추측 금지).
 *  결정론: AI·난수·시계 미사용. 같은 입력 → 같은 후보/자동배정.
 */

import type { CodeCheckFeatures } from './rules';

// Metre-length feature keys (end in `_m`) — the ONLY slots we ever auto-fill/guess. Excludes
// `_m2` areas, ratios, enums, booleans, counts (never inferable from a raw drawing measurement).
type MetreKey = Extract<keyof CodeCheckFeatures, `${string}_m`>;

// ── inputs we accept (both ingest paths) ──────────────────────────────────────
/** ir2d subset (src/lib/cad-ir/schema2d) — carries declared units + layers. */
export interface DrawingIr2dInput {
  units?: 'mm' | 'in' | null;
  extents?: { w: number; h: number } | null;
  dimensions?: Array<{ value: number; text?: string }>;
  circles?: Array<{ r: number }>;
}
/** dxf-seed subset (scripts/drawing-to-3d/dxf-seed.mjs) — NO units field (always undeclared). */
export interface DrawingSeedInput {
  dims?: Array<{ value: number; kind?: string; text?: string }>;
  measurements?: number[];
  circles?: Array<{ r: number }>;
  extents?: { w: number; h: number } | null;
}

// ── output shapes ─────────────────────────────────────────────────────────────
export type CandidateSource = 'extent' | 'dimension' | 'circle';

export interface DrawingFeatureCandidate {
  /** raw measured value in the drawing's native unit (mm/in) or unit-less when undeclared */
  value: number;
  /** native unit — 'mm'|'in' when declared, else null (never guessed) */
  unit: 'mm' | 'in' | null;
  /** where the value came from */
  source: CandidateSource;
  /** metre value iff the drawing declared its units; null otherwise (honesty: no mm guess) */
  meters: number | null;
  /** dimension display text / 'extent.w' / 'dia 1000' — for user traceability */
  label?: string;
  /** WEAK heuristic guess of the semantic slot (user CONFIRMS — never applied blindly) */
  guessedKey?: MetreKey;
  /** true when this candidate was strong enough to be pre-assigned in `autoFilled` (editable) */
  autoFilled?: boolean;
}

export interface AutoFillProvenance {
  key: MetreKey;
  value: number;
  label?: string;
  /** why this was safe to pre-assign (cat+role token match + known units) */
  reason: string;
}

export interface DrawingFeatureSuggestion {
  /** every measured value surfaced as a pick-list entry (user maps to a slot) */
  candidates: DrawingFeatureCandidate[];
  /** ONLY the unambiguous, unit-safe pre-assignments (editable by the user) */
  autoFilled: Partial<CodeCheckFeatures>;
  /** traceability: which measured value/token backed each auto-fill */
  autoFilledProvenance: AutoFillProvenance[];
  /** declared units echoed back (null = undeclared → no metre-based auto-fill was possible) */
  units: 'mm' | 'in' | null;
  /** honest, human-readable notes about what could/could not be inferred */
  notes: string[];
}

// ── unit conversion (only when declared) ──────────────────────────────────────
function toMeters(value: number, units: 'mm' | 'in' | null): number | null {
  if (units === 'mm') return round4(value / 1000);
  if (units === 'in') return round4((value * 25.4) / 1000);
  return null;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ── semantic token dictionary (auto-fill requires BOTH cat + role → one key) ──
// 카테고리 키워드 + 역할 키워드가 모두 맞아 단 하나의 피처 키로 확정될 때만 자동배정.
// 더 구체적인 항목(장애인 주차)을 앞에 두어 first-match 로 우선한다.
interface SemRule {
  key: MetreKey;
  /** category token(s) that must be present */
  cat: RegExp;
  /** the role token that pins width vs length vs height */
  role: RegExp;
  /** negative category token that would make this the WRONG key */
  not?: RegExp;
}

const ROLE_WIDTH = /폭|너비|width|\bW\s*=|(?<![A-Za-z])W(?![A-Za-z])/i;
const ROLE_LENGTH = /길이|length|\bL\s*=|(?<![A-Za-z])L(?![A-Za-z])/i;
const ROLE_HEIGHT = /높이|height|\bH\s*=|(?<![A-Za-z])H(?![A-Za-z])/i;
const ROLE_DEPTH = /깊이|depth|(?<![A-Za-z])D(?![A-Za-z])/i;

const SEM_RULES: SemRule[] = [
  // 장애인전용 주차 (must be tested before general 주차)
  { key: 'parkingDisabledStallWidth_m', cat: /장애인.*주차|주차.*장애인/i, role: ROLE_WIDTH },
  { key: 'parkingDisabledStallLength_m', cat: /장애인.*주차|주차.*장애인/i, role: ROLE_LENGTH },
  // 일반 주차단위구획
  { key: 'parkingStallWidth_m', cat: /주차|parking/i, role: ROLE_WIDTH, not: /장애인/i },
  { key: 'parkingStallLength_m', cat: /주차|parking/i, role: ROLE_LENGTH, not: /장애인/i },
  // 경사로
  { key: 'rampEffectiveWidth_m', cat: /경사로|ramp/i, role: ROLE_WIDTH },
  // 복도
  { key: 'corridorWidth_m', cat: /복도|corridor/i, role: ROLE_WIDTH },
  // 계단
  { key: 'stairEffectiveWidth_m', cat: /계단|stair/i, role: ROLE_WIDTH },
  // 출입구 / 문
  { key: 'doorEffectiveWidth_m', cat: /출입구|출입문|\b문\b|door/i, role: ROLE_WIDTH },
  // 접근로
  { key: 'approachPathWidth_m', cat: /접근로|approach/i, role: ROLE_WIDTH },
  // 난간
  { key: 'railingHeight_m', cat: /난간|railing/i, role: ROLE_HEIGHT },
  // 반자 / 천장 높이
  { key: 'ceilingHeight_m', cat: /반자|천장|ceiling/i, role: ROLE_HEIGHT },
  // 비상구
  { key: 'emergencyExitWidth_m', cat: /비상구|emergency\s*exit/i, role: ROLE_WIDTH },
  { key: 'emergencyExitHeight_m', cat: /비상구|emergency\s*exit/i, role: ROLE_HEIGHT },
  // 승강기
  { key: 'elevatorInternalWidth_m', cat: /승강기|elevator/i, role: ROLE_WIDTH },
  { key: 'elevatorInternalDepth_m', cat: /승강기|elevator/i, role: ROLE_DEPTH },
];

/** Weak category-only guesses — used to set `guessedKey` on a candidate (a suggestion, not auto-fill). */
const CAT_GUESS: Array<{ key: MetreKey; cat: RegExp; not?: RegExp }> = [
  { key: 'parkingDisabledStallWidth_m', cat: /장애인.*주차|주차.*장애인/i },
  { key: 'parkingStallWidth_m', cat: /주차|parking/i, not: /장애인/i },
  { key: 'rampEffectiveWidth_m', cat: /경사로|ramp/i },
  { key: 'corridorWidth_m', cat: /복도|corridor/i },
  { key: 'stairEffectiveWidth_m', cat: /계단|stair/i },
  { key: 'doorEffectiveWidth_m', cat: /출입구|출입문|\b문\b|door/i },
  { key: 'approachPathWidth_m', cat: /접근로|approach/i },
  { key: 'railingHeight_m', cat: /난간|railing/i },
  { key: 'ceilingHeight_m', cat: /반자|천장|ceiling/i },
  { key: 'emergencyExitWidth_m', cat: /비상구|emergency\s*exit/i },
  { key: 'elevatorInternalWidth_m', cat: /승강기|elevator/i },
];

/**
 * Match a dimension's display text against the AUTO-FILL dictionary. Returns a single key iff
 * exactly one rule fires (category + role tokens both present, negatives absent). Ambiguous or
 * no-match → null (stays a candidate). Deterministic: we return null if more than one rule fires.
 */
function autoFillKey(text: string): MetreKey | null {
  if (!text) return null;
  const hits: MetreKey[] = [];
  for (const r of SEM_RULES) {
    if (r.not && r.not.test(text)) continue;
    if (r.cat.test(text) && r.role.test(text)) hits.push(r.key);
  }
  const uniq = [...new Set(hits)];
  return uniq.length === 1 ? uniq[0] : null;
}

/** Weak category-only guess for a candidate's `guessedKey` (a UI pre-selection the user confirms). */
function guessKey(text: string): MetreKey | undefined {
  if (!text) return undefined;
  const hits: MetreKey[] = [];
  for (const g of CAT_GUESS) {
    if (g.not && g.not.test(text)) continue;
    if (g.cat.test(text)) hits.push(g.key);
  }
  const uniq = [...new Set(hits)];
  return uniq.length === 1 ? uniq[0] : undefined;
}

// ── core suggester (shared by both public entry points) ───────────────────────
interface NormalizedDim { value: number; text: string }
interface CoreInput {
  units: 'mm' | 'in' | null;
  dims: NormalizedDim[];
  circles: Array<{ r: number }>;
  extents: { w: number; h: number } | null;
}

function suggest(input: CoreInput): DrawingFeatureSuggestion {
  const { units, dims, circles, extents } = input;
  const candidates: DrawingFeatureCandidate[] = [];
  const autoFilled: Partial<CodeCheckFeatures> = {};
  const autoFilledProvenance: AutoFillProvenance[] = [];
  const notes: string[] = [];

  // extents → candidates (inherently ambiguous: could be site / building / room → NEVER auto-fill)
  if (extents && Number.isFinite(extents.w) && extents.w > 0) {
    candidates.push({ value: extents.w, unit: units, source: 'extent', meters: toMeters(extents.w, units), label: 'extent.w' });
  }
  if (extents && Number.isFinite(extents.h) && extents.h > 0) {
    candidates.push({ value: extents.h, unit: units, source: 'extent', meters: toMeters(extents.h, units), label: 'extent.h' });
  }

  // dimensions → candidates; auto-fill only unambiguous cat+role+units matches
  for (const d of dims) {
    if (!Number.isFinite(d.value) || d.value <= 0) continue;
    const meters = toMeters(d.value, units);
    const cand: DrawingFeatureCandidate = {
      value: d.value,
      unit: units,
      source: 'dimension',
      meters,
      ...(d.text ? { label: d.text } : {}),
    };
    const strong = autoFillKey(d.text);
    if (strong && meters !== null && autoFilled[strong] === undefined) {
      // unambiguous label + declared units → pre-assign the metre value (editable)
      autoFilled[strong] = meters;
      autoFilledProvenance.push({
        key: strong,
        value: meters,
        ...(d.text ? { label: d.text } : {}),
        reason: `치수 텍스트 "${d.text}" 가 카테고리+역할을 확정 · 단위 ${units} 선언됨 → ${meters} m`,
      });
      cand.guessedKey = strong;
      cand.autoFilled = true;
    } else {
      // otherwise a weak suggestion the user confirms (or, if strong but units unknown, note why not)
      const weak = strong ?? guessKey(d.text);
      if (weak) cand.guessedKey = weak;
      if (strong && meters === null) {
        notes.push(`"${d.text}" 는 슬롯을 확정하지만 도면 단위 미선언 → 자동배정 보류(후보로만): metre 값 추측 금지.`);
      }
    }
    candidates.push(cand);
  }

  // circles → diameter candidates (기둥/구멍 지름 후보 — 코드체크에 직접 매칭되는 룰은 없음 → 후보로만)
  for (const c of circles) {
    if (!Number.isFinite(c.r) || c.r <= 0) continue;
    const dia = round4(c.r * 2);
    candidates.push({ value: dia, unit: units, source: 'circle', meters: toMeters(dia, units), label: `dia ${dia}` });
  }

  if (units === null) {
    notes.push('도면이 단위를 선언하지 않았습니다($INSUNITS 미설정) — 값을 metre 로 환산하지 않고(추측 금지) 원시값 후보로만 제시합니다. 사람이 단위·슬롯을 확인해 배정하세요.');
  }
  if (autoFilledProvenance.length === 0) {
    notes.push('자동배정된 항목이 없습니다 — 모든 측정값은 사람이 슬롯에 배정할 후보입니다(도면 추출은 후보 제안).');
  }

  return { candidates, autoFilled, autoFilledProvenance, units, notes };
}

// ── public entry points ───────────────────────────────────────────────────────
/**
 * Suggest code-check feature candidates from a parsed 2D IR (DWG→ir2d path, carries declared units).
 * Auto-fills ONLY unambiguous, unit-safe dimension labels; everything else is a user-confirmed candidate.
 */
export function suggestFeaturesFromIr2d(ir: DrawingIr2dInput | null | undefined): DrawingFeatureSuggestion {
  const units = ir?.units === 'mm' || ir?.units === 'in' ? ir.units : null;
  const dims: NormalizedDim[] = (ir?.dimensions ?? [])
    .filter((d) => d && Number.isFinite(Number(d.value)))
    .map((d) => ({ value: Number(d.value), text: String(d.text ?? '') }));
  const circles = (ir?.circles ?? []).filter((c) => c && Number.isFinite(Number(c.r)) && Number(c.r) > 0).map((c) => ({ r: Number(c.r) }));
  const extents = ir?.extents && Number.isFinite(Number(ir.extents.w)) && Number.isFinite(Number(ir.extents.h))
    ? { w: Number(ir.extents.w), h: Number(ir.extents.h) }
    : null;
  return suggest({ units, dims, circles, extents });
}

/**
 * Suggest code-check feature candidates from a dxf-seed (ASCII DXF path). The seed carries NO declared
 * units, so `units` is always null → metre-based auto-fill is impossible (honesty invariant): every
 * value is surfaced as a user-confirmed candidate, with weak `guessedKey` hints from dimension text.
 */
export function suggestFeaturesFromSeed(seed: DrawingSeedInput | null | undefined): DrawingFeatureSuggestion {
  const dims: NormalizedDim[] = (seed?.dims ?? [])
    .filter((d) => d && Number.isFinite(Number(d.value)))
    .map((d) => ({ value: Number(d.value), text: String(d.text ?? '') }));
  // seed.measurements are de-duped numbers WITHOUT text — include any not already covered by dims,
  // as unlabelled candidates (no guessedKey possible).
  const covered = new Set(dims.map((d) => d.value));
  for (const m of seed?.measurements ?? []) {
    if (Number.isFinite(m) && m > 0 && !covered.has(m)) dims.push({ value: m, text: '' });
  }
  const circles = (seed?.circles ?? []).filter((c) => c && Number.isFinite(Number(c.r)) && Number(c.r) > 0).map((c) => ({ r: Number(c.r) }));
  const extents = seed?.extents && Number.isFinite(Number(seed.extents.w)) && Number.isFinite(Number(seed.extents.h))
    ? { w: Number(seed.extents.w), h: Number(seed.extents.h) }
    : null;
  // seed path = units always undeclared (honesty invariant #1)
  return suggest({ units: null, dims, circles, extents });
}
