import { parseEntities, type StepArg, type StepEntity } from '@/lib/brep-bridge/stepImport';
import type { ProductSpatialNodeKind } from '@/lib/ai/productSpatialIr';
import type { CadFailureCode } from './cadFailureTaxonomy';
import { buildIfcAlignmentIr,evaluateIfcAlignmentStation,type IfcAlignmentIr } from './ifcDomainIr';

export interface IfcSpatialNodeEvidence {
  entityId: number;
  globalId: string | null;
  name: string;
  ifcClass: string;
  kind: ProductSpatialNodeKind;
  parentEntityId: number | null;
  placementEntityId: number | null;
  placementStatus: 'not_applicable' | 'available' | 'missing' | 'invalid' | 'unsupported' | 'cycle';
  /** Row-major local-to-world transform. Present only when every placement link is resolved. */
  worldTransform: number[] | null;
}

export interface IfcSpatialStructureEvidence {
  schema: string | null;
  nodes: IfcSpatialNodeEvidence[];
  spatialCount: number;
  elementCount: number;
  relatedCount: number;
  availablePlacementCount: number;
  unresolvedPlacementCount: number;
  unsupportedPlacementCount: number;
  optionalSpatialPlacementOmittedCount: number;
  cycleCount: number;
  linearPlacementEvidence:{total:number;explicitCartesian:number;distanceEvaluated:number;crossChecked:number;mismatches:number;maxPositionDifference:number;maxBasisDifference:number};
  failureCodes: CadFailureCode[];
}

const KINDS: Readonly<Record<string, ProductSpatialNodeKind>> = {
  IFCPROJECT: 'project', IFCSITE: 'site', IFCBUILDING: 'building',
  IFCBUILDINGSTOREY: 'storey', IFCSPACE: 'space', IFCSPATIALZONE: 'zone',
  IFCELEMENTASSEMBLY: 'assembly', IFCSYSTEM: 'system', IFCDISTRIBUTIONSYSTEM: 'system',
  IFCFACILITY: 'site', IFCROAD: 'site', IFCRAILWAY: 'site', IFCBRIDGE: 'site', IFCMARINEFACILITY: 'site',
  IFCFACILITYPART: 'zone', IFCROADPART: 'zone', IFCRAILWAYPART: 'zone', IFCBRIDGEPART: 'zone', IFCMARINEPART: 'zone',
};
const ELEMENT = /^IFC(?:WALL|SLAB|COLUMN|BEAM|FOOTING|ROOF|STAIR|RAMP|DOOR|WINDOW|MEMBER|PLATE|COVERING|CURTAINWALL|RAILING|BUILDINGELEMENTPROXY|BUILTELEMENT|FURNISHINGELEMENT|FLOW|DISTRIBUTION|PIPE|DUCT|CABLE|LIGHT|SANITARY|FURNITURE|REINFORCING|STRUCTURAL|RAIL|TRACK|COURSE|PAVEMENT|EARTHWORKS|SIGN|SIGNAL|GEOGRAPHIC|KERB|MOORING|BEARING|DEEPFOUNDATION|PILE)/;

const ref = (arg: StepArg | undefined): number | null => arg?.kind === 'ref' ? arg.id : null;
const refs = (arg: StepArg | undefined): number[] => arg?.kind === 'list' ? arg.items.flatMap(item => item.kind === 'ref' ? [item.id] : []) : [];
const text = (arg: StepArg | undefined): string | null => arg?.kind === 'string' ? arg.value : null;
const scalar = (arg: StepArg | undefined): number | null => arg?.kind==='number'?arg.value:arg?.kind==='typed'?scalar(arg.args[0]):null;

