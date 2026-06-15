/**
 * assemblyConstraints — Phase 4.6 of NexyFab Pro own-CAD (ADR-013).
 *
 * Global, assembly-wide constraints that go BEYOND the binary mate IR in
 * mate.ts. Mates pin one part to another; the rules in this module instead
 * express manufacturing-level / design-budget assertions that apply to the
 * assembly as a whole:
 *
 *   - total_mass_limit            — assembly mass must stay under a cap
 *   - bbox_envelope               — every part fits inside a shipping box
 *   - part_count_limit            — keep the BOM under a target part count
 *   - manufacturing_volume_min    — every part must have ≥ minVolume to be
 *                                   machinable / printable (filters out
 *                                   sliver geometry the solver may have
 *                                   produced)
 *   - cost_limit                  — material cost (rate × volume) under a cap
 *   - material_homogeneity        — every part draws from an approved
 *                                   material list (e.g., aerospace-cert set)
 *
 * Scope (Phase 4.6):
 *   - Pure function: `checkAssemblyConstraints(state, constraints, opts)`
 *     returns `{ ok, violations[] }`. No I/O, no logging, no mutation.
 *   - Re-uses `bomExport.buildBom` so the mass / volume / material logic
 *     stays in one place (constraints never re-implement densities).
 *   - Severity: hard limits → 'error'. Unmeasurable inputs (e.g., a part
 *     with no FeatureTree, so volume is undefined) → 'warning' so the
 *     constraint check does not silently pass for missing data.
 *
 * Out of scope:
 *   - Constraint editing UI / serialization (Phase 4.7).
 *   - Quote-engine cost (Phase 5 — this module uses placeholder rates).
 *   - Sub-assembly aggregation (Phase 3.5).
 *   - Rotation-aware bbox unions: each part's local bbox is offset by its
 *     PartInstance.position but NOT rotated by orientation. The Phase 1
 *     OBB swap will replace this with a true oriented-bbox union; until
 *     then a part rotated 45° may report a slightly tight envelope. This
 *     matches the Phase 1 visualization approximation in featureTreeStats.
 */

import type { AssemblyState } from './assemblyState';
import { buildBom, type BuildBomOptions } from './bomExport';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { isEmptyBbox, unionBbox, type Bbox } from '@/lib/cad/featureTreeStats';

// ─── constraint discriminated union ──────────────────────────────────────

export interface TotalMassLimitConstraint {
  kind: 'total_mass_limit';
  /** Maximum allowed assembly mass in grams. Must be > 0. */
  maxGrams: number;
}

export interface BboxEnvelopeConstraint {
  kind: 'bbox_envelope';
  /** Maximum allowed bbox extents in mm (x/y/z each must be > 0). */
  size: { x: number; y: number; z: number };
}

export interface PartCountLimitConstraint {
  kind: 'part_count_limit';
  /** Maximum allowed PartInstance count. Must be ≥ 0. */
  max: number;
}

export interface ManufacturingVolumeMinConstraint {
  kind: 'manufacturing_volume_min';
  /** Minimum allowed per-part volume in mm³. Parts below this fail. */
  minMm3: number;
}

export type CostCurrency = 'USD' | 'EUR' | 'KRW';

export interface CostLimitConstraint {
  kind: 'cost_limit';
  /** Maximum total assembly cost in the given currency. */
  maxCurrency: number;
  currency: CostCurrency;
}

export interface MaterialHomogeneityConstraint {
  kind: 'material_homogeneity';
  /** Allowed material names — any part using something else fails. */
  allowedMaterials: ReadonlyArray<string>;
}

export type AssemblyConstraint =
  | TotalMassLimitConstraint
  | BboxEnvelopeConstraint
  | PartCountLimitConstraint
  | ManufacturingVolumeMinConstraint
  | CostLimitConstraint
  | MaterialHomogeneityConstraint;

// ─── result shape ────────────────────────────────────────────────────────

