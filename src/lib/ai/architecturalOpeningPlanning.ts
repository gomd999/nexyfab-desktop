import type { ArchitectureDocument, ArchitectureOpening, ArchitectureWall } from './architectureInteriorDocuments';
import type { EgressRouteInput } from '@/lib/assembly/egressRouteVerification';

const wallLength = (wall: ArchitectureWall) => wall.kind === 'line' ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) : Math.abs(wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180 * wall.radiusMm;
function wallPoint(wall: ArchitectureWall, offsetMm: number): [number, number] {
  if (wall.kind === 'line') { const length = wallLength(wall), ratio = offsetMm / length; return [wall.startMm[0] + (wall.endMm[0] - wall.startMm[0]) * ratio, wall.startMm[1] + (wall.endMm[1] - wall.startMm[1]) * ratio]; }
  const direction = Math.sign(wall.endAngleDeg - wall.startAngleDeg), angle = (wall.startAngleDeg + direction * offsetMm / wall.radiusMm * 180 / Math.PI) * Math.PI / 180;
  return [wall.centerMm[0] + wall.radiusMm * Math.cos(angle), wall.centerMm[1] + wall.radiusMm * Math.sin(angle)];
}

export interface RepeatedOpeningRequest { wallId: string; idPrefix: string; kind: 'window' | 'door'; count: number; widthMm: number; heightMm: number; sillMm: number; startMarginMm: number; endMarginMm: number; minimumGapMm: number }
export function planRepeatedOpenings(document: ArchitectureDocument, request: RepeatedOpeningRequest): ArchitectureOpening[] {
  const wall = document.walls.find(item => item.id === request.wallId); if (!wall) throw new Error(`Unknown wall ${request.wallId}.`);
  if (!Number.isSafeInteger(request.count) || request.count < 1 || ![request.widthMm, request.heightMm, request.startMarginMm, request.endMarginMm, request.minimumGapMm].every(value => Number.isFinite(value) && value >= 0) || request.widthMm <= 0 || request.heightMm <= 0 || request.sillMm < 0) throw new Error('Repeated opening dimensions and count are invalid.');
  const available = wallLength(wall) - request.startMarginMm - request.endMarginMm, required = request.count * request.widthMm + Math.max(0, request.count - 1) * request.minimumGapMm;
  if (required > available + 1e-9) throw new Error(`Requested openings require ${required}mm but only ${available}mm is available.`);
  if (request.sillMm + request.heightMm > wall.heightMm) throw new Error('Repeated openings exceed host wall height.');
  const gap = request.count === 1 ? 0 : (available - request.count * request.widthMm) / (request.count - 1);
  return Array.from({ length: request.count }, (_, index) => {
    const offsetMm = request.startMarginMm + request.widthMm / 2 + index * (request.widthMm + gap), point = wallPoint(wall, offsetMm);
    return { id: `${request.idPrefix}-${index + 1}`, kind: request.kind, hostWallId: wall.id, offsetMm, widthMm: request.widthMm, heightMm: request.heightMm, sillMm: request.sillMm, positionMm: [point[0], point[1], request.sillMm] };
  });
}

export interface ArchitectureEgressRules { maximumTravelDistanceMm: number; minimumClearWidthMm: number; minimumIndependentExits?: number }
/** Build a governed graph only from explicit door-to-space relations; adjacency is never inferred from proximity. */
export function buildArchitectureEgressInput(document: ArchitectureDocument, originSpaceIds: string[], rules: ArchitectureEgressRules): EgressRouteInput {
  const spaces = new Map(document.spaces.map(space => [space.id, space]));
  const centroid = (boundary: [number, number][]) => ({ x: boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length, y: boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length });
  const nodes: EgressRouteInput['nodes'] = document.spaces.map(space => ({ id: `space:${space.id}`, point: centroid(space.boundaryMm), kind: 'junction' }));
  const edges: EgressRouteInput['edges'] = [], exitNodeIds: string[] = [];
  for (const door of document.openings.filter(item => item.kind === 'door')) {
    const connected = door.connectsSpaceIds ?? [];
    if (connected.length < 1 || connected.length > 2 || connected.some(id => !spaces.has(id))) throw new Error(`${door.id}: door requires one or two explicit valid space connections.`);
    if (connected.length === 2) edges.push({ id: `door:${door.id}`, from: `space:${connected[0]}`, to: `space:${connected[1]}`, clearWidthMm: door.widthMm });
    if (door.isExit) {
      const exitId = `exit:${door.id}`; nodes.push({ id: exitId, point: { x: door.positionMm[0], y: door.positionMm[1] }, kind: 'exit' }); exitNodeIds.push(exitId);
      edges.push({ id: `exit-edge:${door.id}`, from: `space:${connected[0]}`, to: exitId, clearWidthMm: door.widthMm });
    }
  }
  const unknownOrigins = originSpaceIds.filter(id => !spaces.has(id)); if (unknownOrigins.length) throw new Error(`Unknown origin spaces: ${unknownOrigins.join(', ')}.`);
  if (!exitNodeIds.length) throw new Error('At least one explicitly marked exit door is required.');
  return { nodes, edges, originNodeIds: originSpaceIds.map(id => `space:${id}`), exitNodeIds, maximumTravelDistanceMm: rules.maximumTravelDistanceMm, minimumClearWidthMm: rules.minimumClearWidthMm, minimumIndependentExits: rules.minimumIndependentExits };
}
