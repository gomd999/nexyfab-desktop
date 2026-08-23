/**
 * eng-domain/construction — PURE quantity-takeoff / schedule GATE MATERIAL.
 *
 * Deterministic, side-effect-free check functions that a later construction
 * DomainModule wires into a "plan → measured gate → verified package" driver.
 * Construction is about QUANTITY TAKEOFF (물량), SCHEDULE (공정) and COST/EARTHWORK
 * reconciliation — measurable and, unlike licensed structural design, mostly free
 * of the stamp legal ceiling. These checks RECONCILE a claimed/ordered/budgeted
 * figure against a value REAL-computed from element dimensions.
 *
 * HONESTY CONTRACT (성역):
 *  - Every metric is REAL-computed from the inputs — no fabricated numbers.
 *  - `basis` states the exact formula / standard, with approximations named.
 *  - A check REFUSES (pass:false + reason) whenever the reconciliation/limit fails.
 *  - Pure functions only: no I/O, no OCCT/THREE, no design-driver imports.
 *    Node/browser-agnostic.
 *  - No fabricated unit rates or masses: unit rates are caller-supplied; rebar
 *    unit mass is DERIVED (ρ_steel · A) from the stated nominal diameter.
 *
 * Mirrors the shape of sibling domains (src/lib/eng-domain/civil, .../interior):
 * same result interface, same throw-on-bad-param vs pass:false-verdict split.
 *
 * UNIT CONVENTIONS (stated so callers can't silently mis-feed):
 *  - Length: m for element geometry / bar length / earthwork.
 *  - Volume: m³. Area: m². Mass: kg. Duration: days.
 *  - Cost: currency-agnostic (caller keeps quantity·rate consistent).
 *  - Rebar nominal diameter: mm.
 */

export interface ConstructionCheckResult {
  /** stable check id, e.g. 'concrete-volume-takeoff' */
  id: string;
  /** true iff the measured metrics satisfy the reconciliation / limit */
  pass: boolean;
  /** measured/computed values backing the verdict (real-computed, never fabricated) */
  metrics: Record<string, number>;
  /** present iff !pass — why the check refused */
  reason?: string;
  /** formula / standard basis, approximations named — REQUIRED */
  basis: string;
}

// ── Physical constants (sources cited) ──────────────────────────────────────
/** Density of structural/reinforcing steel, 7850 kg/m³ (KS D3504 / ASTM basis). */
export const STEEL_DENSITY_KGM3 = 7850;

// ── small guards (throw on invalid params → caller bug, distinct from the gate
//    verdict pass:false which means the reconciliation/limit failed) ─────────
function requirePositive(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`construction check: '${name}' must be a positive finite number, got ${v}`);
  }
  return v;
}
function requireNonNegative(name: string, v: number): number {
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`construction check: '${name}' must be a non-negative finite number, got ${v}`);
  }
  return v;
}
function round(v: number, p = 6): number {
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONCRETE VOLUME TAKEOFF — Σ count·b·h·L vs claimed/ordered volume (m³)
// ─────────────────────────────────────────────────────────────────────────────
/** A prismatic concrete element: cross-section b×h extruded over length L. */
export interface ConcreteElement {
  /** Stable object identity used by the construction revision/provenance binding. */
  objectId?: string;
  /** optional tag for traceability (unused in math) */
  tag?: string;
  /** number of identical elements (default 1) */
  count?: number;
  /** cross-section width b (m) */
  b_m: number;
  /** cross-section height/depth h (m) — for a slab this is the thickness */
  h_m: number;
  /** member length L (m) */
  L_m: number;
}

export interface ConcreteVolumeInput {
  /** prismatic elements to take off */
  elements: ConcreteElement[];
  /** claimed / ordered concrete volume to reconcile against (m³) */
  claimedVolume_m3: number;
  /**
   * WASTE MODE: if given, required order = computed·(1+waste); pass iff ordered ≥ required
   * (i.e. enough concrete was ordered to cover the computed net volume plus waste).
   */
  wasteFactor?: number;
  /**
   * TOLERANCE MODE (used only when wasteFactor is absent): absolute tolerance (m³);
   * pass iff |computed − claimed| ≤ tolerance. Default 0.001 m³.
   */
  toleranceM3?: number;
}

/** Net computed concrete volume Σ count·b·h·L (m³). */
export function concreteVolume_m3(elements: ConcreteElement[]): number {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error(`construction check: 'elements' must be a non-empty array`);
  }
  let total = 0;
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const n = e.count === undefined ? 1 : requirePositive(`elements[${i}].count`, e.count);
    const b = requirePositive(`elements[${i}].b_m`, e.b_m);
    const h = requirePositive(`elements[${i}].h_m`, e.h_m);
    const L = requirePositive(`elements[${i}].L_m`, e.L_m);
    total += n * b * h * L;
  }
  return total;
}

