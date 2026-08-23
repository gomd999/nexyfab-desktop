import type { ArchitectureDocument, ArchitectureOpening, ArchitectureWall } from '@/lib/ai/architectureInteriorDocuments';
import type { InteriorSpatialPart } from './interiorSpatialModel';

export interface BuildingSpatialParameters {
  width: number;
  depth: number;
  storeyCount: number;
  storeyHeight: number;
  wallThickness: number;
  slabThickness: number;
  entranceWidth: number;
  windowWidth: number;
  windowCountPerStorey: number;
  windowHeight: number;
  windowSill: number;
}

const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function normalizeBuildingSpatialParameters(input: BuildingSpatialParameters): BuildingSpatialParameters {
  const width = clamp(finite(input.width, 12_000), 3000, 100_000);
  const depth = clamp(finite(input.depth, 8000), 3000, 100_000);
  const storeyHeight = clamp(finite(input.storeyHeight, 3200), 2200, 10_000);
  return {
    width,
    depth,
    storeyCount: Math.round(clamp(finite(input.storeyCount, 2), 1, 20)),
    storeyHeight,
    wallThickness: clamp(finite(input.wallThickness, 200), 80, Math.min(1000, width / 4, depth / 4)),
    slabThickness: clamp(finite(input.slabThickness, 200), 80, 2000),
    entranceWidth: clamp(finite(input.entranceWidth, 1200), 700, Math.max(700, width * 0.25)),
    windowWidth: clamp(finite(input.windowWidth, 1800), 300, Math.max(300, width * 0.3)),
    windowCountPerStorey: Math.round(clamp(finite(input.windowCountPerStorey, 1), 1, 12)),
    windowHeight: clamp(finite(input.windowHeight, 1400), 300, Math.max(300, storeyHeight - 300)),
    windowSill: clamp(finite(input.windowSill, 900), 0, Math.max(0, storeyHeight - 300)),
  };
}

export function buildBuildingArchitectureDocument(input: BuildingSpatialParameters): ArchitectureDocument {
  const p = normalizeBuildingSpatialParameters(input);
  const boundary: Array<[number, number]> = [[0, 0], [p.width, 0], [p.width, p.depth], [0, p.depth]];
  const storeys: ArchitectureDocument['storeys'] = [];
  const spaces: ArchitectureDocument['spaces'] = [];
  const walls: ArchitectureDocument['walls'] = [];
  const slabs: ArchitectureDocument['slabs'] = [];
  const ceilings: ArchitectureDocument['ceilings'] = [];
  const openings: ArchitectureDocument['openings'] = [];
  for (let index = 0; index < p.storeyCount; index += 1) {
    const suffix = `l${index + 1}`;
    const elevationMm = index * p.storeyHeight;
    const wallIds = ['front', 'right', 'back', 'left'].map(side => `wall-${side}-${suffix}`);
    storeys.push({ id: suffix, name: `Level ${index + 1}`, elevationMm, heightMm: p.storeyHeight });
    walls.push(
      { id: wallIds[0]!, kind: 'line', storeyId: suffix, startMm: [0, 0], endMm: [p.width, 0], thicknessMm: p.wallThickness, heightMm: p.storeyHeight },
      { id: wallIds[1]!, kind: 'line', storeyId: suffix, startMm: [p.width, 0], endMm: [p.width, p.depth], thicknessMm: p.wallThickness, heightMm: p.storeyHeight },
      { id: wallIds[2]!, kind: 'line', storeyId: suffix, startMm: [p.width, p.depth], endMm: [0, p.depth], thicknessMm: p.wallThickness, heightMm: p.storeyHeight },
      { id: wallIds[3]!, kind: 'line', storeyId: suffix, startMm: [0, p.depth], endMm: [0, 0], thicknessMm: p.wallThickness, heightMm: p.storeyHeight },
    );
    const spaceId = `space-${suffix}`;
    spaces.push({ id: spaceId, storeyId: suffix, name: `Open plan ${index + 1}`, usage: 'unassigned', boundaryMm: boundary.map(point => [...point]), wallIds, slabId: `slab-${suffix}`, ceilingId: `ceiling-${suffix}` });
    slabs.push({ id: `slab-${suffix}`, storeyId: suffix, spaceId, boundaryMm: boundary.map(point => [...point]), thicknessMm: p.slabThickness });
    ceilings.push({ id: `ceiling-${suffix}`, storeyId: suffix, spaceId, boundaryMm: boundary.map(point => [...point]), elevationMm: elevationMm + p.storeyHeight - 150 });
    if (index === 0) {
      const offsetMm = p.width * 0.22;
      openings.push({
        id: 'entrance-l1', kind: 'door', hostWallId: wallIds[0]!, offsetMm, widthMm: p.entranceWidth,
        heightMm: Math.min(2300, p.storeyHeight - 100), sillMm: 0, positionMm: [offsetMm, 0, elevationMm],
        connectsSpaceIds: [spaceId], isExit: true,
      });
    }
    const windowHeight = Math.min(p.windowHeight, p.storeyHeight - p.windowSill);
    for (let windowIndex = 0; windowIndex < p.windowCountPerStorey; windowIndex += 1) {
      const windowOffsetMm = p.width * (windowIndex + 1) / (p.windowCountPerStorey + 1);
      openings.push({
        id: `window-${suffix}-${windowIndex + 1}`, kind: 'window', hostWallId: wallIds[0]!, offsetMm: windowOffsetMm,
        widthMm: Math.min(p.windowWidth, p.width / (p.windowCountPerStorey + 1) * 0.72), heightMm: windowHeight, sillMm: p.windowSill,
        positionMm: [windowOffsetMm, 0, elevationMm + p.windowSill],
      });
    }
  }
  return {
    schema: 'nexyfab.architecture.v1', revision: 0, storeys, spaces, walls, slabs, ceilings, openings,
    projectNorthDeg: 0,
    grids: [
      { id: 'grid-x-1', name: 'A', axis: 'x', startMm: [0, 0], endMm: [0, p.depth] },
      { id: 'grid-x-2', name: 'B', axis: 'x', startMm: [p.width, 0], endMm: [p.width, p.depth] },
      { id: 'grid-y-1', name: '1', axis: 'y', startMm: [0, 0], endMm: [p.width, 0] },
      { id: 'grid-y-2', name: '2', axis: 'y', startMm: [0, p.depth], endMm: [p.width, p.depth] },
    ],
  };
}

