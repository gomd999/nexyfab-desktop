import {
  expandHoleArray,
  validateHoleArray,
  type BoundingBoxCtx,
  type HoleArrayDefinition,
  type HoleSpec,
} from './holeArray';

export interface HoleFeaturePlacement {
  sourcePositionId: string;
  params: Record<string, number>;
}

/** Map a wizard's two-dimensional position into the hole feature's world
 * coordinates. Hole arrays are authored in a plane; for X/Z drills that plane
 * is respectively YZ/XY while Y remains the legacy XZ plane. */
function placementPosition(axis: number | undefined, x: number, y: number): Record<string, number> {
  const a = axis === 0 || axis === 2 ? axis : 1;
  if (a === 0) return { posX: 0, posY: x, posZ: y };
  if (a === 2) return { posX: x, posY: y, posZ: 0 };
  return { posX: x, posY: 0, posZ: y };
}

const HOLE_TYPE_CODE: Record<HoleSpec['kind'], number> = {
  drilled: 0,
  counterbore: 1,
  countersink: 2,
  counterdrill: 3,
  tap: 4,
  pipe_tap: 5,
};

function terminationParams(def: HoleArrayDefinition): Record<string, number> {
  switch (def.terminationParams.kind) {
    case 'through': return { endCondition: 1, depth: 999 };
    case 'blind': return { endCondition: 0, depth: def.terminationParams.depth };
    case 'upToFace': return { endCondition: 2, depth: 999 };
    case 'upToNext': return { endCondition: 3, depth: 999 };
  }
}

function geometryParams(spec: HoleSpec): Record<string, number> {
  const common = { holeType: HOLE_TYPE_CODE[spec.kind], diameter: spec.diameter };
  switch (spec.kind) {
    case 'drilled':
      return { ...common, drillTipAngle: spec.drillTipAngle };
    case 'counterbore':
      return { ...common, counterboreDia: spec.headDiameter, counterboreDepth: spec.headDepth, drillTipAngle: spec.drillTipAngle };
    case 'countersink':
      return { ...common, countersinkDia: spec.coneDiameter, countersinkAngle: spec.coneAngle, drillTipAngle: spec.drillTipAngle };
    case 'counterdrill':
      return {
        ...common,
        counterboreDia: spec.headDiameter,
        counterboreDepth: spec.headDepth,
        middleDiameter: spec.middleDiameter,
        middleDepth: spec.middleDepth,
        drillTipAngle: spec.drillTipAngle,
      };
    case 'tap':
      return { ...common, threadPitch: spec.pitch, threadDepth: spec.tapDepth, drillTipAngle: spec.drillTipAngle };
    case 'pipe_tap':
      return { ...common, threadDepth: spec.engagementDepth, taperAngle: spec.taperAngle ?? 0 };
  }
}

/** Convert the V2 wizard's standard/array definition into canonical numeric
 * hole features. Each placement becomes one replayable feature-tree node. */
export function holeArrayToFeaturePlacements(
  def: HoleArrayDefinition,
  ctx?: BoundingBoxCtx,
): HoleFeaturePlacement[] {
  const validation = validateHoleArray(def);
  if (!validation.ok) {
    throw new Error(validation.errors.map(error => error.message).join('; '));
  }
  const spec: HoleSpec = def.holeSpecDetail ?? {
    kind: 'drilled',
    diameter: 5,
    drillTipAngle: 118,
  };
  const positions = expandHoleArray(def, ctx);
  if (positions.length === 0) {
    throw new Error('Hole array did not resolve any positions');
  }
  const axis = def.axis === 0 || def.axis === 2 ? def.axis : 1;
  const shared = { ...geometryParams(spec), ...terminationParams(def), axis, engine: 1 };
  return positions.map(position => ({
    sourcePositionId: position.id,
    params: { ...shared, ...placementPosition(axis, position.x, position.y) },
  }));
}
