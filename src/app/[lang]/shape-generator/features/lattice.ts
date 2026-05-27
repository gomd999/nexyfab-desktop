/**
 * lattice.ts — Additive-manufacturing lattice structures for
 * lightweighting.
 *
 * Lattices replace solid infill with periodic minimal surfaces or
 * strut networks. Used in aerospace / medical / 3D-printed parts to
 * cut weight while keeping target stiffness. Major families:
 *
 *   - **TPMS (Triply Periodic Minimal Surfaces)** — gyroid, schwarz-P,
 *     diamond. Defined by implicit equations sampled on a grid. Best
 *     stiffness-to-weight; smooth surface; manufacturable directly.
 *   - **Strut lattices** — octet truss, body-centered cubic (BCC),
 *     diamond cubic, kelvin. Geometric struts between nodes.
 *
 * Output is volume samples (signed-distance / scalar field) suitable
 * for marching-cubes meshing.
 */

export type LatticeKind =
  | 'gyroid' | 'schwarz-p' | 'schwarz-d' | 'diamond' | 'lidinoid'
  | 'octet' | 'bcc' | 'fcc' | 'kelvin' | 'diamond-strut';

export interface LatticeParams {
  /** Cell size (period) in mm. Smaller = more cells = stronger but slower. */
  cellSizeMm: number;
  /** Wall / strut thickness in mm (for TPMS this is the offset, for strut it's the strut radius). */
  thicknessMm: number;
  /** Bounding box. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface LatticeSample {
  /** Signed-distance-style field value at the sample point. <0 = inside material. */
  value: number;
  /** Sample position. */
  position: [number, number, number];
}

// ── TPMS field functions ────────────────────────────────────────

/** Gyroid: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = c
 *  Where (x,y,z) are scaled by 2π/cellSize. */
export function gyroidField(x: number, y: number, z: number, cellSize: number, offset: number = 0): number {
  const k = (2 * Math.PI) / cellSize;
  const sx = Math.sin(k * x), cx = Math.cos(k * x);
  const sy = Math.sin(k * y), cy = Math.cos(k * y);
  const sz = Math.sin(k * z), cz = Math.cos(k * z);
  return sx * cy + sy * cz + sz * cx - offset;
}

/** Schwarz-P (primitive): cos(x) + cos(y) + cos(z) = c */
export function schwarzPField(x: number, y: number, z: number, cellSize: number, offset: number = 0): number {
  const k = (2 * Math.PI) / cellSize;
  return Math.cos(k * x) + Math.cos(k * y) + Math.cos(k * z) - offset;
}

/** Schwarz-D (diamond): sin(x)sin(y)sin(z) + sin(x)cos(y)cos(z) + cos(x)sin(y)cos(z) + cos(x)cos(y)sin(z) = c */
export function schwarzDField(x: number, y: number, z: number, cellSize: number, offset: number = 0): number {
  const k = (2 * Math.PI) / cellSize;
  const sx = Math.sin(k * x), cx = Math.cos(k * x);
  const sy = Math.sin(k * y), cy = Math.cos(k * y);
  const sz = Math.sin(k * z), cz = Math.cos(k * z);
  return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz - offset;
}

/** Diamond TPMS (Lidinoid family) */
export function diamondField(x: number, y: number, z: number, cellSize: number, offset: number = 0): number {
  const k = (2 * Math.PI) / cellSize;
  const sx = Math.sin(k * x), cx = Math.cos(k * x);
  const sy = Math.sin(k * y), cy = Math.cos(k * y);
  const sz = Math.sin(k * z), cz = Math.cos(k * z);
  return cx * cy * cz - sx * sy * sz - offset;
}

/** Convert wall-thickness in mm to the iso-level offset for a TPMS.
 *  For a gyroid the surface is at value=0; offset by ±t maps to a
 *  shell of thickness ~2t in mm-space. Approximation; iterate to fit. */
export function thicknessToOffset(thicknessMm: number, cellSizeMm: number): number {
  // Empirical: offset ≈ π × thickness / cellSize for moderate ratios.
  return Math.PI * thicknessMm / cellSizeMm;
}

// ── Strut lattices ──────────────────────────────────────────────

export interface StrutLatticeCell {
  /** Nodes in unit cube [0, 1]. */
  nodes: Array<[number, number, number]>;
  /** Strut connectivity (pairs of node indices). */
  struts: Array<[number, number]>;
}