export type ConstraintSeverity = 'error' | 'warning';

export interface ConstraintViolation {
  /** Index of the failing constraint in the input array. */
  constraintIndex: number;
  /** Echo of constraint.kind for switch-on-kind consumers. */
  kind: string;
  /** Observed value that triggered the failure (shape varies by kind). */
  actual: unknown;
  /** Constraint threshold/limit being compared against. */
  limit: unknown;
  /** 'error' = hard fail. 'warning' = could not evaluate (missing data). */
  severity: ConstraintSeverity;
  /** Optional context (which part / material / etc.) for UI rendering. */
  detail?: string;
}

export interface ConstraintCheckResult {
  /** True iff there are zero 'error'-severity violations. Warnings do not
   *  flip ok=false so callers can still publish but with a yellow badge. */
  ok: boolean;
  violations: ReadonlyArray<ConstraintViolation>;
}

// ─── placeholder cost catalogue (Phase 1) ────────────────────────────────

/**
 * Per-material cost in USD per mm³ (rate × volume). Sourced from rough
 * machining-stock estimates (MIT, Xometry online quotes); these are NOT
 * negotiated supplier rates — Phase 5 will swap this for the quote engine.
 * Exported so tests + the UI can read the same numbers the checker uses.
 */
export const DEFAULT_COST_RATES_USD_PER_MM3: Readonly<Record<string, number>> = {
  steel: 0.00012,
  stainless_steel: 0.00020,
  aluminum: 0.00010,
  brass: 0.00025,
  copper: 0.00030,
  titanium: 0.00200,
  plastic_abs: 0.00004,
  plastic_pla: 0.00003,
  plastic_petg: 0.00004,
  nylon: 0.00006,
  wood: 0.00002,
  rubber: 0.00005,
};

/**
 * Currency conversion rates relative to USD. Tests can override via
 * `opts.fxRates`. NOTE: these are illustrative defaults — production
 * deployments should inject live rates.
 */
export const DEFAULT_FX_PER_USD: Readonly<Record<CostCurrency, number>> = {
  USD: 1,
  EUR: 0.92,
  KRW: 1350,
};

// ─── options ─────────────────────────────────────────────────────────────

export interface CheckAssemblyConstraintsOptions {
  /** Per-part FeatureTree map (same shape as BuildBomOptions). */
  featureTrees?: Record<string, FeatureTree>;
  /** Per-part material override (same shape as BuildBomOptions). */
  materials?: Record<string, string>;
  /** Density catalogue override (passed through to buildBom). */
  densities?: Record<string, number>;
  /**
   * Cost rates in USD/mm³ keyed by material. Merged on top of
   * {@link DEFAULT_COST_RATES_USD_PER_MM3}; callers can add custom
   * materials without losing the defaults.
   */
  costRatesUsdPerMm3?: Record<string, number>;
  /** FX rates relative to USD; merged onto {@link DEFAULT_FX_PER_USD}. */
  fxRates?: Partial<Record<CostCurrency, number>>;
}

// ─── main entry point ────────────────────────────────────────────────────

/**
 * Evaluate every assembly-wide constraint against the current state.
 *
 * Pure function: never throws, never mutates. Returns the full violation
 * list (one entry per failing constraint × failing item) so the UI can
 * render all problems at once instead of forcing the user through a
 * fix-one-rerun cycle.
 *
 * Algorithm:
 *   1. Build the BOM once (using opts.featureTrees / materials / densities)
 *      so mass / volume / bbox / material are computed in one walk.
 *   2. For each constraint, run its dedicated checker and accumulate any
 *      violations it produces.
 *   3. `ok` = no violation with severity 'error'.
 */
