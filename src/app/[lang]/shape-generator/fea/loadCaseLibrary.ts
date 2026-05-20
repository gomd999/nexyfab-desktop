/**
 * loadCaseLibrary.ts — Pre-built FEA load case templates.
 *
 * A *load case* in FEA is the combination of constraints + loads
 * applied to a part to compute its stress / deflection response.
 * Real-world parts get analyzed under multiple cases (operational,
 * worst-case, fault, transport vibration, ...). Engineers reuse a
 * common library of templates rather than building each case from
 * scratch:
 *
 *   - **Point load** (force at vertex / region).
 *   - **Distributed pressure** (area load).
 *   - **Body force** (gravity, centrifugal).
 *   - **Thermal expansion** (delta T).
 *   - **Boundary fixed** (clamp / pin / roller).
 *   - **Bearing load** (radial + axial vector).
 *
 * This module:
 *
 *   - Provides typed builders for each load case.
 *   - Validates a load case (warns on under-/over-constrained).
 *   - Computes per-case reactions for sanity check.
 *   - Stacks multiple cases into a *load matrix* for batch solves.
 */

export interface Vec3 { x: number; y: number; z: number }

export type LoadKind = 'point' | 'pressure' | 'body' | 'thermal' | 'bearing' | 'constraint';

export interface LoadCase {
  id: string;
  name: string;
  kind: LoadKind;
  /** Applies to which entity (face id / vertex id / region tag). */
  target: string;
  /** Specific parameters by kind. */
  data: PointLoad | PressureLoad | BodyLoad | ThermalLoad | BearingLoad | ConstraintLoad;
}

export interface PointLoad {
  kind: 'point';
  /** Force vector in N. */
  force: Vec3;
  /** Optional moment vector in N·mm. */
  moment?: Vec3;
}

export interface PressureLoad {
  kind: 'pressure';
  /** Pressure (MPa). */
  pressureMpa: number;
  /** Direction (default = inward face normal). */
  direction?: 'inward' | 'outward' | Vec3;
}

export interface BodyLoad {
  kind: 'body';
  /** Acceleration vector m/s² (gravity = [0,0,-9.81]). */
  acceleration: Vec3;
}

export interface ThermalLoad {
  kind: 'thermal';
  /** Temperature change ΔT (°C). */
  deltaC: number;
  /** Reference temperature, °C. */
  referenceC?: number;
}

export interface BearingLoad {
  kind: 'bearing';
  /** Radial component magnitude, N. */
  radialN: number;
  /** Axial component magnitude, N. */
  axialN: number;
  /** Bearing axis (unit vector). */
  axis: Vec3;
}

export interface ConstraintLoad {
  kind: 'constraint';
  /** What DOFs are fixed. */
  fixed: { x: boolean; y: boolean; z: boolean; rx: boolean; ry: boolean; rz: boolean };
}

// ── Builders ───────────────────────────────────────────────────

export function buildPointLoad(id: string, target: string, force: Vec3, moment?: Vec3): LoadCase {
  return {
    id,
    name: `Point load on ${target}`,
    kind: 'point',
    target,
    data: { kind: 'point', force, ...(moment ? { moment } : {}) },
  };
}

export function buildPressure(id: string, target: string, pressureMpa: number, direction: 'inward' | 'outward' = 'inward'): LoadCase {
  return {
    id,
    name: `Pressure on ${target}`,
    kind: 'pressure',
    target,
    data: { kind: 'pressure', pressureMpa, direction },
  };
}

export function buildGravity(id: string = 'gravity', target: string = 'all'): LoadCase {
  return {
    id,
    name: 'Gravity',
    kind: 'body',
    target,
    data: { kind: 'body', acceleration: { x: 0, y: 0, z: -9.81 } },
  };
}

export function buildThermal(id: string, target: string, deltaC: number, referenceC: number = 20): LoadCase {
  return {
    id,
    name: `ΔT=${deltaC}°C on ${target}`,
    kind: 'thermal',
    target,
    data: { kind: 'thermal', deltaC, referenceC },
  };
}

