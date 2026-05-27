/**
 * submodelBoundaryCut.ts — Generate a submodel boundary cut from a
 * global FEA model.
 *
 * Submodeling refinement workflow:
 *
 *   1. Run a global, coarse FEA. Identify a hotspot region (high
 *      stress / large gradient).
 *   2. Cut a small submodel containing the hotspot.
 *   3. Apply displacement boundary conditions (DBC) on the cut
 *      faces, interpolated from the global model's nodal results.
 *   4. Solve the submodel with a much finer mesh.
 *
 * Module:
 *   - Picks the submodel bounding box around a hotspot.
 *   - Identifies cut faces (which sides of the box are exposed).
 *   - Interpolates global displacement field onto cut-face nodes.
 *   - Estimates St. Venant validity (cut faces far enough from
 *     hotspot that DBC reflect global response, not local).
 *
 * Reference: ASME PVP, ANSYS Submodeling guide.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface GlobalNode {
  id: string;
  position: Vec3;
  displacement: Vec3;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface HotspotMarker {
  /** Centre of the hotspot. */
  centre: Vec3;
  /** Characteristic radius (mm). */
  radius: number;
}

export interface SubmodelCutOptions {
  /** Multiplier on hotspot radius to size the submodel box. */
  boxMultiplier: number;
  /** Minimum St. Venant distance ratio (cut-face to hotspot / hotspot radius). */
  minStVenantRatio: number;
}

export const DEFAULT_OPTIONS: SubmodelCutOptions = {
  boxMultiplier: 4,
  minStVenantRatio: 3,
};

export interface SubmodelCut {
  box: BoundingBox;
  /** Nodes from the global model that lie on the cut faces (within tolerance). */
  cutFaceNodes: GlobalNode[];
  /** Whether all cut faces meet St. Venant criterion. */
  stVenantSatisfied: boolean;
  /** Minimum distance from cut face to hotspot centre. */
  minCutDistance: number;
  /** Diagnostic: nodes inside the submodel volume. */
  internalNodeCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function createSubmodelCut(
  globalNodes: GlobalNode[],
  hotspot: HotspotMarker,
  options: Partial<SubmodelCutOptions> = {},
): SubmodelCut {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const halfSize = hotspot.radius * opts.boxMultiplier;
  const box: BoundingBox = {
    min: { x: hotspot.centre.x - halfSize, y: hotspot.centre.y - halfSize, z: hotspot.centre.z - halfSize },
    max: { x: hotspot.centre.x + halfSize, y: hotspot.centre.y + halfSize, z: hotspot.centre.z + halfSize },
  };
  const tol = halfSize * 0.05;
  const cutFaceNodes: GlobalNode[] = [];
  let internal = 0;
  for (const n of globalNodes) {
    if (insideBox(n.position, box)) {
      const onFace = isOnAnyFace(n.position, box, tol);
      if (onFace) cutFaceNodes.push(n);
      else internal++;
    }
  }
  const minDist = halfSize; // Distance from box face to centre = halfSize.
  const stVenantOk = minDist / hotspot.radius >= opts.minStVenantRatio;
  return {
    box,
    cutFaceNodes,
    stVenantSatisfied: stVenantOk,
    minCutDistance: minDist,
    internalNodeCount: internal,
  };
}

// ── Geometry helpers ──────────────────────────────────────────

function insideBox(p: Vec3, box: BoundingBox): boolean {
  return p.x >= box.min.x && p.x <= box.max.x
    && p.y >= box.min.y && p.y <= box.max.y
    && p.z >= box.min.z && p.z <= box.max.z;
}

function isOnAnyFace(p: Vec3, box: BoundingBox, tol: number): boolean {
  return (
    Math.abs(p.x - box.min.x) <= tol || Math.abs(p.x - box.max.x) <= tol
    || Math.abs(p.y - box.min.y) <= tol || Math.abs(p.y - box.max.y) <= tol
    || Math.abs(p.z - box.min.z) <= tol || Math.abs(p.z - box.max.z) <= tol
  );
}

// ── Displacement interpolation ────────────────────────────────

export interface SubmodelMeshNode {
  id: string;
  position: Vec3;
}

export interface InterpolatedBC {
  submodelNodeId: string;
  position: Vec3;
  displacement: Vec3;
  /** Confidence (inverse-distance-weighted). */
  confidence: number;
}

export function interpolateDisplacement(
  cut: SubmodelCut,
  submodelMeshNodes: SubmodelMeshNode[],
  options: { kNearest?: number; powerExponent?: number } = {},
): InterpolatedBC[] {
  const k = options.kNearest ?? 4;
  const power = options.powerExponent ?? 2;
  const sources = cut.cutFaceNodes;
  if (sources.length === 0) return [];
  return submodelMeshNodes.map(target => {
    // Find K nearest sources.
    const ranked = sources
      .map(s => ({ s, dist: dist3(s.position, target.position) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k);

    let sumW = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const r of ranked) {
      const w = r.dist === 0 ? 1e6 : 1 / Math.pow(r.dist, power);
      sumW += w;
      dx += r.s.displacement.x * w;
      dy += r.s.displacement.y * w;
      dz += r.s.displacement.z * w;
    }
    return {
      submodelNodeId: target.id,
      position: target.position,
      displacement: sumW > 0
        ? { x: dx / sumW, y: dy / sumW, z: dz / sumW }
        : { x: 0, y: 0, z: 0 },
      confidence: sumW === 0 ? 0 : Math.min(1, sumW / ranked.length),
    };
  });
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Validity check ────────────────────────────────────────────

export interface ValidationReport {
  ok: boolean;
  issues: string[];
  cutFaceCount: number;
  stVenantRatio: number;
}

export function validateSubmodelCut(
  cut: SubmodelCut,
  hotspot: HotspotMarker,
  minRatio: number = DEFAULT_OPTIONS.minStVenantRatio,
): ValidationReport {
  const issues: string[] = [];
  const ratio = cut.minCutDistance / Math.max(0.001, hotspot.radius);
  if (ratio < minRatio) {
    issues.push(`St. Venant ratio ${ratio.toFixed(2)} < ${minRatio} — cut face too close, DBC will reflect local effects.`);
  }
  if (cut.cutFaceNodes.length < 4) {
    issues.push(`Only ${cut.cutFaceNodes.length} cut-face nodes — insufficient for interpolation. Increase global mesh density.`);
  }
  if (cut.internalNodeCount === 0) {
    issues.push(`No nodes inside the submodel box — the box may be empty or below mesh resolution.`);
  }
  return {
    ok: issues.length === 0,
    issues,
    cutFaceCount: cut.cutFaceNodes.length,
    stVenantRatio: ratio,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface SubmodelSummary {
  cutFaceNodeCount: number;
  internalNodeCount: number;
  stVenantSatisfied: boolean;
  boxVolumeMm3: number;
}

export function summarize(cut: SubmodelCut): SubmodelSummary {
  const dx = cut.box.max.x - cut.box.min.x;
  const dy = cut.box.max.y - cut.box.min.y;
  const dz = cut.box.max.z - cut.box.min.z;
  return {
    cutFaceNodeCount: cut.cutFaceNodes.length,
    internalNodeCount: cut.internalNodeCount,
    stVenantSatisfied: cut.stVenantSatisfied,
    boxVolumeMm3: dx * dy * dz,
  };
}