export function checkConcreteVolumeTakeoff(input: ConcreteVolumeInput): ConstructionCheckResult {
  const computed = concreteVolume_m3(input.elements);
  const claimed = requireNonNegative('claimedVolume_m3', input.claimedVolume_m3);

  if (input.wasteFactor !== undefined) {
    const waste = requireNonNegative('wasteFactor', input.wasteFactor);
    const required = computed * (1 + waste);
    const pass = claimed >= required;
    return {
      id: 'concrete-volume-takeoff',
      pass,
      metrics: {
        computedVolume_m3: round(computed),
        wasteFactor: round(waste),
        requiredVolume_m3: round(required),
        orderedVolume_m3: round(claimed),
        marginVolume_m3: round(claimed - required),
      },
      reason: pass
        ? undefined
        : `주문 물량 ${round(claimed, 3)} m³ < 필요 ${round(required, 3)} m³ (산정 ${round(
            computed,
            3,
          )} m³ × 할증 ${round(1 + waste, 3)}).`,
      basis:
        'Prismatic takeoff V = Σ nᵢ·bᵢ·hᵢ·Lᵢ; 필요 주문량 = V·(1+할증). ' +
        'Approx: 직육면체 부재만(테이퍼·개구부·이음 공제 미반영), 순물량 기준.',
    };
  }

  const tol = input.toleranceM3 === undefined ? 0.001 : requireNonNegative('toleranceM3', input.toleranceM3);
  const diff = Math.abs(computed - claimed);
  const pass = diff <= tol;
  return {
    id: 'concrete-volume-takeoff',
    pass,
    metrics: {
      computedVolume_m3: round(computed),
      claimedVolume_m3: round(claimed),
      differenceVolume_m3: round(diff),
      toleranceM3: round(tol),
    },
    reason: pass
      ? undefined
      : `산정 물량 ${round(computed, 3)} m³ 와 신고 ${round(claimed, 3)} m³ 차이 ${round(
          diff,
          3,
        )} m³ 가 허용오차 ${round(tol, 3)} m³ 초과.`,
    basis:
      'Prismatic takeoff V = Σ nᵢ·bᵢ·hᵢ·Lᵢ; pass iff |V − 신고| ≤ 허용오차. ' +
      'Approx: 직육면체 부재만(테이퍼·개구부·이음 공제 미반영), 순물량 기준.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REBAR WEIGHT TAKEOFF — Σ(count·length·unitMass(d)) vs claimed (kg)
//    unit mass DERIVED: m' = ρ_steel · (π/4)·d²  (ρ = 7850 kg/m³)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Nominal per-metre mass of a round bar of nominal diameter d (mm), kg/m.
 * m' = ρ·A = 7850 · (π/4)·(d/1000)².  e.g. D16 → 1.5783 kg/m, D25 → 3.8534 kg/m.
 * NOTE: this is the idealized ρ·A value using d = the size number in mm. The KS D3504
 * tabulated nominal masses use the true nominal diameters (D16 = 15.9 mm → 1.56 kg/m),
 * so this over-estimates slightly for deformed bars — stated as an approximation.
 */
export function barUnitMass_kgpm(nominalDia_mm: number): number {
  const d = requirePositive('nominalDia_mm', nominalDia_mm);
  const area_m2 = (Math.PI / 4) * (d / 1000) ** 2;
  return STEEL_DENSITY_KGM3 * area_m2;
}

/**
 * Common metric deformed bar per-metre masses (kg/m), DERIVED via barUnitMass_kgpm
 * (ρ·A with d = size number). Provided for convenience/traceability.
 */
export const STANDARD_BAR_UNIT_MASS_KGPM: Record<number, number> = {
  10: barUnitMass_kgpm(10), // 0.6165
  13: barUnitMass_kgpm(13), // 1.0419
  16: barUnitMass_kgpm(16), // 1.5783
  19: barUnitMass_kgpm(19), // 2.2258
  22: barUnitMass_kgpm(22), // 2.9845
  25: barUnitMass_kgpm(25), // 3.8534
  29: barUnitMass_kgpm(29), // 5.1837
  32: barUnitMass_kgpm(32), // 6.3132
};

export interface RebarGroup {
  /** Stable object identity used by the construction revision/provenance binding. */
  objectId?: string;
  /** optional tag for traceability */
  tag?: string;
  /** nominal bar diameter d (mm), e.g. 16 for D16 */
  nominalDia_mm: number;
  /** length of ONE bar (m) */
  length_m: number;
  /** number of identical bars (default 1) */
  count?: number;
}

export interface RebarWeightInput {
  groups: RebarGroup[];
  /** claimed / delivered rebar weight to reconcile against (kg) */
  claimedWeight_kg: number;
  /** absolute tolerance (kg). Default max(1 kg, 2% of computed). */
  toleranceKg?: number;
}

/** Total rebar weight Σ count·length·unitMass(d) (kg). */
export function rebarWeight_kg(groups: RebarGroup[]): number {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(`construction check: 'groups' must be a non-empty array`);
  }
  let total = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const n = g.count === undefined ? 1 : requirePositive(`groups[${i}].count`, g.count);
    const L = requirePositive(`groups[${i}].length_m`, g.length_m);
    const unit = barUnitMass_kgpm(g.nominalDia_mm);
    total += n * L * unit;
  }
  return total;
}