export const OCTET_CELL: StrutLatticeCell = {
  // Octet truss: 6 face centers + cube corners; struts run face-center to face-center.
  nodes: [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    [0.5, 0.5, 0], [0.5, 0.5, 1],
    [0.5, 0, 0.5], [0.5, 1, 0.5],
    [0, 0.5, 0.5], [1, 0.5, 0.5],
  ],
  struts: [
    [8, 10], [8, 11], [8, 12], [8, 13],
    [9, 10], [9, 11], [9, 12], [9, 13],
    [10, 12], [10, 13],
    [11, 12], [11, 13],
    [0, 8], [1, 8], [2, 8], [3, 8],
    [4, 9], [5, 9], [6, 9], [7, 9],
  ],
};

export const BCC_CELL: StrutLatticeCell = {
  nodes: [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    [0.5, 0.5, 0.5],
  ],
  struts: [
    [0, 8], [1, 8], [2, 8], [3, 8],
    [4, 8], [5, 8], [6, 8], [7, 8],
  ],
};

export const FCC_CELL: StrutLatticeCell = {
  nodes: [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    [0.5, 0.5, 0], [0.5, 0.5, 1],
    [0.5, 0, 0.5], [0.5, 1, 0.5],
    [0, 0.5, 0.5], [1, 0.5, 0.5],
  ],
  struts: [
    [0, 8], [1, 8], [2, 8], [3, 8],
    [4, 9], [5, 9], [6, 9], [7, 9],
    [0, 10], [1, 10], [4, 10], [5, 10],
    [2, 11], [3, 11], [6, 11], [7, 11],
    [0, 12], [2, 12], [4, 12], [6, 12],
    [1, 13], [3, 13], [5, 13], [7, 13],
  ],
};

// ── Density estimation ──────────────────────────────────────────

export interface DensityEstimate {
  /** Volume fraction of material (0 = all hollow, 1 = solid). */
  materialFraction: number;
  /** Approximate mass given density in g/cm³. */
  massGrams: number;
  /** Bounding box volume in mm³. */
  bboxVolumeMm3: number;
  /** Material volume in mm³. */
  materialVolumeMm3: number;
}

/** Sample the lattice on a uniform grid and count "inside" cells. */
export function estimateDensity(
  kind: LatticeKind,
  params: LatticeParams,
  sampleDivisions: number = 16,
  materialDensityGPerCm3: number = 2.7, // 6061 aluminum default
): DensityEstimate {
  const { bounds, cellSizeMm, thicknessMm } = params;
  const dx = (bounds.max[0] - bounds.min[0]) / sampleDivisions;
  const dy = (bounds.max[1] - bounds.min[1]) / sampleDivisions;
  const dz = (bounds.max[2] - bounds.min[2]) / sampleDivisions;
  let insideCount = 0;
  let totalCount = 0;
  const offset = thicknessToOffset(thicknessMm, cellSizeMm);
  for (let i = 0; i < sampleDivisions; i++) {
    for (let j = 0; j < sampleDivisions; j++) {
      for (let k = 0; k < sampleDivisions; k++) {
        const x = bounds.min[0] + (i + 0.5) * dx;
        const y = bounds.min[1] + (j + 0.5) * dy;
        const z = bounds.min[2] + (k + 0.5) * dz;
        const f = evalField(kind, x, y, z, cellSizeMm, offset, thicknessMm);
        if (f < 0) insideCount++;
        totalCount++;
      }
    }
  }
  const fraction = totalCount > 0 ? insideCount / totalCount : 0;
  const bboxVol = (bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]) * (bounds.max[2] - bounds.min[2]);
  const matVol = bboxVol * fraction;
  // Convert mm³ → cm³: divide by 1000. Mass = vol_cm3 × density_g_per_cm3.
  const massG = (matVol / 1000) * materialDensityGPerCm3;
  return {
    materialFraction: fraction,
    bboxVolumeMm3: bboxVol,
    materialVolumeMm3: matVol,
    massGrams: massG,
  };
}

function evalField(
  kind: LatticeKind, x: number, y: number, z: number,
  cellSize: number, tpmsOffset: number, strutRadius: number,
): number {
  switch (kind) {
    case 'gyroid': return Math.abs(gyroidField(x, y, z, cellSize)) - tpmsOffset;
    case 'schwarz-p': return Math.abs(schwarzPField(x, y, z, cellSize)) - tpmsOffset;
    case 'schwarz-d': return Math.abs(schwarzDField(x, y, z, cellSize)) - tpmsOffset;
    case 'diamond': return Math.abs(diamondField(x, y, z, cellSize)) - tpmsOffset;
    case 'lidinoid': return Math.abs(diamondField(x, y, z, cellSize)) - tpmsOffset;
    case 'octet':
    case 'bcc':
    case 'fcc':
    case 'kelvin':
    case 'diamond-strut':
      return strutDistance(x, y, z, kind, cellSize) - strutRadius;
  }
}

