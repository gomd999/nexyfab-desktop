/**
 * multiAxisIndex.ts — 3+2 indexing setup for CAM operations.
 *
 * "3+2" means a 5-axis machine locked to discrete rotary positions
 * while cutting (no simultaneous tilt). It's a sweet spot: faster
 * setup than 5-axis-continuous, but reaches every face of a part
 * without re-fixturing.
 *
 * This module:
 *   - Picks a Work-Coordinate-System (WCS) per face normal.
 *   - Computes the rotary (A, C) angles required to orient the
 *     spindle perpendicular to the face.
 *   - Tags downstream operations with the WCS so the G-code emitter
 *     can `G54.1 P{n}` switch between fixtures.
 *
 * Convention: machine Z is up; +X right; rotary A about X, C about Z.
 * Spindle starts aligned with -Z (pointing down). For 3+2 we tilt
 * about A then rotate about C until -Z maps to the face normal.
 */

export interface FaceForIndexing {
  faceId: string;
  /** Face outward normal in part frame (unit vector). */
  normal: [number, number, number];
  /** Centroid in part frame (mm). */
  centroid: [number, number, number];
}

export interface WcsAssignment {
  faceId: string;
  /** WCS slot (1..200 for typical Fanuc-style addressing). */
  wcsIndex: number;
  /** Rotary A angle (deg). */
  rotA: number;
  /** Rotary C angle (deg). */
  rotC: number;
  /** Face normal as machine -Z after rotation (sanity check, ≈ [0,0,-1]). */
  normalAfterRot: [number, number, number];
}

export interface IndexingPlan {
  assignments: WcsAssignment[];
  totalWcs: number;
  reusableWcsMap: Map<string, number>;
}

/** Compute (A,C) such that part-frame normal n maps onto machine -Z. */
function anglesFromNormal(n: [number, number, number]): { A: number; C: number } {
  const [nx, ny, nz] = n;
  // Match -Z (down). A tilts about X, C rotates about Z.
  // For the spindle to point along the negative of n in part frame:
  //   C rotates (nx, ny, _) to lie on the +X axis (or whichever).
  //   A then tilts down to bring n.z to -1.
  // Standard derivation:
  //   C = atan2(ny, nx)
  //   A = atan2(sqrt(nx² + ny²), -nz)  // angle from -Z up to n
  const C_rad = Math.atan2(ny, nx);
  // Tilt about A so the part-frame normal ends up along machine +Z
  // (the spindle, pointing -Z, will then sit perpendicular to the face).
  const A_rad = Math.atan2(Math.sqrt(nx * nx + ny * ny), nz);
  return {
    A: (A_rad * 180) / Math.PI,
    C: (C_rad * 180) / Math.PI,
  };
}

function quantizeAngle(deg: number, gridDeg = 0.01): number {
  return Math.round(deg / gridDeg) * gridDeg;
}

/** Rotate a vector by C about Z then A about X (matches anglesFromNormal). */
function rotateForVerify(n: [number, number, number], A: number, C: number): [number, number, number] {
  const Crad = (-C * Math.PI) / 180;
  const Arad = (-A * Math.PI) / 180;
  // First undo C (rotate about Z by -C).
  let x = n[0] * Math.cos(Crad) - n[1] * Math.sin(Crad);
  let y = n[0] * Math.sin(Crad) + n[1] * Math.cos(Crad);
  let z = n[2];
  // Then undo A (rotate about X by -A).
  const y2 = y * Math.cos(Arad) - z * Math.sin(Arad);
  const z2 = y * Math.sin(Arad) + z * Math.cos(Arad);
  return [x, y2, z2];
}

export function planIndexing(faces: FaceForIndexing[]): IndexingPlan {
  const reusable = new Map<string, number>(); // angle-key → wcs index
  const assignments: WcsAssignment[] = [];
  let nextWcs = 1;

  for (const f of faces) {
    const { A, C } = anglesFromNormal(f.normal);
    const Aq = quantizeAngle(A);
    const Cq = quantizeAngle(C);
    const key = `${Aq.toFixed(2)}|${Cq.toFixed(2)}`;
    let wcs = reusable.get(key);
    if (wcs == null) {
      wcs = nextWcs++;
      reusable.set(key, wcs);
    }
    assignments.push({
      faceId: f.faceId,
      wcsIndex: wcs,
      rotA: Aq,
      rotC: Cq,
      normalAfterRot: rotateForVerify(f.normal, Aq, Cq),
    });
  }

  return {
    assignments,
    totalWcs: reusable.size,
    reusableWcsMap: reusable,
  };
}

/** Format an Fanuc-style WCS preamble for a single assignment. */
export function emitWcsPreamble(a: WcsAssignment): string {
  // G54.1 Pn enables extended WCS in Fanuc 30i/31i.
  // A and C are commanded as positioning moves before re-engaging.
  return [
    `; FACE ${a.faceId} → WCS ${a.wcsIndex}`,
    `G54.1 P${a.wcsIndex}`,
    `G00 A${a.rotA.toFixed(3)} C${a.rotC.toFixed(3)}`,
  ].join('\n');
}