export function checkAssemblyConstraints(
  state: AssemblyState,
  constraints: ReadonlyArray<AssemblyConstraint>,
  opts: CheckAssemblyConstraintsOptions = {},
): ConstraintCheckResult {
  const violations: ConstraintViolation[] = [];

  // Empty constraint list is the trivially-passing case.
  if (constraints.length === 0) {
    return { ok: true, violations };
  }

  const bomOpts: BuildBomOptions = {
    featureTrees: opts.featureTrees,
    materials: opts.materials,
    densities: opts.densities,
    // Deterministic timestamp so test snapshots / equality checks don't
    // depend on wall-clock — buildBom defaults to new Date() otherwise.
    generatedAt: '1970-01-01T00:00:00.000Z',
  };
  const bom = buildBom(state, bomOpts);

  const costRates: Record<string, number> = {
    ...DEFAULT_COST_RATES_USD_PER_MM3,
    ...(opts.costRatesUsdPerMm3 ?? {}),
  };
  const fxRates: Record<CostCurrency, number> = {
    ...DEFAULT_FX_PER_USD,
    ...(opts.fxRates ?? {}),
  };

  constraints.forEach((c, i) => {
    switch (c.kind) {
      case 'total_mass_limit':
        checkTotalMass(c, i, bom.totalMass, violations);
        break;
      case 'bbox_envelope':
        checkBboxEnvelope(c, i, state, bom, violations);
        break;
      case 'part_count_limit':
        checkPartCount(c, i, state.parts.length, violations);
        break;
      case 'manufacturing_volume_min':
        checkManufacturingVolume(c, i, bom, violations);
        break;
      case 'cost_limit':
        checkCostLimit(c, i, bom, costRates, fxRates, violations);
        break;
      case 'material_homogeneity':
        checkMaterialHomogeneity(c, i, bom, violations);
        break;
    }
  });

  const ok = violations.every((v) => v.severity !== 'error');
  return { ok, violations };
}

// ─── per-kind checkers ───────────────────────────────────────────────────

function checkTotalMass(
  c: TotalMassLimitConstraint,
  index: number,
  totalMass: number | undefined,
  out: ConstraintViolation[],
): void {
  if (totalMass === undefined) {
    // Could not measure mass for any part — bubble up as warning rather
    // than silently passing the gate.
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: undefined,
      limit: c.maxGrams,
      severity: 'warning',
      detail: 'no parts produced a mass measurement (missing FeatureTree or density)',
    });
    return;
  }
  if (totalMass > c.maxGrams) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: totalMass,
      limit: c.maxGrams,
      severity: 'error',
      detail: `assembly mass ${totalMass.toFixed(3)} g exceeds ${c.maxGrams} g`,
    });
  }
}

function checkBboxEnvelope(
  c: BboxEnvelopeConstraint,
  index: number,
  state: AssemblyState,
  bom: ReturnType<typeof buildBom>,
  out: ConstraintViolation[],
): void {
  // Build the per-part-id → bbox map from the BOM (single source of truth).
  const bboxById = new Map<string, Bbox>();
  for (const e of bom.entries) {
    if (e.bbox) bboxById.set(e.partId, e.bbox);
  }

  // Translate each part-local bbox by the part's world-frame position and
  // union them. Phase 1 deliberately skips orientation rotation (see module
  // docstring caveat).
  let envelope: Bbox = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  let anyMeasured = false;
  for (const part of state.parts) {
    const b = bboxById.get(part.id);
    if (!b || isEmptyBbox(b)) continue;
    anyMeasured = true;
    const shifted: Bbox = {
      min: {
        x: b.min.x + part.position.x,
        y: b.min.y + part.position.y,
        z: b.min.z + part.position.z,
      },
      max: {
        x: b.max.x + part.position.x,
        y: b.max.y + part.position.y,
        z: b.max.z + part.position.z,
      },
    };
    envelope = unionBbox(envelope, shifted);
  }

  if (!anyMeasured) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: undefined,
      limit: c.size,
      severity: 'warning',
      detail: 'no part contributed a bbox (missing FeatureTree)',
    });
    return;
  }

  const extent = {
    x: envelope.max.x - envelope.min.x,
    y: envelope.max.y - envelope.min.y,
    z: envelope.max.z - envelope.min.z,
  };
  const overX = extent.x > c.size.x;
  const overY = extent.y > c.size.y;
  const overZ = extent.z > c.size.z;
  if (overX || overY || overZ) {
    const axes: string[] = [];
    if (overX) axes.push(`x ${extent.x.toFixed(2)}>${c.size.x}`);
    if (overY) axes.push(`y ${extent.y.toFixed(2)}>${c.size.y}`);
    if (overZ) axes.push(`z ${extent.z.toFixed(2)}>${c.size.z}`);
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: extent,
      limit: c.size,
      severity: 'error',
      detail: `envelope exceeded on ${axes.join(', ')}`,
    });
  }
}

