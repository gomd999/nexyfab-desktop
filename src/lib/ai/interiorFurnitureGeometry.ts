import type { ArchitectureDocument, InteriorDocument, InteriorFurniture } from './architectureInteriorDocuments';
type V2 = [number, number];

export function furnitureClearancePolygon(item: InteriorFurniture): V2[] {
  const halfX = item.sizeMm[0] / 2 + item.clearanceMm, halfY = item.sizeMm[1] / 2 + item.clearanceMm, angle = (item.rotationDeg ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]].map(([x, y]) => [item.positionMm[0] + x * cos - y * sin, item.positionMm[1] + x * sin + y * cos]);
}
function pointInPolygon(point: V2, polygon: readonly V2[]): boolean { let inside = false; for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) { const a = polygon[index]!, b = polygon[previous]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
const axes = (polygon: readonly V2[]) => polygon.map((point, index) => { const next = polygon[(index + 1) % polygon.length]!, dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy); return [-dy / length, dx / length] as V2; });
function polygonsOverlap(a: readonly V2[], b: readonly V2[]): boolean { return [...axes(a), ...axes(b)].every(axis => { const pa = a.map(point => point[0] * axis[0] + point[1] * axis[1]), pb = b.map(point => point[0] * axis[0] + point[1] * axis[1]); return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa); }); }

export interface ExactFurnitureClearanceResult { status: 'passed' | 'failed'; method: 'oriented_polygon_sat'; polygons: Record<string, V2[]>; failures: Array<{ furnitureId: string; reason: 'OUTSIDE_SPACE' | 'CLEARANCE_OVERLAP' | 'DOOR_SWING_OVERLAP'; otherId?: string }> }
export function verifyExactFurnitureClearance(architecture: ArchitectureDocument, interior: InteriorDocument, spaceId: string, doorSwingCollisionIds: readonly string[] = []): ExactFurnitureClearanceResult {
  const space = architecture.spaces.find(item => item.id === spaceId); if (!space) throw new Error(`Unknown space ${spaceId}.`);
  const items = interior.furniture.filter(item => item.spaceId === spaceId), polygons = Object.fromEntries(items.map(item => [item.id, furnitureClearancePolygon(item)])), failures: ExactFurnitureClearanceResult['failures'] = [];
  for (const item of items) { if (polygons[item.id]!.some(point => !pointInPolygon(point, space.boundaryMm))) failures.push({ furnitureId: item.id, reason: 'OUTSIDE_SPACE' }); if (doorSwingCollisionIds.includes(item.id)) failures.push({ furnitureId: item.id, reason: 'DOOR_SWING_OVERLAP' }); }
  for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) if (polygonsOverlap(polygons[items[left]!.id]!, polygons[items[right]!.id]!)) failures.push({ furnitureId: items[left]!.id, otherId: items[right]!.id, reason: 'CLEARANCE_OVERLAP' });
  return { status: failures.length ? 'failed' : 'passed', method: 'oriented_polygon_sat', polygons, failures };
}