function pickStrutCell(kind: LatticeKind): StrutLatticeCell {
  if (kind === 'bcc') return BCC_CELL;
  if (kind === 'fcc') return FCC_CELL;
  return OCTET_CELL;
}

/** Distance from point (x,y,z) to the nearest strut in the lattice. */
function strutDistance(x: number, y: number, z: number, kind: LatticeKind, cellSize: number): number {
  // Locate which cell the point lies in.
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const cz = Math.floor(z / cellSize);
  const lx = (x - cx * cellSize) / cellSize;
  const ly = (y - cy * cellSize) / cellSize;
  const lz = (z - cz * cellSize) / cellSize;

  const cell = pickStrutCell(kind);
  let minD = Infinity;
  for (const [aIdx, bIdx] of cell.struts) {
    const a = cell.nodes[aIdx]!;
    const b = cell.nodes[bIdx]!;
    const d = pointSegmentDistance([lx, ly, lz], a, b);
    if (d < minD) minD = d;
  }
  return minD * cellSize;
}

function pointSegmentDistance(p: [number, number, number], a: [number, number, number], b: [number, number, number]): number {
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const abLen2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  if (abLen2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const closest: [number, number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - closest[0], p[1] - closest[1], p[2] - closest[2]);
}

// ── Effective stiffness model ───────────────────────────────────

export interface EffectiveStiffness {
  /** Effective Young's modulus in MPa. */
  effectiveModulusMPa: number;
  /** Ratio relative to solid (0-1). */
  relativeModulus: number;
  /** Empirical exponent used in scaling law. */
  exponent: number;
}

/** Gibson-Ashby cellular solids scaling law:
 *    E_eff / E_solid = (rho_eff / rho_solid)^n
 *  where n is typically 2 for bending-dominated lattices (BCC, FCC),
 *  and 1 for stretch-dominated (octet truss).
 *  TPMS structures (gyroid, schwarz-p) sit in between (n ≈ 1.5). */
export function estimateEffectiveStiffness(
  kind: LatticeKind,
  density: DensityEstimate,
  solidModulusMPa: number,
): EffectiveStiffness {
  const n = scalingExponent(kind);
  const r = density.materialFraction;
  const ratio = Math.pow(r, n);
  return {
    effectiveModulusMPa: solidModulusMPa * ratio,
    relativeModulus: ratio,
    exponent: n,
  };
}

function scalingExponent(kind: LatticeKind): number {
  switch (kind) {
    case 'octet': return 1;
    case 'bcc': return 2;
    case 'fcc': return 1.5;
    case 'kelvin': return 1.5;
    case 'diamond-strut': return 1.8;
    case 'gyroid': return 1.7;
    case 'schwarz-p': return 1.5;
    case 'schwarz-d': return 1.6;
    case 'diamond': return 1.6;
    case 'lidinoid': return 1.6;
  }
}

// ── Manufacturability check ─────────────────────────────────────

export interface ManufacturabilityReport {
  manufacturable: boolean;
  /** Reasons it might not print. */
  issues: string[];
  /** Suggested adjustments. */
  suggestions: string[];
}

export function checkManufacturability(
  kind: LatticeKind,
  params: LatticeParams,
  process: 'SLA' | 'FDM' | 'SLS' | 'DMLS',
): ManufacturabilityReport {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const minFeatureMm = process === 'FDM' ? 0.8 : process === 'SLA' ? 0.3 : process === 'SLS' ? 0.5 : 0.4;
  if (params.thicknessMm < minFeatureMm) {
    issues.push(`Thickness ${params.thicknessMm}mm below ${process} min feature ${minFeatureMm}mm`);
    suggestions.push(`Increase thickness to ≥ ${minFeatureMm}mm`);
  }
  // Strut lattices in FDM struggle without support unless cell axis matches print axis.
  if (process === 'FDM' && (kind === 'fcc' || kind === 'octet')) {
    suggestions.push('Consider BCC or gyroid for FDM — fewer unsupported overhangs');
  }
  // Powder removal for SLS / DMLS.
  if ((process === 'SLS' || process === 'DMLS') && params.cellSizeMm < 2) {
    issues.push(`Cell size ${params.cellSizeMm}mm too small for powder removal in ${process}`);
    suggestions.push('Increase cell size to ≥ 2mm for ' + process);
  }
  return { manufacturable: issues.length === 0, issues, suggestions };
}
