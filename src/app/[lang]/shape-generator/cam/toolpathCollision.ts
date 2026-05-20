/**
 * toolpathCollision.ts — Fixture + tool collision detection.
 *
 * Stage 1 `toolpathSafety.ts` covers the work envelope (does the
 * toolpath stay within the machine's reachable cube). Stage 2 adds
 * *fixture* collision: does the tool (or holder, or spindle) crash
 * into the vise, fixtures, or workpiece outside the intended cut
 * region?
 *
 * Approach:
 *   1. Tool is modelled as a swept capsule (cylindrical shank with
 *      hemispherical tip for ball-nose, flat disk for endmill).
 *   2. Fixture is a set of axis-aligned bounding boxes (vise jaws,
 *      parallels, clamp arms, modular fixture columns).
 *   3. At each toolpath sample, test capsule-vs-AABB intersection.
 *   4. Tool holder (above the cutting length) checked separately —
 *      hits the same fixtures but with a larger radius.
 *
 * Reports per-sample collision with the offending fixture id so the
 * UI can highlight where the toolpath grazes a clamp.
 */

export interface CapsuleTool {
  /** Tool tip diameter (mm). */
  tipDiameterMm: number;
  /** Shank diameter (mm). */
  shankDiameterMm: number;
  /** Cutting length (from tip up to where the flutes end) (mm). */
  fluteLengthMm: number;
  /** Holder OD (mm) — typically much larger than shank. */
  holderDiameterMm: number;
  /** Holder length (mm). */
  holderLengthMm: number;
  /** Tool tip semantic — sphere (ball-nose) or flat (endmill). */
  tipType: 'flat' | 'ball';
}

export interface AABB {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Display label (for the UI). */
  label?: string;
}

export interface ToolpathSample {
  position: [number, number, number];
  /** Tool axis direction (typically [0, 0, 1] for 3-axis). */
  axis: [number, number, number];
}

export interface CollisionEvent {
  sampleIndex: number;
  fixtureId: string;
  fixtureLabel?: string;
  /** Which region of the tool hit — tip, flutes, shank, or holder. */
  toolRegion: 'tip' | 'flutes' | 'shank' | 'holder';
  /** Penetration depth (mm). */
  depthMm: number;
}

/** Test sphere center vs AABB; returns penetration (mm) — positive = collision. */
function sphereAabbPenetration(
  center: [number, number, number],
  radius: number,
  box: AABB,
): number {
  let dx = 0, dy = 0, dz = 0;
  if (center[0] < box.min[0]) dx = box.min[0] - center[0];
  else if (center[0] > box.max[0]) dx = center[0] - box.max[0];
  if (center[1] < box.min[1]) dy = box.min[1] - center[1];
  else if (center[1] > box.max[1]) dy = center[1] - box.max[1];
  if (center[2] < box.min[2]) dz = box.min[2] - center[2];
  else if (center[2] > box.max[2]) dz = center[2] - box.max[2];
  const dist = Math.hypot(dx, dy, dz);
  return radius - dist;
}

/** Test a tool capsule at the given sample against every fixture.
 *  Capsule = cylinder of radius R from (tip - axis·height) to tip.
 *  We sample the capsule along its axis and run sphere-AABB at each step. */
function capsuleAabbHit(
  sample: ToolpathSample,
  startOffset: number, // distance from tip along +axis (toward holder)
  length: number,
  radius: number,
  fixtures: AABB[],
  region: CollisionEvent['toolRegion'],
  sampleIndex: number,
  out: CollisionEvent[],
): void {
  // Build the list of test points along the capsule axis. Treat
  // length=0 as a single point (tip).
  const samplePoints: Array<[number, number, number]> = [];
  if (length === 0) {
    samplePoints.push([
      sample.position[0] + sample.axis[0] * startOffset,
      sample.position[1] + sample.axis[1] * startOffset,
      sample.position[2] + sample.axis[2] * startOffset,
    ]);
  } else {
    const stepLen = Math.max(1, Math.min(length / 4, 5)); // 5mm slices
    const steps = Math.max(1, Math.ceil(length / stepLen));
    for (let k = 0; k <= steps; k++) {
      const d = startOffset + (k / steps) * length;
      samplePoints.push([
        sample.position[0] + sample.axis[0] * d,
        sample.position[1] + sample.axis[1] * d,
        sample.position[2] + sample.axis[2] * d,
      ]);
    }
  }

  for (const center of samplePoints) {
    for (const f of fixtures) {
      const pen = sphereAabbPenetration(center, radius, f);
      if (pen > 0) {
        out.push({
          sampleIndex,
          fixtureId: f.id,
          fixtureLabel: f.label,
          toolRegion: region,
          depthMm: pen,
        });
        break; // one collision per (sample-slice, region) is enough
      }
    }
  }
}