function checkPartCount(
  c: PartCountLimitConstraint,
  index: number,
  count: number,
  out: ConstraintViolation[],
): void {
  if (count > c.max) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: count,
      limit: c.max,
      severity: 'error',
      detail: `part count ${count} exceeds ${c.max}`,
    });
  }
}

function checkManufacturingVolume(
  c: ManufacturingVolumeMinConstraint,
  index: number,
  bom: ReturnType<typeof buildBom>,
  out: ConstraintViolation[],
): void {
  for (const e of bom.entries) {
    if (e.volume === undefined) {
      out.push({
        constraintIndex: index,
        kind: c.kind,
        actual: undefined,
        limit: c.minMm3,
        severity: 'warning',
        detail: `part ${e.partId}: no volume measurement available`,
      });
      continue;
    }
    if (e.volume < c.minMm3) {
      out.push({
        constraintIndex: index,
        kind: c.kind,
        actual: e.volume,
        limit: c.minMm3,
        severity: 'error',
        detail: `part ${e.partId} volume ${e.volume.toFixed(3)} mm³ below ${c.minMm3} mm³`,
      });
    }
  }
}

function checkCostLimit(
  c: CostLimitConstraint,
  index: number,
  bom: ReturnType<typeof buildBom>,
  costRates: Record<string, number>,
  fxRates: Record<CostCurrency, number>,
  out: ConstraintViolation[],
): void {
  const fx = fxRates[c.currency];
  if (!Number.isFinite(fx) || fx <= 0) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: undefined,
      limit: c.maxCurrency,
      severity: 'warning',
      detail: `unknown FX rate for ${c.currency}`,
    });
    return;
  }

  let totalUsd = 0;
  let measuredAny = false;
  for (const e of bom.entries) {
    if (e.volume === undefined || e.material === undefined) continue;
    const rate = costRates[e.material];
    if (rate === undefined) continue;
    measuredAny = true;
    totalUsd += e.volume * rate;
  }

  if (!measuredAny) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: undefined,
      limit: c.maxCurrency,
      severity: 'warning',
      detail: 'no part had both volume and a costed material',
    });
    return;
  }

  const totalInCurrency = totalUsd * fx;
  if (totalInCurrency > c.maxCurrency) {
    out.push({
      constraintIndex: index,
      kind: c.kind,
      actual: totalInCurrency,
      limit: c.maxCurrency,
      severity: 'error',
      detail:
        `cost ${totalInCurrency.toFixed(2)} ${c.currency} exceeds ` +
        `${c.maxCurrency} ${c.currency}`,
    });
  }
}

function checkMaterialHomogeneity(
  c: MaterialHomogeneityConstraint,
  index: number,
  bom: ReturnType<typeof buildBom>,
  out: ConstraintViolation[],
): void {
  const allowed = new Set(c.allowedMaterials);
  for (const e of bom.entries) {
    const material = e.material ?? 'unspecified';
    if (!allowed.has(material)) {
      out.push({
        constraintIndex: index,
        kind: c.kind,
        actual: material,
        limit: c.allowedMaterials,
        severity: 'error',
        detail: `part ${e.partId} uses '${material}', not in allowed list`,
      });
    }
  }
}