export function checkRebarWeightTakeoff(input: RebarWeightInput): ConstructionCheckResult {
  const computed = rebarWeight_kg(input.groups);
  const claimed = requireNonNegative('claimedWeight_kg', input.claimedWeight_kg);
  const tol =
    input.toleranceKg === undefined
      ? Math.max(1, 0.02 * computed)
      : requireNonNegative('toleranceKg', input.toleranceKg);
  const diff = Math.abs(computed - claimed);
  const pass = diff <= tol;
  return {
    id: 'rebar-weight-takeoff',
    pass,
    metrics: {
      computedWeight_kg: round(computed, 3),
      claimedWeight_kg: round(claimed, 3),
      differenceWeight_kg: round(diff, 3),
      toleranceKg: round(tol, 3),
    },
    reason: pass
      ? undefined
      : `산정 철근중량 ${round(computed, 2)} kg 와 신고 ${round(claimed, 2)} kg 차이 ${round(
          diff,
          2,
        )} kg 가 허용오차 ${round(tol, 2)} kg 초과.`,
    basis:
      'W = Σ nᵢ·Lᵢ·m′(dᵢ), 단위질량 m′ = ρ_steel·(π/4)·d²  (ρ = 7850 kg/m³). ' +
      'Approx: d = 호칭 숫자 mm로 ρ·A 산정(리브 무시) → KS D3504 표값 대비 약간 과대(D16 1.578 vs 표 1.56 kg/m).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FORMWORK AREA TAKEOFF — formed surface area Σ per element vs claimed (m²)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Formwork element by contact-surface type:
 *  - beam:        2 sides + soffit = (2·h + b)·L      (top open, cast against form)
 *  - column:      perimeter · height = 2·(b + h)·L    (rectangular column, 4 faces)
 *  - wall:        sides · length · height             (sides: 1 or 2, default 2)
 *  - slab-soffit: plan area b·L                        (underside only)
 */
export type FormworkElement =
  | { type: 'beam'; objectId?: string; tag?: string; count?: number; b_m: number; h_m: number; L_m: number }
  | { type: 'column'; objectId?: string; tag?: string; count?: number; b_m: number; h_m: number; L_m: number }
  | { type: 'wall'; objectId?: string; tag?: string; count?: number; L_m: number; h_m: number; sides?: number }
  | { type: 'slab-soffit'; objectId?: string; tag?: string; count?: number; b_m: number; L_m: number };

/** Formed contact area of a single element instance (m²), before ×count. */
export function formworkAreaOfElement(e: FormworkElement): number {
  switch (e.type) {
    case 'beam': {
      const b = requirePositive('beam.b_m', e.b_m);
      const h = requirePositive('beam.h_m', e.h_m);
      const L = requirePositive('beam.L_m', e.L_m);
      return (2 * h + b) * L;
    }
    case 'column': {
      const b = requirePositive('column.b_m', e.b_m);
      const h = requirePositive('column.h_m', e.h_m);
      const L = requirePositive('column.L_m', e.L_m);
      return 2 * (b + h) * L;
    }
    case 'wall': {
      const L = requirePositive('wall.L_m', e.L_m);
      const h = requirePositive('wall.h_m', e.h_m);
      const sides = e.sides === undefined ? 2 : requirePositive('wall.sides', e.sides);
      return sides * L * h;
    }
    case 'slab-soffit': {
      const b = requirePositive('slab-soffit.b_m', e.b_m);
      const L = requirePositive('slab-soffit.L_m', e.L_m);
      return b * L;
    }
  }
}

export interface FormworkAreaInput {
  elements: FormworkElement[];
  /** claimed formwork area to reconcile against (m²) */
  claimedArea_m2: number;
  /** absolute tolerance (m²). Default 0.01 m². */
  toleranceM2?: number;
}

/** Total formed surface area Σ count·area(element) (m²). */
export function formworkArea_m2(elements: FormworkElement[]): number {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error(`construction check: 'elements' must be a non-empty array`);
  }
  let total = 0;
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const n = e.count === undefined ? 1 : requirePositive(`elements[${i}].count`, e.count);
    total += n * formworkAreaOfElement(e);
  }
  return total;
}