type Matrix4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type Vec3 = [number, number, number];
const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const numbers = (arg: StepArg | undefined): number[] | null => arg?.kind === 'list' && arg.items.every(item => item.kind === 'number') ? arg.items.map(item => (item as { kind: 'number'; value: number }).value) : null;
const normalize = (v: Vec3): Vec3 | null => { const length = Math.hypot(...v); return length > 1e-12 ? [v[0] / length, v[1] / length, v[2] / length] : null; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const multiply = (a: Matrix4, b: Matrix4): Matrix4 => {
  const out = Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) for (let k = 0; k < 4; k++) out[row * 4 + col] += a[row * 4 + k]! * b[k * 4 + col]!;
  return out as Matrix4;
};
const point = (id: number | null, entities: Map<number, StepEntity>): Vec3 | null => {
  const entity = id === null ? null : entities.get(id); const values = entity?.name === 'IFCCARTESIANPOINT' ? numbers(entity.args[0]) : null;
  return values && values.length >= 2 ? [values[0]!, values[1]!, values[2] ?? 0] : null;
};
const direction = (id: number | null, entities: Map<number, StepEntity>): Vec3 | null => {
  const entity = id === null ? null : entities.get(id); const values = entity?.name === 'IFCDIRECTION' ? numbers(entity.args[0]) : null;
  return values && values.length >= 2 ? normalize([values[0]!, values[1]!, values[2] ?? 0]) : null;
};
function axisPlacement(id: number | null, entities: Map<number, StepEntity>): Matrix4 | null {
  const entity = id === null ? null : entities.get(id); if (!entity || !['IFCAXIS2PLACEMENT2D', 'IFCAXIS2PLACEMENT3D'].includes(entity.name)) return null;
  const origin = point(ref(entity.args[0]), entities); if (!origin) return null;
  const z = entity.name === 'IFCAXIS2PLACEMENT3D' ? direction(ref(entity.args[1]), entities) ?? [0, 0, 1] as Vec3 : [0, 0, 1] as Vec3;
  const suggestedX = direction(ref(entity.args[2] ?? entity.args[1]), entities) ?? [1, 0, 0] as Vec3;
  const y = normalize(cross(z, suggestedX)); if (!y) return null; const x = normalize(cross(y, z)); if (!x) return null;
  return [x[0], y[0], z[0], origin[0], x[1], y[1], z[1], origin[1], x[2], y[2], z[2], origin[2], 0, 0, 0, 1];
}

function straightGridAxis(id: number, entities: Map<number, StepEntity>): { a: Vec3; b: Vec3 } | null {
  const axis = entities.get(id); if (axis?.name !== 'IFCGRIDAXIS') return null;
  const curve = entities.get(ref(axis.args[1]) ?? -1); const ids = curve?.name === 'IFCPOLYLINE' ? refs(curve.args[0]) : [];
  if (ids.length !== 2) return null; const a = point(ids[0]!, entities); const b = point(ids[1]!, entities); return a && b ? { a, b } : null;
}
function gridPlacement(entity: StepEntity, entities: Map<number, StepEntity>, seen: Set<number>,alignment?:IfcAlignmentIr): Matrix4 | null {
  const base = resolvePlacement(ref(entity.args[0]), entities, seen,alignment); const intersection = entities.get(ref(entity.args[1]) ?? -1);
  const axisIds = intersection?.name === 'IFCVIRTUALGRIDINTERSECTION' ? refs(intersection.args[0]) : [];
  const offsets = intersection?.name === 'IFCVIRTUALGRIDINTERSECTION' ? numbers(intersection.args[1]) : null;
  if (!base || axisIds.length < 2 || !offsets || offsets.some(value => Math.abs(value) > 1e-12) || ref(entity.args[2]) !== null) return null;
  const first = straightGridAxis(axisIds[0]!, entities); const second = straightGridAxis(axisIds[1]!, entities); if (!first || !second) return null;
  const dx1 = first.b[0] - first.a[0], dy1 = first.b[1] - first.a[1], dx2 = second.b[0] - second.a[0], dy2 = second.b[1] - second.a[1];
  const determinant = dx1 * dy2 - dy1 * dx2; if (Math.abs(determinant) <= 1e-12) return null;
  const t = ((second.a[0] - first.a[0]) * dy2 - (second.a[1] - first.a[1]) * dx2) / determinant;
  const x = normalize([dx1, dy1, 0]); if (!x) return null; const z: Vec3 = [0, 0, 1]; const y = normalize(cross(z, x)); if (!y) return null;
  const local: Matrix4 = [x[0], y[0], 0, first.a[0] + t * dx1, x[1], y[1], 0, first.a[1] + t * dy1, 0, 0, 1, 0, 0, 0, 0, 1];
  return multiply(base, local);
}
function resolvePlacement(id: number | null, entities: Map<number, StepEntity>, seen = new Set<number>(),alignment?:IfcAlignmentIr): Matrix4 | null {
  if (id === null || seen.has(id)) return id === null ? IDENTITY : null; seen.add(id);
  const entity = entities.get(id); if (!entity) return null;
  if (entity.name === 'IFCGRIDPLACEMENT') return gridPlacement(entity, entities, seen,alignment);
  if (entity.name === 'IFCLINEARPLACEMENT') {
    const parent = resolvePlacement(ref(entity.args[0]), entities, seen,alignment),cartesian = axisPlacement(ref(entity.args[2]), entities);if(parent&&cartesian)return multiply(parent,cartesian);
    const linear=linearPlacementFromDistance(ref(entity.args[1]),entities,alignment);return parent&&linear?multiply(parent,linear):null;
  }
  if (entity.name !== 'IFCLOCALPLACEMENT') return null;
  const relative = axisPlacement(ref(entity.args[1]), entities); if (!relative) return null;
  const parentId = ref(entity.args[0]); const parent = parentId === null ? IDENTITY : resolvePlacement(parentId, entities, seen,alignment); return parent ? multiply(parent, relative) : null;
}

