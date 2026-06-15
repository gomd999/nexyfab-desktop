/**
 * tolerancePolicy — the ONE home for geometric numeric tolerances (F3).
 *
 * "Are these two points the same? Is this vector zero? Does this axis component
 * matter?" were each answered with ad-hoc constants (`QUANT = 1e5`, `EPS = 1e-9`,
 * bare `1e-6`) scattered across meshTopology / edgeCorrespondence /
 * topologyEdgeFinder. A welding miss in one of them silently mis-classified
 * solids as open — the exact failure mode a single, documented policy prevents.
 *
 * Manufacturing FIT tolerances (hole clearances, thread offsets) are domain
 * values, not geometric thresholds — they intentionally live with their standards
 * and are NOT centralised here.
 */

/**
 * Vertex welding tolerance (mm). Two positions within this distance collapse to
 * one topological vertex. 1e-5 mm = 10 nm — far below any real modelling feature,
 * comfortably above float noise from CSG / transforms.
 */
export const WELD_TOL_MM = 1e-5;

/** Buckets per mm for welding (= 1 / WELD_TOL_MM). */
const WELD_QUANT = 1 / WELD_TOL_MM;

/** Canonical integer bucket for one coordinate (welding quantisation). */
export function weldBucket(coord: number): number {
  return Math.round(coord * WELD_QUANT);
}

/**
 * Position key for vertex welding — two points within WELD_TOL_MM produce the
 * SAME string key, so they map to one canonical vertex.
 */
export function weldKey(x: number, y: number, z: number): string {
  return `${weldBucket(x)},${weldBucket(y)},${weldBucket(z)}`;
}

/**
 * Zero-length epsilon. A vector length / span below this is treated as zero — used
 * to guard normalisation and ratio denominators against divide-by-zero.
 */
export const ZERO_LENGTH_EPS = 1e-9;

/**
 * Axis-significance epsilon. Above this an axis component is "significant" — used
 * for dominant-axis detection and span tests, where 1e-9 is too tight (it would
 * treat sub-micron-but-real components as zero).
 */
export const AXIS_EPS = 1e-6;
