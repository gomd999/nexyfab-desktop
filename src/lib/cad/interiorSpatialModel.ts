import { INTERIOR_PLACEMENT_CATALOG } from './interiorPlacementDocument';

export type InteriorFurnitureKind = 'table2' | 'table4' | 'sofa';

export interface InteriorFurnitureItem {
  kind: InteriorFurnitureKind;
  x: number;
  y: number;
}

export interface InteriorSpatialParameters {
  width: number;
  depth: number;
  ceilingHeight: number;
  doorWidth: number;
  exitCount: number;
  rows: number;
  cols: number;
  furniture: InteriorFurnitureItem[] | null;
}

export interface InteriorSpatialPart {
  id: string;
  type: string;
  role: string;
  material: string;
  params: Record<string, unknown>;
  at: { tx: number; ty: number; tz: number; rz?: number };
  aabb: { min: [number, number, number]; max: [number, number, number] };
}

export interface InteriorSpatialAssembly {
  name: string;
  domain: 'interior';
  kind: 'spatial-layout';
  parts: InteriorSpatialPart[];
  roomBounds: { W: number; D: number };
  exits: Array<{ x: number; y: number; widthMm: number }>;
  furniture: Array<{ id: string; name: string; count: number; seats: number }>;
  floorAreaM2: number;
  customFurniture?: InteriorFurnitureItem[];
}

const CATALOG: Record<InteriorFurnitureKind, { w: number; d: number; seats: number }> = Object.fromEntries(
  Object.entries(INTERIOR_PLACEMENT_CATALOG).map(([kind, spec]) => [kind, { w: spec.dimensionsMm[0], d: spec.dimensionsMm[1], seats: spec.seats }]),
) as Record<InteriorFurnitureKind, { w: number; d: number; seats: number }>;

const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function normalizeInteriorSpatialParameters(input: InteriorSpatialParameters): InteriorSpatialParameters {
  const width = clamp(finite(input.width, 8000), 2000, 100_000);
  const depth = clamp(finite(input.depth, 6000), 2000, 100_000);
  return {
    width,
    depth,
    ceilingHeight: clamp(finite(input.ceilingHeight, 2700), 1800, 20_000),
    doorWidth: clamp(finite(input.doorWidth, 1000), 600, Math.max(600, width - 400)),
    exitCount: Math.round(clamp(finite(input.exitCount, 1), 1, 2)),
    rows: Math.round(clamp(finite(input.rows, 2), 1, 12)),
    cols: Math.round(clamp(finite(input.cols, 3), 1, 12)),
    furniture: input.furniture === null
      ? null
      : input.furniture.slice(0, 40).map(item => {
        const spec = CATALOG[item.kind] ?? CATALOG.table4;
        return {
          kind: CATALOG[item.kind] ? item.kind : 'table4',
          x: clamp(finite(item.x, 0), 0, Math.max(0, width - spec.w)),
          y: clamp(finite(item.y, 0), 0, Math.max(0, depth - spec.d)),
        };
      }),
  };
}

function boxPart(
  id: string,
  role: string,
  width: number,
  depth: number,
  height: number,
  tx: number,
  ty: number,
  tz: number,
  material: string,
): InteriorSpatialPart {
  return {
    id,
    type: 'box',
    role,
    material,
    params: { width, depth, height },
    at: { tx, ty, tz },
    aabb: { min: [0, 0, 0], max: [width, depth, height] },
  };
}

function wallPart(
  id: string,
  length: number,
  thickness: number,
  height: number,
  tx: number,
  ty: number,
  rz: number,
  openings: Array<{ x: number; w: number; h: number; sill: number }> = [],
): InteriorSpatialPart {
  return {
    id,
    type: 'wall_with_openings',
    role: 'wall',
    material: 'gypsum-concrete-preview',
    params: { length, thickness, height, ...(openings.length ? { openings } : {}) },
    at: { tx, ty, tz: 0, rz },
    aabb: { min: [0, 0, 0], max: [length, thickness, height] },
  };
}

function seedGrid(params: InteriorSpatialParameters): InteriorFurnitureItem[] {
  const zoneW = params.width - 1600;
  const zoneD = params.depth - 2400;
  const result: InteriorFurnitureItem[] = [];
  for (let row = 0; row < params.rows; row += 1) {
    for (let col = 0; col < params.cols; col += 1) {
      result.push({
        kind: 'table4',
        x: 800 + (zoneW / params.cols) * (col + 0.5) - 600,
        y: 800 + (zoneD / params.rows) * (row + 0.5) - 600,
      });
    }
  }
  return result;
}

