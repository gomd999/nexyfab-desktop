// Motion study + collision simulation.
// Steps a parametric motion driver (rotation / translation per part) over
// a time range, applies transforms to each part's bounding box, and runs
// pairwise interference detection. Returns collision events with timestamps.
//
// Uses AABB-only (no triangle-level intersection) for speed — the goal is
// quick "does anything obviously collide" feedback. A precise mesh-mesh
// check should run on demand for flagged time-steps.

export interface MotionPart {
  id: string;
  /** Initial bounding box, in world coordinates (mm). */
  aabb: { min: [number, number, number]; max: [number, number, number] };
  /** Optional motion driver — applied every frame. */
  motion?: MotionDriver;
}

export type MotionDriver =
  | { kind: 'rotate'; axis: 'x' | 'y' | 'z'; degPerSec: number; pivot?: [number, number, number] }
  | { kind: 'translate'; axis: 'x' | 'y' | 'z'; mmPerSec: number }
  | { kind: 'pendulum'; axis: 'x' | 'y' | 'z'; amplitudeDeg: number; periodSec: number; pivot?: [number, number, number] };

export interface MotionStudyOptions {
  durationSec: number;
  stepMs: number;
  /** Stop scanning after this many distinct collisions are found. */
  maxCollisions?: number;
}

export interface CollisionEvent {
  timeSec: number;
  partA: string;
  partB: string;
  overlapMm: number;
}

interface AABB { min: [number, number, number]; max: [number, number, number] }

function aabbCenter(b: AABB): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}
function aabbExtent(b: AABB): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

function rotateBoxAroundAxis(box: AABB, axis: 'x' | 'y' | 'z', radians: number, pivot: [number, number, number]): AABB {
  // Approximation: rotate the 8 corners of the AABB, re-fit a new axis-aligned box.
  const corners: [number, number, number][] = [
    [box.min[0], box.min[1], box.min[2]], [box.max[0], box.min[1], box.min[2]],
    [box.min[0], box.max[1], box.min[2]], [box.max[0], box.max[1], box.min[2]],
    [box.min[0], box.min[1], box.max[2]], [box.max[0], box.min[1], box.max[2]],
    [box.min[0], box.max[1], box.max[2]], [box.max[0], box.max[1], box.max[2]],
  ];
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const rot = corners.map(([x, y, z]) => {
    const dx = x - pivot[0], dy = y - pivot[1], dz = z - pivot[2];
    let nx = dx, ny = dy, nz = dz;
    if (axis === 'x') { ny = dy * cos - dz * sin; nz = dy * sin + dz * cos; }
    if (axis === 'y') { nx = dx * cos + dz * sin; nz = -dx * sin + dz * cos; }
    if (axis === 'z') { nx = dx * cos - dy * sin; ny = dx * sin + dy * cos; }
    return [nx + pivot[0], ny + pivot[1], nz + pivot[2]] as [number, number, number];
  });
  const xs = rot.map(c => c[0]), ys = rot.map(c => c[1]), zs = rot.map(c => c[2]);
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  };
}

function translateBox(box: AABB, axis: 'x' | 'y' | 'z', amount: number): AABB {
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const out: AABB = { min: [...box.min] as [number, number, number], max: [...box.max] as [number, number, number] };
  out.min[idx] += amount;
  out.max[idx] += amount;
  return out;
}

function applyDriver(box: AABB, driver: MotionDriver, tSec: number): AABB {
  if (driver.kind === 'rotate') {
    const rad = driver.degPerSec * (Math.PI / 180) * tSec;
    return rotateBoxAroundAxis(box, driver.axis, rad, driver.pivot ?? aabbCenter(box));
  }
  if (driver.kind === 'translate') {
    return translateBox(box, driver.axis, driver.mmPerSec * tSec);
  }
  // pendulum
  const phase = 2 * Math.PI * (tSec / driver.periodSec);
  const deg = Math.sin(phase) * driver.amplitudeDeg;
  return rotateBoxAroundAxis(box, driver.axis, deg * (Math.PI / 180), driver.pivot ?? aabbCenter(box));
}

function aabbOverlap(a: AABB, b: AABB): number {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
  return Math.min(dx, dy, dz); // smallest penetration depth
}

export function runMotionStudy(parts: MotionPart[], opts: MotionStudyOptions): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const stepSec = opts.stepMs / 1000;
  const totalSteps = Math.ceil(opts.durationSec / stepSec);
  const maxCollisions = opts.maxCollisions ?? 200;
  // Track currently-active overlapping pairs so we record only the first
  // contact per collision rather than every frame of penetration.
  const activePairs = new Set<string>();

  for (let step = 0; step <= totalSteps; step++) {
    const t = step * stepSec;
    const liveBoxes = parts.map(p => p.motion ? applyDriver(p.aabb, p.motion, t) : p.aabb);

    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const key = `${parts[i].id}|${parts[j].id}`;
        const overlap = aabbOverlap(liveBoxes[i], liveBoxes[j]);
        if (overlap > 0) {
          if (!activePairs.has(key)) {
            activePairs.add(key);
            events.push({ timeSec: t, partA: parts[i].id, partB: parts[j].id, overlapMm: overlap });
            if (events.length >= maxCollisions) return events;
          }
        } else {
          activePairs.delete(key);
        }
      }
    }
  }
  return events;
}

void aabbExtent;
