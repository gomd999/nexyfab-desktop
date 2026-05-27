/**
 * dfmGate.ts — Process-specific Design-for-Manufacturing gate.
 *
 * Sits at the end of the AI design pipeline:
 *
 *   intentSchema  →  paramConstraints  →  **dfmGate**  →  order placement
 *
 *   (well-formed)  →  (geometrically OK)  →  (manufacturable)  →  (orderable)
 *
 * The constraint validator catches "this design is impossible" (hole
 * bigger than the box). DFM catches "this design is possible, but the
 * factory you're sending it to can't make it". The rules below
 * encode industry-standard minimums per process; tighter shop-specific
 * tolerances belong in the partner's own quote engine.
 *
 * Rule sources:
 *   - 3D printing FDM: 0.8 mm wall, 45° overhang (industry default).
 *   - 3D printing SLA: 0.4 mm wall, 30° overhang.
 *   - CNC milling: 1.0 mm wall (tool clearance), 10:1 aspect ratio.
 *   - Injection molding: 0.8 mm wall (with 0.5° draft mandatory).
 *   - Sheet metal: 1× material thickness inner bend radius, ≥ 3× T flange.
 */

import type { IntentInput, IntentFeature } from '@/lib/openscad-render/intentToScad';

export type DfmProcess = 'fdm' | 'sla' | 'cnc' | 'injection' | 'sheetMetal';

export type DfmSeverity = 'error' | 'warning';

export interface DfmIssue {
  severity: DfmSeverity;
  /** Machine-readable code, e.g. `wall-too-thin`, `overhang-too-shallow`. */
  code: string;
  /** Process the rule applies to. Useful when a single intent is being
   *  evaluated against multiple candidate processes. */
  process: DfmProcess;
  /** Dot-path to the offending param. */
  path: string;
  message: string;
  /** A user-facing fix suggestion. */
  suggestion?: string;
}

export interface DfmReport {
  process: DfmProcess;
  /** True iff no errors (warnings still allowed). */
  manufacturable: boolean;
  issues: DfmIssue[];
}

/** Per-process minimum-feature limits. mm everywhere except angles. */
interface ProcessLimits {
  /** Minimum wall thickness, mm. */
  minWall: number;
  /** Minimum self-supporting overhang angle, degrees. (For 3D printing.) */
  minOverhangDeg: number;
  /** Maximum aspect ratio (longest dim / shortest dim) before warping/snap risk. */
  maxAspect: number;
  /** Minimum internal radius (sharp corners can't be machined by mill, or
   *  cause stress concentration in plastic). */
  minInternalRadius: number;
  /** Minimum hole diameter. */
  minHoleDiameter: number;
  /** Process requires draft angle on vertical walls? (Injection only.) */
  requiresDraft: boolean;
}

const LIMITS: Record<DfmProcess, ProcessLimits> = {
  fdm: {
    minWall: 0.8, minOverhangDeg: 45, maxAspect: 8,
    minInternalRadius: 0, minHoleDiameter: 1.0, requiresDraft: false,
  },
  sla: {
    minWall: 0.4, minOverhangDeg: 30, maxAspect: 10,
    minInternalRadius: 0, minHoleDiameter: 0.5, requiresDraft: false,
  },
  cnc: {
    minWall: 1.0, minOverhangDeg: 90 /* irrelevant; not used */, maxAspect: 10,
    minInternalRadius: 0.5, minHoleDiameter: 0.8, requiresDraft: false,
  },
  injection: {
    minWall: 0.8, minOverhangDeg: 90 /* not used */, maxAspect: 12,
    minInternalRadius: 0.5, minHoleDiameter: 0.8, requiresDraft: true,
  },
  sheetMetal: {
    minWall: 0.5, minOverhangDeg: 90 /* not used */, maxAspect: 100,
    minInternalRadius: 0, minHoleDiameter: 1.0, requiresDraft: false,
  },
};

function issue(
  issues: DfmIssue[],
  severity: DfmSeverity,
  code: string,
  process: DfmProcess,
  path: string,
  message: string,
  suggestion?: string,
): void {
  issues.push({ severity, code, process, path, message, suggestion });
}

function checkShellThickness(
  intent: IntentInput,
  process: DfmProcess,
  limits: ProcessLimits,
  issues: DfmIssue[],
): void {
  const features = intent.features ?? [];
  features.forEach((f, i) => {
    if (f.type !== 'shell') return;
    const t = f.params?.thickness_mm;
    if (typeof t === 'number' && t < limits.minWall) {
      issue(issues, 'error', 'wall-too-thin', process,
        `features[${i}].params.thickness_mm`,
        `Wall thickness ${t}mm is below the ${process.toUpperCase()} minimum (${limits.minWall}mm).`,
        `Set thickness_mm ≥ ${limits.minWall}.`);
    }
  });
}

