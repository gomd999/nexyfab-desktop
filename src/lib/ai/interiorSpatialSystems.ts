import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import type { DoorSwingClearanceInput } from '@/lib/assembly/doorSwingClearance';

type V2 = [number, number];
interface Rect { id: string; minX: number; minY: number; maxX: number; maxY: number }
const distance = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function pointInPolygon(point: V2, polygon: readonly V2[]): boolean { let inside = false; for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) { const a = polygon[index]!, b = polygon[previous]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
const insideRect = (point: V2, rect: Rect) => point[0] > rect.minX && point[0] < rect.maxX && point[1] > rect.minY && point[1] < rect.maxY;
function segmentClear(a: V2, b: V2, room: readonly V2[], obstacles: readonly Rect[]): boolean {
  for (let step = 0; step <= 64; step++) { const t = step / 64, point: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (!pointInPolygon(point, room) && step !== 0 && step !== 64) return false; if (obstacles.some(rect => insideRect(point, rect))) return false; }
  return true;
}
function furnitureRects(interior: InteriorDocument, spaceId: string): Rect[] { return interior.furniture.filter(item => item.spaceId === spaceId).map(item => ({ id: item.id, minX: item.positionMm[0] - item.sizeMm[0] / 2 - item.clearanceMm, maxX: item.positionMm[0] + item.sizeMm[0] / 2 + item.clearanceMm, minY: item.positionMm[1] - item.sizeMm[1] / 2 - item.clearanceMm, maxY: item.positionMm[1] + item.sizeMm[1] / 2 + item.clearanceMm })); }

export interface InteriorRouteResult { status: 'passed' | 'failed' | 'not_run'; distanceMm?: number; pathMm: V2[]; reason?: string; method: 'conservative_visibility_graph_aabb' }
/** Conservative visibility graph around furniture footprints including declared use clearance. */
export function verifyInteriorRoute(architecture: ArchitectureDocument, interior: InteriorDocument, spaceId: string, originMm: V2, destinationMm: V2, maximumDistanceMm: number): InteriorRouteResult {
  const space = architecture.spaces.find(item => item.id === spaceId); if (!space) return { status: 'not_run', pathMm: [], reason: 'Space is missing.', method: 'conservative_visibility_graph_aabb' };
  if (!(maximumDistanceMm > 0) || ![...originMm, ...destinationMm, maximumDistanceMm].every(Number.isFinite)) throw new Error('Route inputs must be finite and maximum distance positive.');
  if (!pointInPolygon(originMm, space.boundaryMm) || !pointInPolygon(destinationMm, space.boundaryMm)) return { status: 'failed', pathMm: [], reason: 'Origin or destination is outside the room.', method: 'conservative_visibility_graph_aabb' };
  const obstacles = furnitureRects(interior, spaceId), epsilon = 0.01;
  const nodes: V2[] = [originMm, destinationMm, ...obstacles.flatMap(rect => [[rect.minX - epsilon, rect.minY - epsilon] as V2, [rect.maxX + epsilon, rect.minY - epsilon] as V2, [rect.maxX + epsilon, rect.maxY + epsilon] as V2, [rect.minX - epsilon, rect.maxY + epsilon] as V2]).filter(point => pointInPolygon(point, space.boundaryMm))];
  const costs = new Array(nodes.length).fill(Number.POSITIVE_INFINITY) as number[], previous = new Array(nodes.length).fill(-1) as number[], pending = new Set(nodes.map((_, index) => index)); costs[0] = 0;
  while (pending.size) { let current = -1; pending.forEach(index => { if (current < 0 || costs[index]! < costs[current]!) current = index; }); if (current < 0 || !Number.isFinite(costs[current]!)) break; pending.delete(current); for (const neighbor of pending) if (segmentClear(nodes[current]!, nodes[neighbor]!, space.boundaryMm, obstacles)) { const candidate = costs[current]! + distance(nodes[current]!, nodes[neighbor]!); if (candidate < costs[neighbor]!) { costs[neighbor] = candidate; previous[neighbor] = current; } } }
  if (!Number.isFinite(costs[1]!)) return { status: 'failed', pathMm: [], reason: 'No clearance-respecting path exists.', method: 'conservative_visibility_graph_aabb' };
  const path: V2[] = []; for (let cursor = 1; cursor >= 0; cursor = previous[cursor]!) { path.unshift(nodes[cursor]!); if (cursor === 0) break; }
  return { status: costs[1]! <= maximumDistanceMm ? 'passed' : 'failed', distanceMm: costs[1], pathMm: path, ...(costs[1]! > maximumDistanceMm ? { reason: 'Route exceeds governed maximum distance.' } : {}), method: 'conservative_visibility_graph_aabb' };
}

export interface FurnitureClearanceResult { status: 'passed' | 'failed'; failures: Array<{ furnitureId: string; reason: 'OUTSIDE_SPACE' | 'CLEARANCE_OVERLAP' | 'DOOR_SWING_OVERLAP'; otherId?: string }> }
export function verifyFurnitureClearance(architecture: ArchitectureDocument, interior: InteriorDocument, spaceId: string, doorSwingCollisionIds: readonly string[] = []): FurnitureClearanceResult {
  const space = architecture.spaces.find(item => item.id === spaceId); if (!space) throw new Error(`Unknown space ${spaceId}.`);
  const rects = furnitureRects(interior, spaceId), failures: FurnitureClearanceResult['failures'] = [];
  for (const rect of rects) { const corners: V2[] = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]]; if (corners.some(point => !pointInPolygon(point, space.boundaryMm))) failures.push({ furnitureId: rect.id, reason: 'OUTSIDE_SPACE' }); if (doorSwingCollisionIds.includes(rect.id)) failures.push({ furnitureId: rect.id, reason: 'DOOR_SWING_OVERLAP' }); }
  for (let left = 0; left < rects.length; left++) for (let right = left + 1; right < rects.length; right++) { const a = rects[left]!, b = rects[right]!; if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY) failures.push({ furnitureId: a.id, otherId: b.id, reason: 'CLEARANCE_OVERLAP' }); }
  return { status: failures.length ? 'failed' : 'passed', failures };
}

