// ─── Draft Angle Analysis ──────────────────────────────────────────────────
// Injection-molding / casting analysis: compare each triangle's normal against
// the mold pull direction to detect faces that cannot be ejected (undercuts)
// or faces with insufficient draft.
//
// Terminology:
//  - pullDirection: unit vector along which the mold half moves when opening
//  - draft angle: angle between a face's normal and the plane perpendicular to
//    the pull direction (i.e. 90° − angle(normal, pull))
//  - positive draft: face leans outward relative to pull (can eject cleanly)
//  - vertical face: nearly parallel to pull direction (borderline — add draft)
//  - undercut: face leans inward relative to pull (blocks ejection)

import * as THREE from 'three';

export type PullAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface DraftAnalysisOptions {
  /** Mold pull direction (unit vector). */
  pullDirection: [number, number, number];
  /** Minimum draft angle (deg) below which a face is flagged "vertical". */
  minDraftDeg: number;
}

export interface DraftAnalysisResult {
  /** Draft angle in degrees for each triangle (signed: negative = undercut). */
  faceAngles: Float32Array;
  /** Triangle indices whose draft ≥ minDraft (good). */
  positiveFaces: number[];
  /** Triangle indices with 0 ≤ draft < minDraft (vertical / needs draft). */
  verticalFaces: number[];
  /** Triangle indices whose draft < 0 (undercut — molding impossible). */
  undercutFaces: number[];
  /** Triangle count by category. */
  counts: {
    positive: number;
    vertical: number;
    undercut: number;
    total: number;
  };
  /** Minimum draft angle found anywhere on the model (deg). */
  minAngle: number;
  /** Maximum draft angle (deg). */
  maxAngle: number;
}

// ─── Axis helpers ────────────────────────────────────────────────────────────

export const PULL_AXES: Record<PullAxis, [number, number, number]> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

// ─── Core analysis ───────────────────────────────────────────────────────────

export function analyzeDraft(
  geometry: THREE.BufferGeometry,
  options: DraftAnalysisOptions,
): DraftAnalysisResult {
  // Use a non-indexed copy so triangle index = i / 3 in the position buffer.
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const vertCount = pos.count;
  const triCount = Math.floor(vertCount / 3);

  const pull = new THREE.Vector3(...options.pullDirection).normalize();
  const minDraftRad = (options.minDraftDeg * Math.PI) / 180;

  const faceAngles = new Float32Array(triCount);
  const positiveFaces: number[] = [];
  const verticalFaces: number[] = [];
  const undercutFaces: number[] = [];
  let minAngle = Infinity;
  let maxAngle = -Infinity;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    const lenSq = normal.lengthSq();
    if (lenSq < 1e-20) {
      faceAngles[i] = 0;
      verticalFaces.push(i);
      continue;
    }
    normal.multiplyScalar(1 / Math.sqrt(lenSq));

    // Dot of normal and pull: +1 means normal points with pull (ejectable),
    // -1 means normal points against pull (undercut on that half).
    const dot = THREE.MathUtils.clamp(normal.dot(pull), -1, 1);

    // Draft angle = signed angle from the plane perpendicular to pull.
    //   dot = +1 → 90°, dot = 0 → 0°, dot = -1 → -90° (undercut)
    const draftRad = Math.asin(dot);
    const draftDeg = (draftRad * 180) / Math.PI;
    faceAngles[i] = draftDeg;

    if (draftDeg < minAngle) minAngle = draftDeg;
    if (draftDeg > maxAngle) maxAngle = draftDeg;

    if (draftRad < 0) {
      undercutFaces.push(i);
    } else if (draftRad < minDraftRad) {
      verticalFaces.push(i);
    } else {
      positiveFaces.push(i);
    }
  }

  return {
    faceAngles,
    positiveFaces,
    verticalFaces,
    undercutFaces,
    counts: {
      positive: positiveFaces.length,
      vertical: verticalFaces.length,
      undercut: undercutFaces.length,
      total: triCount,
    },
    minAngle: isFinite(minAngle) ? minAngle : 0,
    maxAngle: isFinite(maxAngle) ? maxAngle : 0,
  };
}