function checkAspectRatio(
  intent: IntentInput,
  process: DfmProcess,
  limits: ProcessLimits,
  issues: DfmIssue[],
): void {
  if (intent.shapeId !== 'box') return;
  const w = intent.params.width_mm;
  const h = intent.params.height_mm;
  const d = intent.params.depth_mm;
  if (typeof w !== 'number' || typeof h !== 'number' || typeof d !== 'number') return;
  const minDim = Math.min(w, h, d);
  const maxDim = Math.max(w, h, d);
  if (minDim <= 0) return;
  const ratio = maxDim / minDim;
  if (ratio > limits.maxAspect) {
    issue(issues, 'warning', 'aspect-ratio-too-high', process,
      'params',
      `Aspect ratio ${ratio.toFixed(1)}:1 exceeds the ${process} recommendation (${limits.maxAspect}:1). Risk of warping or snap.`,
      `Reduce the longest dimension or add stiffening features.`);
  }
}

function checkHoleDiameter(
  intent: IntentInput,
  process: DfmProcess,
  limits: ProcessLimits,
  issues: DfmIssue[],
): void {
  const features = intent.features ?? [];
  features.forEach((f, i) => {
    if (f.type !== 'hole') return;
    const d = f.params?.diameter_mm;
    if (typeof d === 'number' && d < limits.minHoleDiameter) {
      issue(issues, 'error', 'hole-too-small', process,
        `features[${i}].params.diameter_mm`,
        `Hole diameter ${d}mm is below the ${process} minimum (${limits.minHoleDiameter}mm).`,
        `Set diameter_mm ≥ ${limits.minHoleDiameter}, or remove the hole.`);
    }
  });
}

function checkInternalRadius(
  intent: IntentInput,
  process: DfmProcess,
  limits: ProcessLimits,
  issues: DfmIssue[],
): void {
  if (limits.minInternalRadius <= 0) return;
  const features = intent.features ?? [];
  // Look for any fillet feature on internal corners. We don't have
  // explicit "internal vs external" info in the current intent
  // schema, so we use the heuristic: missing fillets on a CNC part
  // means sharp internal corners somewhere → warn.
  const hasFillet = features.some(f => f.type === 'fillet');
  if (!hasFillet && (process === 'cnc' || process === 'injection')) {
    issue(issues, 'warning', 'no-internal-radius', process,
      'features',
      `${process} parts typically need a fillet on internal corners (R ≥ ${limits.minInternalRadius}mm) — tool clearance / stress.`,
      `Add a fillet feature with radius_mm ≥ ${limits.minInternalRadius}.`);
  }
}

function checkDraft(
  intent: IntentInput,
  process: DfmProcess,
  limits: ProcessLimits,
  issues: DfmIssue[],
): void {
  if (!limits.requiresDraft) return;
  const features = intent.features ?? [];
  const hasDraft = features.some(f => f.type === 'draft' as IntentFeature['type']);
  if (!hasDraft) {
    issue(issues, 'error', 'draft-required', process,
      'features',
      `Injection molding parts require a draft angle (≥ 0.5°) on all vertical walls.`,
      `Add a draft feature with angle_deg ≥ 0.5.`);
  }
}

/**
 * Run the DFM gate for a single process. Returns a structured report
 * the agent / order-placement UI can surface inline.
 */
export function runDfmGate(intent: IntentInput, process: DfmProcess): DfmReport {
  const limits = LIMITS[process];
  const issues: DfmIssue[] = [];

  checkShellThickness(intent, process, limits, issues);
  checkAspectRatio(intent, process, limits, issues);
  checkHoleDiameter(intent, process, limits, issues);
  checkInternalRadius(intent, process, limits, issues);
  checkDraft(intent, process, limits, issues);

  const manufacturable = issues.every(i => i.severity !== 'error');
  return { process, manufacturable, issues };
}

/** Run the gate against every supported process and return reports
 *  sorted by manufacturability (manufacturable first). Useful when
 *  the user hasn't picked a process yet — surface "you can make this
 *  via X but not Y". */
export function runDfmGateAllProcesses(intent: IntentInput): DfmReport[] {
  const processes: DfmProcess[] = ['fdm', 'sla', 'cnc', 'injection', 'sheetMetal'];
  const reports = processes.map(p => runDfmGate(intent, p));
  reports.sort((a, b) => Number(b.manufacturable) - Number(a.manufacturable));
  return reports;
}