function linearPlacementFromDistance(axisId:number|null,entities:Map<number,StepEntity>,alignment:IfcAlignmentIr|undefined):Matrix4|null{const axis=axisId===null?null:entities.get(axisId),expression=axis?.name==='IFCAXIS2PLACEMENTLINEAR'?entities.get(ref(axis.args[0])??-1):null;if(expression?.name!=='IFCPOINTBYDISTANCEEXPRESSION'||!alignment?.valid)return null;const distance=scalar(expression.args[0]),lateral=scalar(expression.args[1])??0,vertical=scalar(expression.args[2])??0,longitudinal=scalar(expression.args[3])??0;if(distance===null)return null;const evaluated=evaluateIfcAlignmentStation(alignment,distance+longitudinal);if(!evaluated)return null;const c=Math.cos(evaluated.horizontalDirectionRad),s=Math.sin(evaluated.horizontalDirectionRad),gradient=evaluated.gradient??0,x=normalize([c,s,gradient]),y=normalize([-s,c,0]);if(!x||!y)return null;const z=normalize(cross(x,y));if(!z)return null;const origin:[number,number,number]=[evaluated.point[0]-s*lateral,evaluated.point[1]+c*lateral,evaluated.point[2]+vertical];return[x[0],y[0],z[0],origin[0],x[1],y[1],z[1],origin[1],x[2],y[2],z[2],origin[2],0,0,0,1];}

function placementStatus(id: number | null, entities: Map<number, StepEntity>,alignment?:IfcAlignmentIr): IfcSpatialNodeEvidence['placementStatus'] {
  if (id === null) return 'missing';
  const seen = new Set<number>(); let current: number | null = id;
  while (current !== null) {
    if (seen.has(current)) return 'cycle';
    seen.add(current);
    const entity = entities.get(current);
    if (!entity) return 'invalid';
    if (entity.name === 'IFCGRIDPLACEMENT') return resolvePlacement(id, entities,new Set(),alignment) ? 'available' : 'unsupported';
    if (entity.name === 'IFCLINEARPLACEMENT') return resolvePlacement(id, entities,new Set(),alignment) ? 'available' : 'unsupported';
    if (entity.name !== 'IFCLOCALPLACEMENT') return 'invalid';
    if (ref(entity.args[1]) === null) return 'invalid';
    current = ref(entity.args[0]);
  }
  return 'available';
}