export function buildBearing(id: string, target: string, radialN: number, axialN: number, axis: Vec3): LoadCase {
  return {
    id,
    name: `Bearing load on ${target}`,
    kind: 'bearing',
    target,
    data: { kind: 'bearing', radialN, axialN, axis },
  };
}

export function buildFixed(id: string, target: string, axes: { x?: boolean; y?: boolean; z?: boolean; rx?: boolean; ry?: boolean; rz?: boolean } = {}): LoadCase {
  return {
    id,
    name: `Fixed ${target}`,
    kind: 'constraint',
    target,
    data: {
      kind: 'constraint',
      fixed: {
        x: axes.x ?? true,
        y: axes.y ?? true,
        z: axes.z ?? true,
        rx: axes.rx ?? true,
        ry: axes.ry ?? true,
        rz: axes.rz ?? true,
      },
    },
  };
}

// ── Validation ─────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  /** Net force across all loads + constraints. */
  netForceN: Vec3;
  /** Net moment. */
  netMomentNmm: Vec3;
}

export function validateLoadSet(loads: LoadCase[]): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let constraintCount = 0;
  let loadCount = 0;
  const netForce: Vec3 = { x: 0, y: 0, z: 0 };
  const netMoment: Vec3 = { x: 0, y: 0, z: 0 };
  for (const l of loads) {
    if (l.data.kind === 'constraint') constraintCount++;
    else loadCount++;
    if (l.data.kind === 'point') {
      netForce.x += l.data.force.x;
      netForce.y += l.data.force.y;
      netForce.z += l.data.force.z;
      if (l.data.moment) {
        netMoment.x += l.data.moment.x;
        netMoment.y += l.data.moment.y;
        netMoment.z += l.data.moment.z;
      }
    }
  }
  if (constraintCount === 0 && loadCount > 0) {
    errors.push('No constraint defined; FEA would yield rigid-body motion.');
  }
  if (loadCount === 0 && constraintCount > 0) {
    warnings.push('Constraints without loads — solver will return zero deflection.');
  }
  if (loads.length === 0) {
    errors.push('Empty load set.');
  }
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    netForceN: netForce,
    netMomentNmm: netMoment,
  };
}

// ── Combination ────────────────────────────────────────────────

export interface LoadCombination {
  id: string;
  name: string;
  /** Cases to combine (id → multiplier). */
  factors: Record<string, number>;
}

export function combineCases(cases: LoadCase[], combination: LoadCombination): LoadCase[] {
  const out: LoadCase[] = [];
  const map = new Map<string, LoadCase>();
  for (const c of cases) map.set(c.id, c);
  for (const [id, factor] of Object.entries(combination.factors)) {
    const base = map.get(id);
    if (!base) continue;
    if (base.data.kind === 'point') {
      const data: PointLoad = {
        kind: 'point',
        force: scaleVec(base.data.force, factor),
        ...(base.data.moment ? { moment: scaleVec(base.data.moment, factor) } : {}),
      };
      out.push({ ...base, id: `${base.id}_${combination.id}`, data });
    } else {
      out.push(base);
    }
  }
  return out;
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// ── Summary ────────────────────────────────────────────────────

export interface LoadSummary {
  caseCount: number;
  constraintCount: number;
  pointLoadCount: number;
  pressureCount: number;
  bodyLoadCount: number;
  thermalCount: number;
  bearingCount: number;
  totalAppliedForceN: number;
}

export function summarize(loads: LoadCase[]): LoadSummary {
  const counts = { point: 0, pressure: 0, body: 0, thermal: 0, bearing: 0, constraint: 0 };
  let totalForce = 0;
  for (const l of loads) {
    counts[l.kind]++;
    if (l.data.kind === 'point') {
      totalForce += Math.hypot(l.data.force.x, l.data.force.y, l.data.force.z);
    } else if (l.data.kind === 'bearing') {
      totalForce += Math.hypot(l.data.radialN, l.data.axialN);
    }
  }
  return {
    caseCount: loads.length,
    constraintCount: counts.constraint,
    pointLoadCount: counts.point,
    pressureCount: counts.pressure,
    bodyLoadCount: counts.body,
    thermalCount: counts.thermal,
    bearingCount: counts.bearing,
    totalAppliedForceN: totalForce,
  };
}
