export interface MepPoint3 { x: number; y: number; z: number }
export interface MepRun { id: string; system: string; centerline: MepPoint3[]; outerDiameterMm: number; requiredClearanceMm?: number }
export interface MepObstacle { id: string; min: MepPoint3; max: MepPoint3; penetrable?: boolean }
export interface MepInterferenceInput { runs: MepRun[]; obstacles: MepObstacle[]; defaultClearanceMm?: number }
export interface MepCollision { aId: string; bId: string; kind: 'run-run' | 'run-obstacle'; minimumSurfaceDistanceMm: number; requiredClearanceMm: number }
export interface MepInterferenceResult {
  clear: boolean;
  collisions: MepCollision[];
  missingGeometryIds: string[];
  checkedRunSegments: number;
  method: 'continuous_capsule_distance';
  conservative: true;
}

const sub = (a: MepPoint3, b: MepPoint3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const addScaled = (a: MepPoint3, b: MepPoint3, t: number) => ({ x: a.x + b.x * t, y: a.y + b.y * t, z: a.z + b.z * t });
const dot = (a: MepPoint3, b: MepPoint3) => a.x * b.x + a.y * b.y + a.z * b.z;
const distance = (a: MepPoint3, b: MepPoint3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finitePoint = (point: MepPoint3) => [point.x, point.y, point.z].every(Number.isFinite);

function segmentSegmentDistance(p1: MepPoint3, q1: MepPoint3, p2: MepPoint3, q2: MepPoint3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), epsilon = 1e-12;
  let s = 0, t = 0;
  if (a <= epsilon && e <= epsilon) return distance(p1, p2);
  if (a <= epsilon) t = Math.max(0, Math.min(1, dot(d2, r) / e));
  else {
    const c = dot(d1, r);
    if (e <= epsilon) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = dot(d1, d2), denominator = a * e - b * b;
      if (Math.abs(denominator) > epsilon) s = Math.max(0, Math.min(1, (b * dot(d2, r) - c * e) / denominator));
      t = (b * s + dot(d2, r)) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return distance(addScaled(p1, d1, s), addScaled(p2, d2, t));
}

const pointBoxDistanceSquared = (p: MepPoint3, box: MepObstacle) => {
  const axis = (value: number, min: number, max: number) => value < min ? min - value : value > max ? value - max : 0;
  const dx = axis(p.x, box.min.x, box.max.x), dy = axis(p.y, box.min.y, box.max.y), dz = axis(p.z, box.min.z, box.max.z);
  return dx * dx + dy * dy + dz * dz;
};
/** Distance-to-box along a line segment is convex; ternary convergence is deterministic and rounded down for fail-closed comparison. */
function segmentBoxDistance(a: MepPoint3, b: MepPoint3, box: MepObstacle): number {
  const direction = sub(b, a); let low = 0, high = 1;
  for (let i = 0; i < 80; i++) { const t1 = (2 * low + high) / 3, t2 = (low + 2 * high) / 3; if (pointBoxDistanceSquared(addScaled(a, direction, t1), box) <= pointBoxDistanceSquared(addScaled(a, direction, t2), box)) high = t2; else low = t1; }
  return Math.max(0, Math.sqrt(pointBoxDistanceSquared(addScaled(a, direction, (low + high) / 2), box)) - 1e-7);
}

/** Continuous centerline-segment clearance for circular MEP runs. Missing shapes remain release-blocking evidence. */
export function verifyMepInterference(input: MepInterferenceInput): MepInterferenceResult {
  const fallbackClearance = input.defaultClearanceMm ?? 0;
  if (!(fallbackClearance >= 0) || !Number.isFinite(fallbackClearance)) throw new Error('Default clearance must be finite and non-negative.');
  const missing = new Set<string>(), collisions: MepCollision[] = [], validRuns: MepRun[] = [];
  for (const run of input.runs) {
    if (run.centerline.length < 2 || !run.centerline.every(finitePoint) || !(run.outerDiameterMm > 0) || !Number.isFinite(run.outerDiameterMm)
      || (run.requiredClearanceMm !== undefined && (!(run.requiredClearanceMm >= 0) || !Number.isFinite(run.requiredClearanceMm)))) missing.add(run.id); else validRuns.push(run);
  }
  const validObstacles = input.obstacles.filter(obstacle => {
    const valid = finitePoint(obstacle.min) && finitePoint(obstacle.max) && obstacle.min.x <= obstacle.max.x && obstacle.min.y <= obstacle.max.y && obstacle.min.z <= obstacle.max.z;
    if (!valid) missing.add(obstacle.id); return valid;
  });
  const segments = validRuns.flatMap(run => run.centerline.slice(0, -1).map((start, index) => ({ run, start, end: run.centerline[index + 1]! })));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!, b = segments[j]!; if (a.run.id === b.run.id) continue;
    const required = Math.max(a.run.requiredClearanceMm ?? fallbackClearance, b.run.requiredClearanceMm ?? fallbackClearance);
    const surfaceDistance = segmentSegmentDistance(a.start, a.end, b.start, b.end) - (a.run.outerDiameterMm + b.run.outerDiameterMm) / 2;
    if (surfaceDistance <= required + 1e-7 && !collisions.some(item => item.kind === 'run-run' && ((item.aId === a.run.id && item.bId === b.run.id) || (item.aId === b.run.id && item.bId === a.run.id)))) collisions.push({ aId: a.run.id, bId: b.run.id, kind: 'run-run', minimumSurfaceDistanceMm: surfaceDistance, requiredClearanceMm: required });
  }
  for (const segment of segments) for (const obstacle of validObstacles) {
    if (obstacle.penetrable) continue; const required = segment.run.requiredClearanceMm ?? fallbackClearance;
    const surfaceDistance = segmentBoxDistance(segment.start, segment.end, obstacle) - segment.run.outerDiameterMm / 2;
    const existing = collisions.find(item => item.kind === 'run-obstacle' && item.aId === segment.run.id && item.bId === obstacle.id);
    if (surfaceDistance <= required + 1e-7 && !existing) collisions.push({ aId: segment.run.id, bId: obstacle.id, kind: 'run-obstacle', minimumSurfaceDistanceMm: surfaceDistance, requiredClearanceMm: required });
  }
  return { clear: collisions.length === 0 && missing.size === 0, collisions, missingGeometryIds: [...missing], checkedRunSegments: segments.length, method: 'continuous_capsule_distance', conservative: true };
}
