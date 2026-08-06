export interface Point2 { x: number; y: number }
export interface DoorSwingClearanceInput {
  pivot: Point2;
  closedAngleDeg: number;
  openAngleDeg: number;
  widthMm: number;
  thicknessMm: number;
  obstacles: Array<{ id: string; polygon: Point2[] }>;
  requiredClearanceMm?: number;
}
export interface DoorSwingClearanceResult {
  clear: boolean;
  minimumEnvelopeDistanceMm: number;
  requiredEnvelopeDistanceMm: number;
  collidingObstacleIds: string[];
  method: 'continuous_sector_capsule';
  conservative: true;
}

const rad = (degrees: number) => degrees * Math.PI / 180;
const pointAt = (origin: Point2, length: number, angle: number): Point2 => ({ x: origin.x + length * Math.cos(angle), y: origin.y + length * Math.sin(angle) });
const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

function progress(angle: number, start: number, delta: number): number {
  const tau = 2 * Math.PI; const direction = delta >= 0 ? 1 : -1;
  let value = direction * (angle - start); value %= tau; if (value < 0) value += tau;
  return value;
}
const onSweep = (angle: number, start: number, delta: number) => Math.abs(delta) >= 2 * Math.PI - 1e-10 || progress(angle, start, delta) <= Math.abs(delta) + 1e-10;

function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
const orient = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-10 && pointSegmentDistance(c, a, b) < 1e-10) || (Math.abs(abD) < 1e-10 && pointSegmentDistance(d, a, b) < 1e-10)
    || (Math.abs(cdA) < 1e-10 && pointSegmentDistance(a, c, d) < 1e-10) || (Math.abs(cdB) < 1e-10 && pointSegmentDistance(b, c, d) < 1e-10);
}
const segmentDistance = (a: Point2, b: Point2, c: Point2, d: Point2) => segmentsIntersect(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointToSector(point: Point2, pivot: Point2, radius: number, start: number, delta: number): number {
  const dx = point.x - pivot.x, dy = point.y - pivot.y, r = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  if (onSweep(angle, start, delta)) return Math.max(0, r - radius);
  return Math.min(pointSegmentDistance(point, pivot, pointAt(pivot, radius, start)), pointSegmentDistance(point, pivot, pointAt(pivot, radius, start + delta)));
}

function pointToArc(point: Point2, pivot: Point2, radius: number, start: number, delta: number): number {
  const angle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
  if (onSweep(angle, start, delta)) return Math.abs(distance(point, pivot) - radius);
  return Math.min(distance(point, pointAt(pivot, radius, start)), distance(point, pointAt(pivot, radius, start + delta)));
}

function edgeToArc(a: Point2, b: Point2, pivot: Point2, radius: number, start: number, delta: number): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((pivot.x - a.x) * dx + (pivot.y - a.y) * dy) / length2)) : 0;
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  let best = Math.min(pointToArc(a, pivot, radius, start, delta), pointToArc(b, pivot, radius, start, delta));
  if (onSweep(Math.atan2(closest.y - pivot.y, closest.x - pivot.x), start, delta)) best = Math.min(best, Math.abs(distance(closest, pivot) - radius));
  best = Math.min(best, pointSegmentDistance(pointAt(pivot, radius, start), a, b), pointSegmentDistance(pointAt(pivot, radius, start + delta), a, b));
  return best;
}

function polygonToSector(polygon: readonly Point2[], pivot: Point2, radius: number, start: number, delta: number): number {
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(pivot, polygon) || polygon.some(point => pointToSector(point, pivot, radius, start, delta) <= 1e-10)) return 0;
  const startEnd = pointAt(pivot, radius, start), finishEnd = pointAt(pivot, radius, start + delta); let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    best = Math.min(best, pointToSector(a, pivot, radius, start, delta), edgeToArc(a, b, pivot, radius, start, delta), segmentDistance(a, b, pivot, startEnd), segmentDistance(a, b, pivot, finishEnd));
  }
  return best;
}

/** Continuous 2D envelope check for a finite-thickness hinged leaf. */
export function verifyDoorSwingClearance(input: DoorSwingClearanceInput): DoorSwingClearanceResult {
  if (!(input.widthMm > 0) || !(input.thicknessMm > 0)) throw new Error('Door width and thickness must be positive.');
  const start = rad(input.closedAngleDeg), delta = rad(input.openAngleDeg - input.closedAngleDeg);
  const required = input.thicknessMm / 2 + Math.max(0, input.requiredClearanceMm ?? 0);
  const distances = input.obstacles.map(obstacle => ({ id: obstacle.id, distance: polygonToSector(obstacle.polygon, input.pivot, input.widthMm, start, delta) }));
  const colliding = distances.filter(item => item.distance <= required + 1e-9).map(item => item.id);
  return { clear: colliding.length === 0, minimumEnvelopeDistanceMm: distances.length ? Math.min(...distances.map(item => item.distance)) : Number.POSITIVE_INFINITY, requiredEnvelopeDistanceMm: required, collidingObstacleIds: colliding, method: 'continuous_sector_capsule', conservative: true };
}
