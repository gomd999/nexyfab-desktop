/**
 * centerOfBuoyancy.ts — Compute the centre of buoyancy of a part /
 * assembly submerged in a fluid.
 *
 * For a part submerged in water (or any fluid):
 *
 *   - Buoyancy force = ρ_fluid · g · V_displaced (Archimedes).
 *   - Centre of buoyancy = centroid of the displaced fluid volume.
 *
 * For floating bodies, the metacentre M lies above the CG if the
 * waterline tilts. Stability requires KM > KG, where:
 *
 *   - K = keel reference point.
 *   - B = centre of buoyancy.
 *   - M = metacentre = B + I / V (I = waterline area moment of
 *     inertia, V = displaced volume).
 *
 * Module:
 *   - Accepts the submerged shape as a tetrahedral mesh.
 *   - Computes displaced volume + centre of buoyancy.
 *   - For floating bodies, computes metacentric height GM.
 *   - Stability classification.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Tetrahedron {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  v3: Vec3;
}

export interface FluidSpec {
  /** Density (kg/m³). Water = 1000. */
  densityKgM3: number;
  /** Acceleration of gravity (m/s²). Earth = 9.81. */
  gravityMs2: number;
}

export const WATER: FluidSpec = { densityKgM3: 1000, gravityMs2: 9.81 };

export interface BuoyancyResult {
  /** Displaced volume (mm³). */
  displacedVolumeMm3: number;
  /** Centre of buoyancy in part coords. */
  centerOfBuoyancy: Vec3;
  /** Buoyancy force magnitude (N). */
  buoyancyForceN: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeBuoyancy(submerged: Tetrahedron[], fluid: FluidSpec = WATER): BuoyancyResult {
  if (submerged.length === 0) {
    return { displacedVolumeMm3: 0, centerOfBuoyancy: { x: 0, y: 0, z: 0 }, buoyancyForceN: 0 };
  }
  let totalVolume = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const tet of submerged) {
    const vol = tetVolume(tet);
    const centroid = tetCentroid(tet);
    totalVolume += vol;
    cx += vol * centroid.x;
    cy += vol * centroid.y;
    cz += vol * centroid.z;
  }
  const cob: Vec3 = totalVolume === 0 ? { x: 0, y: 0, z: 0 } : { x: cx / totalVolume, y: cy / totalVolume, z: cz / totalVolume };
  // Convert mm³ to m³.
  const volM3 = totalVolume / 1e9;
  const force = fluid.densityKgM3 * fluid.gravityMs2 * volM3;
  return {
    displacedVolumeMm3: totalVolume,
    centerOfBuoyancy: cob,
    buoyancyForceN: force,
  };
}

function tetVolume(t: Tetrahedron): number {
  const ax = t.v1.x - t.v0.x, ay = t.v1.y - t.v0.y, az = t.v1.z - t.v0.z;
  const bx = t.v2.x - t.v0.x, by = t.v2.y - t.v0.y, bz = t.v2.z - t.v0.z;
  const cx = t.v3.x - t.v0.x, cy = t.v3.y - t.v0.y, cz = t.v3.z - t.v0.z;
  // |a·(b×c)| / 6
  const cross_x = by * cz - bz * cy;
  const cross_y = bz * cx - bx * cz;
  const cross_z = bx * cy - by * cx;
  return Math.abs(ax * cross_x + ay * cross_y + az * cross_z) / 6;
}

function tetCentroid(t: Tetrahedron): Vec3 {
  return {
    x: (t.v0.x + t.v1.x + t.v2.x + t.v3.x) / 4,
    y: (t.v0.y + t.v1.y + t.v2.y + t.v3.y) / 4,
    z: (t.v0.z + t.v1.z + t.v2.z + t.v3.z) / 4,
  };
}

// ── Metacentric height ────────────────────────────────────────

export interface MetacentreInput {
  /** Centre of gravity in part coords. */
  centerOfGravity: Vec3;
  /** Centre of buoyancy. */
  centerOfBuoyancy: Vec3;
  /** Displaced volume (mm³). */
  displacedVolumeMm3: number;
  /** Second moment of area of waterline plane (mm⁴). */
  waterlineIxxMm4: number;
}

export interface MetacentreResult {
  /** GM = BM − BG, signed. */
  metacentricHeightMm: number;
  /** True if GM > 0 (stable). */
  stable: boolean;
  /** Distance from CB to metacentre. */
  bmMm: number;
  /** Distance from CG to CB (G above B = positive). */
  bgMm: number;
}

export function computeMetacentricHeight(input: MetacentreInput): MetacentreResult {
  const bm = input.displacedVolumeMm3 === 0 ? 0 : input.waterlineIxxMm4 / input.displacedVolumeMm3;
  const bg = input.centerOfGravity.z - input.centerOfBuoyancy.z;
  const gm = bm - bg;
  return {
    metacentricHeightMm: gm,
    stable: gm > 0,
    bmMm: bm,
    bgMm: bg,
  };
}

// ── Equilibrium tilt ──────────────────────────────────────────

export interface TiltResult {
  inEquilibrium: boolean;
  netForceN: number;
  /** Roll moment arm (mm). */
  rollMomentArmMm: number;
}

export function tiltAnalysis(buoyancy: BuoyancyResult, cog: Vec3, weightN: number): TiltResult {
  const net = buoyancy.buoyancyForceN - weightN;
  const arm = Math.hypot(buoyancy.centerOfBuoyancy.x - cog.x, buoyancy.centerOfBuoyancy.y - cog.y);
  return {
    inEquilibrium: Math.abs(net) < 0.01 * weightN && arm < 0.1,
    netForceN: net,
    rollMomentArmMm: arm,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface BuoyancySummary {
  displacedVolumeMm3: number;
  centerOfBuoyancy: Vec3;
  buoyancyForceN: number;
}

export function summarize(result: BuoyancyResult): BuoyancySummary {
  return {
    displacedVolumeMm3: result.displacedVolumeMm3,
    centerOfBuoyancy: result.centerOfBuoyancy,
    buoyancyForceN: result.buoyancyForceN,
  };
}