function boxPart(id: string, role: string, width: number, depth: number, height: number, tx: number, ty: number, tz: number, rz = 0): InteriorSpatialPart {
  return { id, type: 'box', role, material: `${role}-preview`, params: { width, depth, height }, at: { tx, ty, tz, rz }, aabb: { min: [0, 0, 0], max: [width, depth, height] } };
}

function openingPieces(wall: Extract<ArchitectureWall, { kind: 'line' }>, openings: ArchitectureOpening[], elevation: number): InteriorSpatialPart[] {
  const horizontal = wall.startMm[1] === wall.endMm[1];
  const length = Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]);
  const sorted = openings.slice().sort((a, b) => a.offsetMm - b.offsetMm);
  const parts: InteriorSpatialPart[] = [];
  let cursor = 0;
  const place = (id: string, along: number, segmentLength: number, bottom: number, height: number) => {
    if (!(segmentLength > 0) || !(height > 0)) return;
    const reversed = horizontal ? wall.endMm[0] < wall.startMm[0] : wall.endMm[1] < wall.startMm[1];
    const position = reversed ? length - along - segmentLength : along;
    const tx = horizontal ? Math.min(wall.startMm[0], wall.endMm[0]) + position : wall.startMm[0];
    const ty = horizontal ? wall.startMm[1] - (wall.startMm[1] === 0 ? wall.thicknessMm : 0) : Math.min(wall.startMm[1], wall.endMm[1]) + position;
    parts.push(boxPart(id, 'wall', segmentLength, wall.thicknessMm, height, tx, ty, elevation + bottom, horizontal ? 0 : 90));
  };
  sorted.forEach((opening, index) => {
    const start = Math.max(0, opening.offsetMm - opening.widthMm / 2);
    const end = Math.min(length, opening.offsetMm + opening.widthMm / 2);
    place(`${wall.id}-solid-${index}`, cursor, start - cursor, 0, wall.heightMm);
    place(`${wall.id}-sill-${index}`, start, end - start, 0, opening.sillMm);
    place(`${wall.id}-head-${index}`, start, end - start, opening.sillMm + opening.heightMm, wall.heightMm - opening.sillMm - opening.heightMm);
    cursor = Math.max(cursor, end);
  });
  place(`${wall.id}-solid-end`, cursor, length - cursor, 0, wall.heightMm);
  return parts;
}

export function buildingViewerParts(document: ArchitectureDocument): InteriorSpatialPart[] {
  const storeys = new Map(document.storeys.map(storey => [storey.id, storey]));
  const parts: InteriorSpatialPart[] = document.slabs.map(slab => {
    const storey = storeys.get(slab.storeyId)!;
    const xs = slab.boundaryMm.map(point => point[0]);
    const ys = slab.boundaryMm.map(point => point[1]);
    return boxPart(slab.id, 'slab', Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), slab.thicknessMm, Math.min(...xs), Math.min(...ys), storey.elevationMm - slab.thicknessMm);
  });
  document.walls.forEach(wall => {
    if (wall.kind !== 'line') return;
    const storey = storeys.get(wall.storeyId)!;
    const openings = document.openings.filter(opening => opening.hostWallId === wall.id);
    if (openings.length) parts.push(...openingPieces(wall, openings, storey.elevationMm));
    else parts.push(...openingPieces(wall, [], storey.elevationMm));
  });
  return parts;
}