export function checkFormworkAreaTakeoff(input: FormworkAreaInput): ConstructionCheckResult {
  const computed = formworkArea_m2(input.elements);
  const claimed = requireNonNegative('claimedArea_m2', input.claimedArea_m2);
  const tol = input.toleranceM2 === undefined ? 0.01 : requireNonNegative('toleranceM2', input.toleranceM2);
  const diff = Math.abs(computed - claimed);
  const pass = diff <= tol;
  return {
    id: 'formwork-area-takeoff',
    pass,
    metrics: {
      computedArea_m2: round(computed, 4),
      claimedArea_m2: round(claimed, 4),
      differenceArea_m2: round(diff, 4),
      toleranceM2: round(tol, 4),
    },
    reason: pass
      ? undefined
      : `산정 거푸집면적 ${round(computed, 3)} m² 와 신고 ${round(claimed, 3)} m² 차이 ${round(
          diff,
          3,
        )} m² 가 허용오차 ${round(tol, 3)} m² 초과.`,
    basis:
      'A = Σ nᵢ·(접촉면 공식): 보 (2h+b)·L, 기둥 2(b+h)·L, 벽 sides·L·h, 슬래브밑 b·L. ' +
      'Approx: 부재간 교차부 중복공제·개구부 공제 미반영(총 접촉면 기준).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SCHEDULE FEASIBILITY — forward-pass critical path, cycle & neg-lag guard
// ─────────────────────────────────────────────────────────────────────────────
/** A finish-to-start predecessor link, optionally with lag (days). */
export type Predecessor = string | { id: string; lag_days?: number };

export interface Activity {
  /** Stable object identity used by the construction revision/provenance binding. */
  objectId?: string;
  id: string;
  /** activity duration (days) — must be ≥ 0 */
  duration_days: number;
  /** finish-to-start predecessors (default none) */
  predecessors?: Predecessor[];
}

export interface ScheduleInput {
  activities: Activity[];
  /** optional project deadline (days); pass requires criticalPath ≤ deadline */
  deadline_days?: number;
}

function predId(p: Predecessor): string {
  return typeof p === 'string' ? p : p.id;
}
function predLag(p: Predecessor): number {
  return typeof p === 'string' ? 0 : p.lag_days ?? 0;
}

/**
 * Forward pass over an FS activity network.
 * Returns { criticalPathDays, hasCycle, negativeLag }. Throws on unknown pred ref
 * or on a duplicate / negative duration (caller bug). Cycle & negative-lag are
 * VERDICT conditions (reported, not thrown).
 */
export function scheduleForwardPass(activities: Activity[]): {
  criticalPathDays: number;
  hasCycle: boolean;
  negativeLag: boolean;
} {
  if (!Array.isArray(activities) || activities.length === 0) {
    throw new Error(`construction check: 'activities' must be a non-empty array`);
  }
  const byId = new Map<string, Activity>();
  for (const a of activities) {
    if (!a.id) throw new Error(`construction check: activity id is required`);
    if (byId.has(a.id)) throw new Error(`construction check: duplicate activity id '${a.id}'`);
    requireNonNegative(`activity '${a.id}'.duration_days`, a.duration_days);
    byId.set(a.id, a);
  }
  // validate predecessor references + detect negative lag
  let negativeLag = false;
  for (const a of activities) {
    for (const p of a.predecessors ?? []) {
      const pid = predId(p);
      if (!byId.has(pid)) {
        throw new Error(`construction check: activity '${a.id}' references unknown predecessor '${pid}'`);
      }
      if (predLag(p) < 0) negativeLag = true;
    }
  }

  // earliest finish via DFS memo, with cycle detection (0=unvisited,1=in-stack,2=done)
  const state = new Map<string, number>();
  const earliestFinish = new Map<string, number>();
  let hasCycle = false;

  function ef(id: string): number {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      hasCycle = true;
      return 0; // break the cycle; verdict flag already set
    }
    if (st === 2) return earliestFinish.get(id) as number;
    state.set(id, 1);
    const a = byId.get(id) as Activity;
    let earliestStart = 0;
    for (const p of a.predecessors ?? []) {
      const finish = ef(predId(p)) + predLag(p);
      if (finish > earliestStart) earliestStart = finish;
    }
    const finish = earliestStart + a.duration_days;
    earliestFinish.set(id, finish);
    state.set(id, 2);
    return finish;
  }

  let cp = 0;
  for (const a of activities) {
    const f = ef(a.id);
    if (!hasCycle && f > cp) cp = f;
  }
  return { criticalPathDays: hasCycle ? NaN : cp, hasCycle, negativeLag };
}

export function checkScheduleFeasibility(input: ScheduleInput): ConstructionCheckResult {
  const { criticalPathDays, hasCycle, negativeLag } = scheduleForwardPass(input.activities);
  const hasDeadline = input.deadline_days !== undefined;
  const deadline = hasDeadline ? requirePositive('deadline_days', input.deadline_days as number) : undefined;

  const withinDeadline = !hasDeadline || (!hasCycle && criticalPathDays <= (deadline as number));
  const pass = !hasCycle && !negativeLag && withinDeadline;

  let reason: string | undefined;
  if (hasCycle) {
    reason = '공정망에 순환(cycle) 존재 — 선후행 논리 불성립.';
  } else if (negativeLag) {
    reason = '음(-)의 lag 존재 — 선행 종료 이전 착수(리드) 불허.';
  } else if (!withinDeadline) {
    reason = `주공정 ${round(criticalPathDays, 2)} 일 > 마감 ${round(deadline as number, 2)} 일.`;
  }

  const metrics: Record<string, number> = {
    activityCount: input.activities.length,
    hasCycle: hasCycle ? 1 : 0,
    negativeLag: negativeLag ? 1 : 0,
  };
  if (!hasCycle) metrics.criticalPathDays = round(criticalPathDays, 3);
  if (hasDeadline) metrics.deadlineDays = round(deadline as number, 3);

  return {
    id: 'schedule-feasibility',
    pass,
    metrics,
    reason,
    basis:
      'CPM forward pass: 각 작업 EF = max(선행 EF + lag) + duration; 주공정 = max EF. ' +
      'Gate: 비순환(위상정렬 가능) ∧ lag ≥ 0 ∧ (선택)주공정 ≤ 마감. ' +
      'Approx: FS(종료-착수) 링크만, 자원제약·캘린더 미반영.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. COST ROLLUP — Σ quantity·unitRate vs budget (currency-agnostic)
// ─────────────────────────────────────────────────────────────────────────────
export interface CostLineItem {
  /** optional description for traceability */
  description?: string;
  /** quantity (any unit consistent with unitRate) */
  quantity: number;
  /** unit rate (currency per quantity unit) — caller-supplied, never fabricated */
  unitRate: number;
}

export interface CostRollupInput {
  lineItems: CostLineItem[];
  /** budget ceiling (same currency) */
  budget: number;
  /** optional contingency fraction added to computed cost before the compare */
  contingencyFactor?: number;
}

/** Rolled-up direct cost Σ quantity·unitRate. */
export function costRollup(lineItems: CostLineItem[]): number {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error(`construction check: 'lineItems' must be a non-empty array`);
  }
  let total = 0;
  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i];
    const q = requireNonNegative(`lineItems[${i}].quantity`, li.quantity);
    const r = requireNonNegative(`lineItems[${i}].unitRate`, li.unitRate);
    total += q * r;
  }
  return total;
}

