/**
 * clearanceFanChecker.ts — Check whether a rotating body sweeps clear
 * of nearby static obstacles.
 *
 * Use cases:
 *   - door swing arc clearance
 *   - robot arm rotation envelope
 *   - lid/cover hinge sweep
 *
 * Model:
 *   - Pivot point (centre of rotation).
 *   - One or more "swept points" rigidly attached to the body, each
 *     described by an offset (dx, dy) from the pivot.
 *   - A rotation range [angleStart, angleEnd] (degrees, CCW positive).
 *   - A list of static obstacles, each a polygon.
 *
 * For each swept point, generate an arc; check the arc against every
 * obstacle edge (segment vs arc intersection). Report the first angle
 * at which a collision occurs (or "clear" if none).
 */

export interface FanPoint { x: number; y: number; id?: string }
export type Polygon = { x: number; y: number }[];

export interface ClearanceFanInput {
  pivot: { x: number; y: number };
  sweptPoints: FanPoint[];
  startAngleDeg: number;
  endAngleDeg: number;
  obstacles: { id: string; polygon: Polygon }[];
  arcSamples?: number; // default 64
}

export interface CollisionEvent {
  sweptPointId: string;
  obstacleId: string;
  angleDeg: number;
  position: { x: number; y: number };
}

export interface ClearanceFanResult {
  collisions: CollisionEvent[];
  clear: boolean;
  firstCollisionAngleDeg: number | null;
  arcExtentsMm: number; // farthest swept-point's arc length (informational)
  warnings: string[];
}

export function checkSweep(input: ClearanceFanInput): ClearanceFanResult {
  const warnings: string[] = [];
  if (input.sweptPoints.length === 0) warnings.push('No swept points; nothing to check.');
  const samples = Math.max(8, input.arcSamples ?? 64);
  const collisions: CollisionEvent[] = [];

  const startRad = input.startAngleDeg * Math.PI / 180;
  const endRad = input.endAngleDeg * Math.PI / 180;
  if (Math.abs(endRad - startRad) < 1e-9) warnings.push('Sweep range is zero.');

  let maxR = 0;
  for (const sp of input.sweptPoints) {
    const dx = sp.x - input.pivot.x;
    const dy = sp.y - input.pivot.y;
    const r = Math.hypot(dx, dy);
    maxR = Math.max(maxR, r);
    const baseAngle = Math.atan2(dy, dx);

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const rotation = startRad + (endRad - startRad) * t;
      const ang = baseAngle + rotation;
      const px = input.pivot.x + r * Math.cos(ang);
      const py = input.pivot.y + r * Math.sin(ang);

      for (const obs of input.obstacles) {
        if (pointInPolygon({ x: px, y: py }, obs.polygon)) {
          collisions.push({
            sweptPointId: sp.id ?? `pt(${sp.x},${sp.y})`,
            obstacleId: obs.id,
            angleDeg: rotation * 180 / Math.PI,
            position: { x: px, y: py },
          });
          break;
        }
      }
    }
  }

  const arcExtents = Math.abs(endRad - startRad) * maxR;
  const sorted = [...collisions].sort((a, b) => Math.abs(a.angleDeg) - Math.abs(b.angleDeg));
  return {
    collisions,
    clear: collisions.length === 0,
    firstCollisionAngleDeg: sorted[0]?.angleDeg ?? null,
    arcExtentsMm: arcExtents,
    warnings,
  };
}

function pointInPolygon(p: { x: number; y: number }, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (((pi.y > p.y) !== (pj.y > p.y))
      && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-12) + pi.x)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Find the maximum safe sweep range before first collision. */
export function maxSafeAngleDeg(input: ClearanceFanInput): number {
  const r = checkSweep(input);
  if (r.clear) return Math.abs(input.endAngleDeg - input.startAngleDeg);
  // Return signed angle delta from start at which the first collision occurred.
  return Math.abs(r.firstCollisionAngleDeg ?? 0);
}

export function summarize(r: ClearanceFanResult): { clear: boolean; collisionCount: number; arcExtentsMm: number } {
  return { clear: r.clear, collisionCount: r.collisions.length, arcExtentsMm: r.arcExtentsMm };
}