export function buildInteriorSpatialAssembly(input: InteriorSpatialParameters): InteriorSpatialAssembly {
  const p = normalizeInteriorSpatialParameters(input);
  const wallThickness = 150;
  const doorHeight = Math.min(2100, p.ceilingHeight);
  const doorX = p.width / 2 - p.doorWidth / 2;
  const backOpenings = p.exitCount === 2
    ? [{ x: Math.max(0, p.width - 1300), w: Math.min(900, p.width), h: doorHeight, sill: 0 }]
    : [];
  const parts: InteriorSpatialPart[] = [
    boxPart('floor', 'floor', p.width, p.depth, 100, 0, 0, -100, 'concrete-preview'),
    wallPart('wall_front', p.width, wallThickness, p.ceilingHeight, 0, -wallThickness, 0, [
      { x: doorX, w: p.doorWidth, h: doorHeight, sill: 0 },
    ]),
    wallPart('wall_back', p.width, wallThickness, p.ceilingHeight, 0, p.depth, 0, backOpenings),
    wallPart('wall_left', p.depth, wallThickness, p.ceilingHeight, 0, 0, 90),
    wallPart('wall_right', p.depth, wallThickness, p.ceilingHeight, p.width + wallThickness, 0, 90),
  ];

  const counterWidth = Math.min(3100, p.width * 0.4);
  const counterX = p.width - counterWidth - 400;
  const counterY = p.depth - 1100;
  parts.push(
    boxPart('counter_top', 'counter', counterWidth, 800, 40, counterX, counterY, 1010, 'timber-preview'),
    boxPart('counter_front', 'counter', counterWidth, 18, 1010, counterX, counterY, 0, 'timber-preview'),
    boxPart('counter_side_left', 'counter', 18, 782, 1010, counterX, counterY + 18, 0, 'timber-preview'),
    boxPart('counter_side_right', 'counter', 18, 782, 1010, counterX + counterWidth - 18, counterY + 18, 0, 'timber-preview'),
  );

  const furniture = p.furniture ?? seedGrid(p);
  let seatCount = 0;
  for (const [index, item] of furniture.entries()) {
    const spec = CATALOG[item.kind];
    const x = clamp(item.x, 0, Math.max(0, p.width - spec.w));
    const y = clamp(item.y, 0, Math.max(0, p.depth - spec.d));
    const topHeight = item.kind === 'sofa' ? 420 : 750;
    const baseHeight = item.kind === 'sofa' ? 420 : 720;
    parts.push(boxPart(`furniture_${index}_top`, 'table', spec.w, spec.d, item.kind === 'sofa' ? 420 : 30, x, y, item.kind === 'sofa' ? 0 : baseHeight, 'furniture-preview'));
    if (item.kind !== 'sofa') {
      const legInset = Math.min(100, Math.min(spec.w, spec.d) / 5);
      const leg = 50;
      const positions = [
        [legInset, legInset], [spec.w - legInset - leg, legInset],
        [legInset, spec.d - legInset - leg], [spec.w - legInset - leg, spec.d - legInset - leg],
      ];
      positions.forEach(([lx, ly], legIndex) => {
        parts.push(boxPart(`furniture_${index}_leg_${legIndex}`, 'table', leg, leg, baseHeight, x + lx, y + ly, 0, 'furniture-preview'));
      });
    }
    void topHeight;
    seatCount += spec.seats;
  }

  return {
    name: 'Interior spatial layout',
    domain: 'interior',
    kind: 'spatial-layout',
    parts,
    roomBounds: { W: p.width, D: p.depth },
    exits: [
      { x: doorX + p.doorWidth / 2, y: 0, widthMm: p.doorWidth },
      ...(p.exitCount === 2 ? [{ x: p.width - 850, y: p.depth, widthMm: 900 }] : []),
    ],
    furniture: [
      { id: 'furniture', name: 'Furniture', count: furniture.length, seats: 0 },
      { id: 'seating', name: 'Seats', count: seatCount, seats: 1 },
      { id: 'counter', name: 'Service counter', count: 1, seats: 0 },
    ],
    floorAreaM2: Number(((p.width * p.depth) / 1e6).toFixed(2)),
    ...(p.furniture ? { customFurniture: p.furniture } : {}),
  };
}

/** The checker needs semantic walls-with-openings; the box viewer needs the
 * same walls split at door openings so it does not visually seal the exits. */
export function interiorViewerParts(assembly: InteriorSpatialAssembly): InteriorSpatialPart[] {
  return assembly.parts.flatMap(part => {
    if (part.type !== 'wall_with_openings') return [part];
    const length = Number(part.params.length);
    const thickness = Number(part.params.thickness);
    const height = Number(part.params.height);
    const openings = (part.params.openings as Array<{ x: number; w: number; h: number; sill: number }> | undefined) ?? [];
    const doors = openings.filter(opening => opening.sill < 300 && opening.h >= 1800).sort((a, b) => a.x - b.x);
    if (!doors.length) return [part];
    const segments: InteriorSpatialPart[] = [];
    let cursor = 0;
    doors.forEach((door, index) => {
      if (door.x > cursor) {
        const segment = wallPart(`${part.id}_segment_${index}`, door.x - cursor, thickness, height, 0, 0, 0);
        segment.at = { ...part.at, tx: part.at.tx + (part.at.rz === 90 ? 0 : cursor), ty: part.at.ty + (part.at.rz === 90 ? cursor : 0) };
        segments.push(segment);
      }
      cursor = Math.max(cursor, door.x + door.w);
    });
    if (cursor < length) {
      const segment = wallPart(`${part.id}_segment_end`, length - cursor, thickness, height, 0, 0, 0);
      segment.at = { ...part.at, tx: part.at.tx + (part.at.rz === 90 ? 0 : cursor), ty: part.at.ty + (part.at.rz === 90 ? cursor : 0) };
      segments.push(segment);
    }
    return segments;
  });
}