export function checkCostRollup(input: CostRollupInput): ConstructionCheckResult {
  const direct = costRollup(input.lineItems);
  const budget = requireNonNegative('budget', input.budget);
  const cont = input.contingencyFactor === undefined ? 0 : requireNonNegative('contingencyFactor', input.contingencyFactor);
  const totalCost = direct * (1 + cont);
  const pass = totalCost <= budget;
  return {
    id: 'cost-rollup',
    pass,
    metrics: {
      directCost: round(direct, 4),
      contingencyFactor: round(cont, 4),
      totalCost: round(totalCost, 4),
      budget: round(budget, 4),
      margin: round(budget - totalCost, 4),
    },
    reason: pass
      ? undefined
      : `산정 공사비 ${round(totalCost, 2)} (직접 ${round(direct, 2)} × 예비 ${round(
          1 + cont,
          3,
        )}) 가 예산 ${round(budget, 2)} 초과.`,
    basis:
      'C = Σ 수량ᵢ·단가ᵢ, 총액 = C·(1+예비비율); pass iff 총액 ≤ 예산. ' +
      'Approx: 단가는 호출자 제공(허구값 없음), 통화 단위 일관성은 호출자 책임.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EARTHWORK CUT-FILL BALANCE — bank cut vs bank required for compacted fill
// ─────────────────────────────────────────────────────────────────────────────
export interface EarthworkBalanceInput {
  /** in-situ (bank) cut volume available on site (m³) */
  cutBank_m3: number;
  /** compacted fill volume required on site (m³) */
  fillCompacted_m3: number;
  /**
   * compaction factor C = compacted volume / bank volume (KS/토공 관례, default 1.0).
   * Required bank to place the fill = fillCompacted / C. C < 1 → shrinkage (need more bank).
   */
  compactionFactor?: number;
  /** absolute tolerance for "balanced" (m³). Default 0.5 m³. */
  toleranceM3?: number;
}

export function checkEarthworkCutFillBalance(input: EarthworkBalanceInput): ConstructionCheckResult {
  const cut = requireNonNegative('cutBank_m3', input.cutBank_m3);
  const fill = requireNonNegative('fillCompacted_m3', input.fillCompacted_m3);
  const C = input.compactionFactor === undefined ? 1.0 : requirePositive('compactionFactor', input.compactionFactor);
  const tol = input.toleranceM3 === undefined ? 0.5 : requireNonNegative('toleranceM3', input.toleranceM3);

  const requiredBank = fill / C; // bank volume needed to produce the compacted fill
  const netImport = requiredBank - cut; // >0 → must import; <0 → surplus to export
  // Gate passes when the site has enough cut to satisfy fill (import ≤ tolerance).
  const pass = netImport <= tol;
  return {
    id: 'earthwork-cut-fill-balance',
    pass,
    metrics: {
      cutBank_m3: round(cut, 3),
      fillCompacted_m3: round(fill, 3),
      compactionFactor: round(C, 4),
      requiredBank_m3: round(requiredBank, 3),
      netImport_m3: round(netImport, 3),
      toleranceM3: round(tol, 3),
    },
    reason: pass
      ? undefined
      : `현장 절토 ${round(cut, 2)} m³ 가 성토 필요 원지반량 ${round(requiredBank, 2)} m³ (다짐환산 C=${round(
          C,
          3,
        )}) 에 ${round(netImport, 2)} m³ 부족 — 반입 필요.`,
    basis:
      '성토 필요 원지반(bank)량 = 다짐성토량 / C (C=다짐계수=다짐후/원지반); 순반입 = 필요 − 절토. ' +
      'pass iff 순반입 ≤ 허용(현장 균형). Approx: 흐트러짐(swell)은 운반량용이라 원지반 균형에는 미반영.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry / catalog of checks (id → runner)
// ─────────────────────────────────────────────────────────────────────────────
export interface ConstructionCheckSpec<I = unknown> {
  id: string;
  title: string;
  domain: string;
  run: (input: I) => ConstructionCheckResult;
}

export const CONSTRUCTION_CHECKS: Record<string, ConstructionCheckSpec<never>> = {
  'concrete-volume-takeoff': {
    id: 'concrete-volume-takeoff',
    title: 'Concrete volume takeoff (Σ b·h·L vs ordered)',
    domain: 'construction/quantity',
    run: checkConcreteVolumeTakeoff as (i: never) => ConstructionCheckResult,
  },
  'rebar-weight-takeoff': {
    id: 'rebar-weight-takeoff',
    title: 'Rebar weight takeoff (Σ L·ρ·A vs delivered)',
    domain: 'construction/quantity',
    run: checkRebarWeightTakeoff as (i: never) => ConstructionCheckResult,
  },
  'formwork-area-takeoff': {
    id: 'formwork-area-takeoff',
    title: 'Formwork contact-area takeoff (Σ formed surface vs claimed)',
    domain: 'construction/quantity',
    run: checkFormworkAreaTakeoff as (i: never) => ConstructionCheckResult,
  },
  'schedule-feasibility': {
    id: 'schedule-feasibility',
    title: 'Schedule feasibility (CPM forward pass, acyclic, ≤ deadline)',
    domain: 'construction/schedule',
    run: checkScheduleFeasibility as (i: never) => ConstructionCheckResult,
  },
  'cost-rollup': {
    id: 'cost-rollup',
    title: 'Cost rollup (Σ qty·rate ≤ budget)',
    domain: 'construction/cost',
    run: checkCostRollup as (i: never) => ConstructionCheckResult,
  },
  'earthwork-cut-fill-balance': {
    id: 'earthwork-cut-fill-balance',
    title: 'Earthwork cut-fill balance (bank cut ≥ bank required for fill)',
    domain: 'construction/earthwork',
    run: checkEarthworkCutFillBalance as (i: never) => ConstructionCheckResult,
  },
};

export type ConstructionCheckId = keyof typeof CONSTRUCTION_CHECKS;