export interface CollisionScanResult {
  events: CollisionEvent[];
  collidingSamples: number;
  maxDepthMm: number;
  /** Map of fixture id → count of sample collisions. */
  perFixture: Record<string, number>;
}

/** Sweep every toolpath sample, return all collision events. */
export function scanToolpathCollision(
  toolpath: ToolpathSample[],
  tool: CapsuleTool,
  fixtures: AABB[],
): CollisionScanResult {
  const events: CollisionEvent[] = [];
  const collidingSet = new Set<number>();
  let maxDepth = 0;
  for (let i = 0; i < toolpath.length; i++) {
    const s = toolpath[i]!;
    // Tip
    capsuleAabbHit(s, 0, 0, tool.tipDiameterMm / 2, fixtures, 'tip', i, events);
    // Flutes — from tip to fluteLength up along -axis.
    capsuleAabbHit(s, 0, tool.fluteLengthMm, tool.tipDiameterMm / 2, fixtures, 'flutes', i, events);
    // Shank — above flutes.
    capsuleAabbHit(s, tool.fluteLengthMm, 30, tool.shankDiameterMm / 2, fixtures, 'shank', i, events);
    // Holder — above shank.
    capsuleAabbHit(s, tool.fluteLengthMm + 30, tool.holderLengthMm, tool.holderDiameterMm / 2, fixtures, 'holder', i, events);
  }
  const perFixture: Record<string, number> = {};
  for (const e of events) {
    collidingSet.add(e.sampleIndex);
    if (e.depthMm > maxDepth) maxDepth = e.depthMm;
    perFixture[e.fixtureId] = (perFixture[e.fixtureId] ?? 0) + 1;
  }
  return {
    events,
    collidingSamples: collidingSet.size,
    maxDepthMm: maxDepth,
    perFixture,
  };
}

/** Compute the required retract Z (in machine coords) — the lowest
 *  Z at which the tool can travel rapidly without hitting any fixture
 *  from above. Searches downward from a high safe plane. */
export function computeRetractZ(
  fixtures: AABB[],
  toolHolderRadiusMm: number,
  safetyMm: number = 5,
): number {
  let highestObstacleZ = -Infinity;
  for (const f of fixtures) {
    if (f.max[2] > highestObstacleZ) highestObstacleZ = f.max[2];
  }
  if (highestObstacleZ === -Infinity) return safetyMm;
  return highestObstacleZ + safetyMm + toolHolderRadiusMm;
}

/** Build a "clearance plane" for rapid moves between cuts. */
export interface ClearancePlanes {
  /** Safe Z for plunge into a hole / cut entry. */
  feedClearanceZ: number;
  /** Rapid travel Z — above all fixtures. */
  rapidClearanceZ: number;
}

export function clearancePlanes(
  toolpath: ToolpathSample[],
  fixtures: AABB[],
  tool: CapsuleTool,
): ClearancePlanes {
  // Highest cut Z + 2mm.
  let highestPathZ = -Infinity;
  for (const s of toolpath) {
    if (s.position[2] > highestPathZ) highestPathZ = s.position[2];
  }
  return {
    feedClearanceZ: highestPathZ + 2,
    rapidClearanceZ: computeRetractZ(fixtures, tool.holderDiameterMm / 2),
  };
}