/** Structural IFC evidence only. Geometry, code compliance and exact matrices are separate gates. */
export function analyzeIfcSpatialStructure(source: string): IfcSpatialStructureEvidence {
  const entities = parseEntities(source);
  const alignment=/IFCALIGNMENT\s*\(/i.test(source)?buildIfcAlignmentIr(source):undefined;
  const schema = source.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null;
  const parent = new Map<number, number>();
  for (const entity of entities.values()) {
    if (entity.name === 'IFCRELAGGREGATES' || entity.name === 'IFCRELNESTS') {
      const parentId = ref(entity.args[4]);
      if (parentId !== null) for (const child of refs(entity.args[5])) if (!parent.has(child)) parent.set(child, parentId);
    } else if (entity.name === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
      const parentId = ref(entity.args[5]);
      if (parentId !== null) for (const child of refs(entity.args[4])) if (!parent.has(child)) parent.set(child, parentId);
    }
  }
  const nodes: IfcSpatialNodeEvidence[] = [];
  for (const [entityId, entity] of entities) {
    const nonOccurrence = /(?:TYPE|STYLE|PROPERTIES|CRS)$/.test(entity.name) || entity.name.startsWith('IFCSTRUCTURAL');
    const kind = nonOccurrence ? null : KINDS[entity.name] ?? (ELEMENT.test(entity.name) ? 'element' : null);
    if (!kind) continue;
    const assemblyWithoutOwnShape = kind === 'assembly' && entity.args[6]?.kind === 'null';
    const placementOptional = ['project', 'site', 'building', 'storey', 'zone', 'system'].includes(kind) || assemblyWithoutOwnShape;
    const placementEntityId = ref(entity.args[5]);
    const measuredPlacementStatus = placementStatus(placementEntityId, entities,alignment);
    nodes.push({
      entityId, globalId: text(entity.args[0]), name: text(entity.args[2]) ?? `${entity.name} #${entityId}`,
      ifcClass: entity.name, kind, parentEntityId: parent.get(entityId) ?? null, placementEntityId,
      placementStatus: placementOptional && placementEntityId === null ? 'not_applicable' : measuredPlacementStatus,
      worldTransform: measuredPlacementStatus === 'available' ? resolvePlacement(placementEntityId, entities,new Set(),alignment) : null,
    });
  }
  nodes.sort((a, b) => a.entityId - b.entityId);
  const unresolvedPlacementCount = nodes.filter(node => ['missing', 'invalid', 'unsupported'].includes(node.placementStatus)).length;
  const unsupportedPlacementCount = nodes.filter(node => node.placementStatus === 'unsupported').length;
  const optionalSpatialPlacementOmittedCount = nodes.filter(node => node.placementStatus === 'not_applicable' && node.kind !== 'project').length;
  const cycleCount = nodes.filter(node => node.placementStatus === 'cycle').length;
  const failureCodes: CadFailureCode[] = [];
  if (unresolvedPlacementCount > 0 || cycleCount > 0) failureCodes.push('IFC_PLACEMENT_UNRESOLVED');
  if (unsupportedPlacementCount > 0) failureCodes.push('UNSUPPORTED_ENTITY');
  const linearPlacementEvidence=measureLinearPlacements(entities,alignment);
  return {
    schema, nodes,
    spatialCount: nodes.filter(node => ['project', 'site', 'building', 'storey', 'space', 'zone'].includes(node.kind)).length,
    elementCount: nodes.filter(node => !['project', 'site', 'building', 'storey', 'space', 'zone'].includes(node.kind)).length,
    relatedCount: nodes.filter(node => node.parentEntityId !== null).length,
    availablePlacementCount: nodes.filter(node => node.placementStatus === 'available').length,
    unresolvedPlacementCount, unsupportedPlacementCount, optionalSpatialPlacementOmittedCount, cycleCount, failureCodes,linearPlacementEvidence,
  };
}

function measureLinearPlacements(entities:Map<number,StepEntity>,alignment:IfcAlignmentIr|undefined):IfcSpatialStructureEvidence['linearPlacementEvidence']{let total=0,explicitCartesian=0,distanceEvaluated=0,crossChecked=0,mismatches=0,maxPositionDifference=0,maxBasisDifference=0;for(const entity of entities.values()){if(entity.name!=='IFCLINEARPLACEMENT')continue;total++;const cart=axisPlacement(ref(entity.args[2]),entities),distance=linearPlacementFromDistance(ref(entity.args[1]),entities,alignment);if(cart)explicitCartesian++;if(distance)distanceEvaluated++;if(!cart||!distance)continue;crossChecked++;const positionDifference=Math.hypot(cart[3]-distance[3],cart[7]-distance[7],cart[11]-distance[11]),basisDifference=Math.max(...[0,1,2,4,5,6,8,9,10].map(index=>Math.abs(cart[index]!-distance[index]!)));maxPositionDifference=Math.max(maxPositionDifference,positionDifference);maxBasisDifference=Math.max(maxBasisDifference,basisDifference);const scale=Math.max(1,Math.abs(cart[3]),Math.abs(cart[7]),Math.abs(cart[11]));if(positionDifference>Math.max(1e-6,scale*1e-11)||basisDifference>1e-8)mismatches++;}return{total,explicitCartesian,distanceEvaluated,crossChecked,mismatches,maxPositionDifference,maxBasisDifference};}