export function buildDoorSwingInput(architecture: ArchitectureDocument, doorId: string, obstacles: DoorSwingClearanceInput['obstacles']): DoorSwingClearanceInput | null {
  const door = architecture.openings.find(item => item.id === doorId && item.kind === 'door'); if (!door?.doorOperation) return null;
  return { pivot: { x: door.doorOperation.pivotMm[0], y: door.doorOperation.pivotMm[1] }, closedAngleDeg: door.doorOperation.closedAngleDeg, openAngleDeg: door.doorOperation.openAngleDeg, widthMm: door.widthMm, thicknessMm: door.doorOperation.leafThicknessMm, obstacles, requiredClearanceMm: door.doorOperation.requiredClearanceMm };
}

export interface LightingRule { targetAverageLux: number; minimumLux?: number; minimumUniformityMinToAverage?: number; calculationAreaMm2: number; coefficientOfUtilization: number; lightLossFactor: number; requirePhotometricEvidence: boolean }
export interface PhotometricCalculationEvidence { ran: boolean; averageLux: number; minimumLux?: number; iesProfileIds: string[] }
export interface LightingResult { status: 'passed' | 'failed' | 'not_run'; estimatedAverageLux?: number; measuredAverageLux?: number; calculationPoints: V2[]; reason?: string; method: 'governed_lumen_method_preview' | 'ies_calculation_evidence' }
export function verifyInteriorLighting(interior: InteriorDocument, spaceId: string, boundaryMm: V2[], rule?: LightingRule, gridSpacingMm = 1000, photometric?: PhotometricCalculationEvidence): LightingResult {
  if (!rule) return { status: 'not_run', calculationPoints: [], reason: 'Governed lighting rule is missing.', method: 'governed_lumen_method_preview' };
  if (![rule.targetAverageLux, rule.calculationAreaMm2, rule.coefficientOfUtilization, rule.lightLossFactor, gridSpacingMm].every(value => value > 0 && Number.isFinite(value))) throw new Error('Lighting rule values must be finite and positive.');
  const lights = interior.lights.filter(light => light.spaceId === spaceId), xs = boundaryMm.map(point => point[0]), ys = boundaryMm.map(point => point[1]), points: V2[] = [];
  for (let x = Math.min(...xs) + gridSpacingMm / 2; x < Math.max(...xs); x += gridSpacingMm) for (let y = Math.min(...ys) + gridSpacingMm / 2; y < Math.max(...ys); y += gridSpacingMm) if (pointInPolygon([x, y], boundaryMm)) points.push([x, y]);
  if (!lights.length || !points.length) return { status: 'not_run', calculationPoints: points, reason: 'Lights or calculation-plane points are missing.', method: 'governed_lumen_method_preview' };
  const estimatedAverageLux = lights.reduce((sum, light) => sum + light.lumens, 0) * rule.coefficientOfUtilization * rule.lightLossFactor / (rule.calculationAreaMm2 / 1_000_000);
  if (rule.requirePhotometricEvidence) {
    const requiredProfiles = lights.map(light => light.iesProfileId).filter((id): id is string => Boolean(id));
    if (requiredProfiles.length !== lights.length || !photometric?.ran || !Number.isFinite(photometric.averageLux) || requiredProfiles.some(id => !photometric.iesProfileIds.includes(id))) return { status: 'not_run', estimatedAverageLux, calculationPoints: points, reason: 'Executed IES photometric calculation evidence is required for release.', method: 'governed_lumen_method_preview' };
    const passed = photometric.averageLux >= rule.targetAverageLux && photometric.minimumLux !== undefined && photometric.minimumLux >= (rule.minimumLux ?? 0) && photometric.minimumLux / photometric.averageLux >= (rule.minimumUniformityMinToAverage ?? 0);
    return { status: passed ? 'passed' : 'failed', estimatedAverageLux, measuredAverageLux: photometric.averageLux, calculationPoints: points, method: 'ies_calculation_evidence' };
  }
  return { status: estimatedAverageLux >= rule.targetAverageLux ? 'passed' : 'failed', estimatedAverageLux, calculationPoints: points, method: 'governed_lumen_method_preview' };
}
