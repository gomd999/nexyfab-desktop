import type { FeatureTree } from '@/lib/cad/featureTree';
import { normalizeShapeParams, SHAPE_MAP } from '../shapes';
import { spurGearOuterLoop } from '../shapes/gearProfile';
import type { PlacedPart } from './PartPlacementPanel';

export type PlacedPartTreeProvision =
  | { status: 'exact'; tree: FeatureTree; source: string }
  | { status: 'unsupported'; reason: string };

type Point2 = { x: number; y: number };

function extrudeTree(
  id: string,
  name: string,
  loop: ReadonlyArray<Point2>,
  depth: number,
  profileOffsetZ = 0,
): FeatureTree {
  return {
    nodes: [{
      id: `${id}:base-extrude`,
      name,
      dependencies: [],
      payload: {
        kind: 'extrude',
        loop,
        depth,
        ...(profileOffsetZ !== 0 ? { profileOffsetZ } : {}),
        direction: 'one_sided',
        mode: 'add',
      },
    }],
  };
}

function revolveTree(
  id: string,
  name: string,
  loop: ReadonlyArray<Point2>,
): FeatureTree {
  return {
    nodes: [{
      id: `${id}:base-revolve`,
      name,
      dependencies: [],
      payload: { kind: 'revolve', loop, angleDegrees: 360, mode: 'add' },
    }],
  };
}

function annularProfile(innerRadius: number, outerRadius: number, length: number): Point2[] {
  const half = length / 2;
  if (innerRadius > 0 && innerRadius < outerRadius) {
    return [
      { x: innerRadius, y: -half },
      { x: outerRadius, y: -half },
      { x: outerRadius, y: half },
      { x: innerRadius, y: half },
    ];
  }
  return [
    { x: 0, y: -half },
    { x: outerRadius, y: -half },
    { x: outerRadius, y: half },
    { x: 0, y: half },
  ];
}

/** Exact, editable 30 mm cube used for newly-authored generic assembly parts. */
export function createDefaultAssemblyPartTree(partId: string, size = 30): FeatureTree {
  const half = size / 2;
  return extrudeTree(
    partId,
    'Default box',
    [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ],
    size,
    -half,
  );
}

/**
 * Convert only shapes whose current primitive definition can be represented
 * without approximation by the production FeatureTree vocabulary. Unsupported
 * parts remain missing on purpose: manufacturing verification must never run
 * against a silently substituted envelope.
 */
export function provisionPlacedPartFeatureTree(part: PlacedPart): PlacedPartTreeProvision {
  const shape = SHAPE_MAP[part.shapeId];
  if (!shape) {
    return { status: 'unsupported', reason: `unknown shape ${part.shapeId}` };
  }
  const { params: p } = normalizeShapeParams(shape, part.params);
  const id = part.id;

  if (part.shapeId === 'box') {
    const halfW = p.width! / 2;
    const halfH = p.height! / 2;
    const depth = p.depth!;
    return {
      status: 'exact',
      source: 'box parameters',
      tree: extrudeTree(id, 'Box', [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ], depth, -depth / 2),
    };
  }

  if (part.shapeId === 'cylinder') {
    const outer = p.diameter! / 2;
    const inner = Math.min((p.innerDiameter ?? 0) / 2, Math.max(0, outer - 0.5));
    return {
      status: 'exact',
      source: 'cylinder parameters',
      tree: revolveTree(id, inner > 0 ? 'Hollow cylinder' : 'Cylinder', annularProfile(inner, outer, p.height!)),
    };
  }

  if (part.shapeId === 'disk') {
    const outer = p.diameter! / 2;
    const inner = Math.min((p.innerDia ?? 0) / 2, Math.max(0, outer - 0.5));
    return {
      status: 'exact',
      source: 'disk parameters',
      tree: revolveTree(id, inner > 0 ? 'Annular disk' : 'Disk', annularProfile(inner, outer, p.thickness!)),
    };
  }

  if (part.shapeId === 'cone') {
    const half = p.height! / 2;
    const bottom = p.bottomDiameter! / 2;
    const top = p.topDiameter! / 2;
    return {
      status: 'exact',
      source: 'cone parameters',
      tree: revolveTree(id, 'Cone / frustum', [
        { x: 0, y: -half },
        { x: bottom, y: -half },
        { x: top, y: half },
        { x: 0, y: half },
      ]),
    };
  }

  if (part.shapeId === 'pipe') {
    const outer = p.outerDiameter! / 2;
    const inner = Math.min(p.innerDiameter! / 2, Math.max(0, outer - 0.5));
    return {
      status: 'exact',
      source: 'pipe parameters',
      tree: revolveTree(id, 'Pipe', annularProfile(inner, outer, p.length!)),
    };
  }

  if (part.shapeId === 'washer') {
    const inner = p.innerDia! / 2;
    const outer = Math.max(p.outerDia! / 2, inner + 0.5);
    return {
      status: 'exact',
      source: 'washer parameters',
      tree: revolveTree(id, 'Washer', annularProfile(inner, outer, p.thickness!)),
    };
  }

  if (part.shapeId === 'lBracket') {
    const width = p.width!;
    const height = p.height!;
    const thickness = Math.min(p.thickness!, width, height);
    const left = -width / 2;
    const right = width / 2;
    const depth = p.depth!;
    return {
      status: 'exact',
      source: 'L-bracket parameters',
      tree: extrudeTree(id, 'L bracket', [
        { x: left, y: 0 },
        { x: right, y: 0 },
        { x: right, y: thickness },
        { x: left + thickness, y: thickness },
        { x: left + thickness, y: height },
        { x: left, y: height },
      ], depth, -depth / 2),
    };
  }

  if (part.shapeId === 'wedge') {
    const width = p.width!;
    const height = p.height!;
    const depth = p.depth!;
    return {
      status: 'exact',
      source: 'wedge parameters',
      tree: extrudeTree(id, 'Wedge', [
        { x: -width / 2, y: -height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: width / 2, y: height / 2 },
      ], depth, -depth / 2),
    };
  }

  if (part.shapeId === 'gear') {
    const width = p.width!;
    const baseId = `${id}:gear-profile`;
    const base = {
      id: baseId,
      name: 'Involute gear profile',
      dependencies: [] as string[],
      payload: {
        kind: 'extrude' as const,
        loop: spurGearOuterLoop({
          teeth: p.teeth!,
          module: p.module!,
          boreDiameter: p.boreDiameter!,
          pressureAngle: p.pressureAngle!,
        }),
        depth: width,
        profileOffsetZ: -width / 2,
        direction: 'one_sided' as const,
        mode: 'add' as const,
      },
    };
    const bore = p.boreDiameter!;
    return {
      status: 'exact',
      source: 'shared involute gear profile parameters',
      tree: bore > 0
        ? {
            nodes: [base, {
              id: `${id}:shaft-bore`,
              name: 'Through shaft bore',
              dependencies: [baseId],
              payload: {
                kind: 'hole',
                center: { x: 0, y: 0 },
                holeType: 'drilled',
                diameter: bore,
                depth: width,
                terminationMode: 'through',
              },
            }],
          }
        : { nodes: [base] },
    };
  }

  return {
    status: 'unsupported',
    reason: `${part.shapeId} has no lossless FeatureTree converter`,
  };
}

export function placedPartGeometrySignature(part: PlacedPart): string {
  const finiteParams = Object.entries(part.params)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([part.shapeId, finiteParams]);
}

export function featureTreeSignature(tree: FeatureTree | undefined): string {
  return tree ? JSON.stringify(tree) : '';
}
