import { createHash } from 'node:crypto';
import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureDocument,
  type ArchitectureOpening,
  type InteriorDocument,
} from './architectureInteriorDocuments';

export const ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA = 'nexyfab.architecture-interior-ai-design-proposal.v1' as const;
export const ARCHITECTURE_INTERIOR_AI_COMPILER_VERSION = 'concept-compiler.v1' as const;

type V2 = [number, number];
type V3 = [number, number, number];
type SourceUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
type SpaceUsage = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'office' | 'corridor' | 'lobby' | 'retail' | 'other';

export interface AiArchitectureInteriorDesignProposal {
  schema: typeof ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA;
  projectId: string;
  proposalId: string;
  units: { sourceLength: SourceUnit };
  coordinateFrame: { id: string; origin: V3; rotationDeg: V3 };
  intent: { requestedMaturity: 'concept' };
  construction: { wallThickness: number; slabThickness: number; ceilingThickness: number };
  building: {
    storeys: Array<{ id: string; elevation: number; height: number }>;
    spaces: Array<{
      id: string;
      storeyId: string;
      usageKey: SpaceUsage;
      boundary: V2[];
      openings?: Array<{
        id: string;
        edgeIndex: number;
        kind: 'window' | 'door';
        offset: number;
        width: number;
        height: number;
        sill: number;
      }>;
    }>;
  };
  interior: {
    furniture?: Array<{ id: string; spaceId: string; position: V3; size: V3; clearance: number; rotationDeg?: number }>;
    lights?: Array<{ id: string; spaceId: string; position: V3; suspension: number; lumens: number; cctK: number }>;
    finishes?: Array<{ id: string; spaceId: string; surface: 'floor' | 'wall' | 'ceiling'; materialKey: string }>;
  };
}

export type AiDesignProposalIssueCode =
  | 'proposal_invalid' | 'unsupported_schema' | 'unknown_field' | 'unsupported_units'
  | 'invalid_identifier' | 'unsafe_string' | 'unsupported_claim' | 'numeric_out_of_bounds'
  | 'count_limit_exceeded' | 'boundary_invalid' | 'duplicate_id' | 'invalid_reference'
  | 'invalid_opening' | 'unsupported_geometry'
  | 'furniture_envelope_outside_space' | 'furniture_envelope_outside_storey'
  | 'light_outside_space' | 'light_outside_storey';

export type AiDesignProposalIssue = { code: AiDesignProposalIssueCode; path: string };

export type CompiledArchitectureInteriorConcept = {
  architecture: ArchitectureDocument;
  interior: InteriorDocument;
  coordinateFrame: { id: string; originMm: V3; rotationDeg: V3 };
  provenance: {
    architecture: Array<{ sourceId: string; kind: 'ai'; contentHash: string }>;
    interior: Array<{ sourceId: string; kind: 'ai'; contentHash: string }>;
  };
  hashes: { proposal: string; architecture: string; interior: string };
  compilerVersion: typeof ARCHITECTURE_INTERIOR_AI_COMPILER_VERSION;
  warnings: Array<'concept_only_no_exact_or_release_evidence' | 'code_compliance_not_evaluated' | 'wall_finish_host_defaulted_to_edge_zero'>;
};

const SOURCE_UNIT_SCALE: Record<SourceUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const MATERIAL_KEY = /^[a-z][a-z0-9_.:-]{0,63}$/;
const MAX_COORDINATE_MM = 100_000_000;
const MAX_STOREYS = 64;
const MAX_SPACES = 512;
const MAX_OBJECTS = 4096;
const MAX_BOUNDARY_POINTS = 128;
const MAX_STRING = 256;
const UNSAFE_STRING = /(?:https?:\/\/|file:\/\/|[A-Za-z]:\\|(?:^|[^a-z])(?:api[_-]?key|secret|bearer|password|token)(?:[^a-z]|$)|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{8,})/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non_finite'); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('cycle');
    const next = new Set(ancestors).add(value);
    return `[${value.map(item => canonical(item, next)).join(',')}]`;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) throw new Error('cycle');
    const next = new Set(ancestors).add(value);
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], next)}`).join(',')}}`;
  }
  throw new Error('unsupported_value');
}

function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function pathJoin(path: string, key: string | number): string { return path ? `${path}.${String(key)}` : String(key); }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function inBounds(value: number, positive = false): boolean {
  return finiteNumber(value) && Math.abs(value) <= MAX_COORDINATE_MM && (!positive || value > 0);
}
function scaled(value: number, unit: SourceUnit): number { return value * SOURCE_UNIT_SCALE[unit]; }
function point2(value: unknown): value is V2 { return Array.isArray(value) && value.length === 2 && value.every(finiteNumber); }
function point3(value: unknown): value is V3 { return Array.isArray(value) && value.length === 3 && value.every(finiteNumber); }

function addIssue(issues: AiDesignProposalIssue[], code: AiDesignProposalIssueCode, path: string): void { issues.push({ code, path }); }

function scanUnsafeStrings(value: unknown, path: string, issues: AiDesignProposalIssue[], depth = 0): void {
  if (depth > 8) { addIssue(issues, 'proposal_invalid', path); return; }
  if (typeof value === 'string') { if (value.length > MAX_STRING || UNSAFE_STRING.test(value)) addIssue(issues, 'unsafe_string', path); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => scanUnsafeStrings(item, pathJoin(path, index), issues, depth + 1)); return; }
  if (isRecord(value)) Object.keys(value).forEach(key => scanUnsafeStrings(value[key], pathJoin(path, key), issues, depth + 1));
}

function checkClosed(value: unknown, allowed: ReadonlySet<string>, path: string, issues: AiDesignProposalIssue[], depth = 0): void {
  if (depth > 8) { addIssue(issues, 'proposal_invalid', path); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => checkClosed(item, new Set(), pathJoin(path, index), issues, depth + 1)); return; }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) { addIssue(issues, key.toLowerCase().includes('exact') || key.toLowerCase().includes('compliance') || key.toLowerCase().includes('release') ? 'unsupported_claim' : 'unknown_field', pathJoin(path, key)); continue; }
    const child = value[key];
    if (typeof child === 'string') {
      if (child.length > MAX_STRING || UNSAFE_STRING.test(child)) addIssue(issues, 'unsafe_string', pathJoin(path, key));
    }
  }
}

function checkId(value: unknown, path: string, issues: AiDesignProposalIssue[]): value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || UNSAFE_STRING.test(value)) { addIssue(issues, 'invalid_identifier', path); return false; }
  return true;
}

function checkNumber(value: unknown, path: string, issues: AiDesignProposalIssue[], positive = false): value is number {
  if (!inBounds(typeof value === 'number' ? value * 1 : Number.NaN, positive)) { addIssue(issues, 'numeric_out_of_bounds', path); return false; }
  return true;
}

function checkPoint(value: unknown, path: string, issues: AiDesignProposalIssue[], dimensions: 2 | 3): value is V2 | V3 {
  const valid = dimensions === 2 ? point2(value) : point3(value);
  if (!valid || !(Array.isArray(value) && value.every(item => inBounds(item)))) addIssue(issues, 'numeric_out_of_bounds', path);
  return valid;
}

function scanScaledGeometryNumbers(value: unknown, unit: SourceUnit, path: string, issues: AiDesignProposalIssue[], key = '', depth = 0): void {
  if (depth > 8) return;
  if (typeof value === 'number' && !['lumens', 'cctK', 'rotationDeg', 'edgeIndex'].includes(key) && Math.abs(value * SOURCE_UNIT_SCALE[unit]) > MAX_COORDINATE_MM) {
    addIssue(issues, 'numeric_out_of_bounds', path); return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => scanScaledGeometryNumbers(item, unit, pathJoin(path, index), issues, '', depth + 1)); return; }
  if (isRecord(value)) Object.keys(value).forEach(childKey => scanScaledGeometryNumbers(value[childKey], unit, pathJoin(path, childKey), issues, childKey, depth + 1));
}

function orientation(a: V2, b: V2, c: V2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function polygonSelfIntersects(points: readonly V2[]): boolean {
  for (let first = 0; first < points.length; first++) {
    const a = points[first]!; const b = points[(first + 1) % points.length]!;
    for (let second = first + 1; second < points.length; second++) {
      if (second === first + 1 || (first === 0 && second === points.length - 1)) continue;
      const c = points[second]!; const d = points[(second + 1) % points.length]!;
      const abC = orientation(a, b, c); const abD = orientation(a, b, d); const cdA = orientation(c, d, a); const cdB = orientation(c, d, b);
      if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    }
  }
  return false;
}

function pointOnSegment(point: V2, start: V2, end: V2): boolean {
  const cross = orientation(start, end, point);
  if (Math.abs(cross) > 1e-9) return false;
  return point[0] >= Math.min(start[0], end[0]) - 1e-9 && point[0] <= Math.max(start[0], end[0]) + 1e-9
    && point[1] >= Math.min(start[1], end[1]) - 1e-9 && point[1] <= Math.max(start[1], end[1]) + 1e-9;
}

function pointInPolygon(point: V2, polygon: readonly V2[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!; const end = polygon[(index + 1) % polygon.length]!;
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]);
    if (crosses && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]) inside = !inside;
  }
  return inside;
}

function clearanceEnvelopeCorners(position: V3, size: V3, clearance: number, rotationDeg: number): V2[] {
  const halfX = (size[0] + 2 * clearance) / 2; const halfY = (size[1] + 2 * clearance) / 2;
  const radians = rotationDeg * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]].map(([x, y]) => [position[0] + x * cosine - y * sine, position[1] + x * sine + y * cosine]);
}

export function validateAiArchitectureInteriorDesignProposal(value: unknown): AiDesignProposalIssue[] {
  const issues: AiDesignProposalIssue[] = [];
  if (!isRecord(value)) return [{ code: 'proposal_invalid', path: '$' }];
  const top = new Set(['schema', 'projectId', 'proposalId', 'units', 'coordinateFrame', 'intent', 'construction', 'building', 'interior']);
  checkClosed(value, top, '$', issues);
  scanUnsafeStrings(value, '$', issues);
  if (isRecord(value.units)) checkClosed(value.units, new Set(['sourceLength']), '$.units', issues);
  if (isRecord(value.coordinateFrame)) checkClosed(value.coordinateFrame, new Set(['id', 'origin', 'rotationDeg']), '$.coordinateFrame', issues);
  if (isRecord(value.intent)) checkClosed(value.intent, new Set(['requestedMaturity']), '$.intent', issues);
  if (isRecord(value.construction)) checkClosed(value.construction, new Set(['wallThickness', 'slabThickness', 'ceilingThickness']), '$.construction', issues);
  if (isRecord(value.building)) checkClosed(value.building, new Set(['storeys', 'spaces']), '$.building', issues);
  if (isRecord(value.interior)) checkClosed(value.interior, new Set(['furniture', 'lights', 'finishes']), '$.interior', issues);
  if (value.schema !== ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA) addIssue(issues, value.schema ? 'unsupported_schema' : 'proposal_invalid', '$.schema');
  checkId(value.projectId, '$.projectId', issues); checkId(value.proposalId, '$.proposalId', issues);
  if (!isRecord(value.units) || !['mm', 'cm', 'm', 'in', 'ft'].includes(String(value.units?.sourceLength))) addIssue(issues, 'unsupported_units', '$.units.sourceLength');
  const unit = (isRecord(value.units) && ['mm', 'cm', 'm', 'in', 'ft'].includes(String(value.units.sourceLength)) ? value.units.sourceLength : 'mm') as SourceUnit;
  scanScaledGeometryNumbers(value, unit, '$', issues);
  if (!isRecord(value.coordinateFrame)) addIssue(issues, 'proposal_invalid', '$.coordinateFrame');
  else {
    checkId(value.coordinateFrame.id, '$.coordinateFrame.id', issues);
    checkPoint(value.coordinateFrame.origin, '$.coordinateFrame.origin', issues, 3);
    checkPoint(value.coordinateFrame.rotationDeg, '$.coordinateFrame.rotationDeg', issues, 3);
    if (Array.isArray(value.coordinateFrame.rotationDeg) && value.coordinateFrame.rotationDeg.some(item => typeof item !== 'number' || item < -360 || item > 360)) addIssue(issues, 'numeric_out_of_bounds', '$.coordinateFrame.rotationDeg');
  }
  if (!isRecord(value.intent) || value.intent.requestedMaturity !== 'concept') addIssue(issues, 'unsupported_claim', '$.intent.requestedMaturity');
  if (!isRecord(value.construction)) addIssue(issues, 'proposal_invalid', '$.construction');
  else {
    checkNumber(value.construction.wallThickness, '$.construction.wallThickness', issues, true);
    checkNumber(value.construction.slabThickness, '$.construction.slabThickness', issues, true);
    checkNumber(value.construction.ceilingThickness, '$.construction.ceilingThickness', issues, true);
  }
  if (!isRecord(value.building) || !Array.isArray(value.building.storeys) || !Array.isArray(value.building.spaces)) { addIssue(issues, 'proposal_invalid', '$.building'); return issues; }
  if (value.building.storeys.length > MAX_STOREYS || value.building.spaces.length > MAX_SPACES) addIssue(issues, 'count_limit_exceeded', '$.building');
  const ids = new Set<string>(); const storeyIds = new Set<string>(); const storeyHeights = new Map<string, number>(); const storeyRanges = new Map<string, { elevation: number; height: number }>(); let objectCount = value.building.storeys.length;
  value.building.storeys.forEach((storey, index) => {
    const path = `$.building.storeys.${index}`;
    if (!isRecord(storey)) { addIssue(issues, 'proposal_invalid', path); return; }
    checkClosed(storey, new Set(['id', 'elevation', 'height']), path, issues);
    if (checkId(storey.id, `${path}.id`, issues)) { if (ids.has(storey.id)) addIssue(issues, 'duplicate_id', `${path}.id`); ids.add(storey.id); storeyIds.add(storey.id); if (typeof storey.height === 'number') storeyHeights.set(storey.id, storey.height); if (typeof storey.elevation === 'number' && typeof storey.height === 'number') storeyRanges.set(storey.id, { elevation: storey.elevation, height: storey.height }); }
    checkNumber(storey.elevation, `${path}.elevation`, issues); checkNumber(storey.height, `${path}.height`, issues, true);
  });
  const spaceIds = new Set<string>(); const spaceGeometry = new Map<string, { storeyId: string; boundary: V2[] }>();
  value.building.spaces.forEach((space, index) => {
    const path = `$.building.spaces.${index}`;
    if (!isRecord(space)) { addIssue(issues, 'proposal_invalid', path); return; }
    checkClosed(space, new Set(['id', 'storeyId', 'usageKey', 'boundary', 'openings']), path, issues);
    if (checkId(space.id, `${path}.id`, issues)) { if (ids.has(space.id)) addIssue(issues, 'duplicate_id', `${path}.id`); ids.add(space.id); spaceIds.add(space.id); }
    if (!storeyIds.has(String(space.storeyId))) addIssue(issues, 'invalid_reference', `${path}.storeyId`);
    if (!['living', 'bedroom', 'kitchen', 'bathroom', 'office', 'corridor', 'lobby', 'retail', 'other'].includes(String(space.usageKey))) addIssue(issues, 'proposal_invalid', `${path}.usageKey`);
    if (!Array.isArray(space.boundary) || space.boundary.length < 3 || space.boundary.length > MAX_BOUNDARY_POINTS) addIssue(issues, 'boundary_invalid', `${path}.boundary`);
    else {
      const boundary = space.boundary as unknown[];
      boundary.forEach((point, pointIndex) => checkPoint(point, `${path}.boundary.${pointIndex}`, issues, 2));
      boundary.forEach((point, pointIndex) => { const next = boundary[(pointIndex + 1) % boundary.length]; if (point2(point) && point2(next) && Math.hypot(next[0] - point[0], next[1] - point[1]) === 0) addIssue(issues, 'boundary_invalid', `${path}.boundary.${pointIndex}`); });
      if (boundary.every(point2)) { const typedBoundary = boundary as V2[]; const area = typedBoundary.reduce((sum, point, pointIndex) => { const next = typedBoundary[(pointIndex + 1) % typedBoundary.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2; if (Math.abs(area) <= Number.EPSILON || polygonSelfIntersects(typedBoundary)) addIssue(issues, 'boundary_invalid', `${path}.boundary`); if (typeof space.id === 'string' && IDENTIFIER.test(space.id) && storeyIds.has(String(space.storeyId))) spaceGeometry.set(space.id, { storeyId: String(space.storeyId), boundary: typedBoundary }); }
    }
    const openings = space.openings ?? []; if (!Array.isArray(openings) || openings.length > MAX_BOUNDARY_POINTS) addIssue(issues, 'count_limit_exceeded', `${path}.openings`);
    (Array.isArray(openings) ? openings : []).forEach((opening, openingIndex) => {
      objectCount += 1; const openingPath = `${path}.openings.${openingIndex}`;
      if (!isRecord(opening)) { addIssue(issues, 'proposal_invalid', openingPath); return; }
      checkClosed(opening, new Set(['id', 'edgeIndex', 'kind', 'offset', 'width', 'height', 'sill']), openingPath, issues);
      if (checkId(opening.id, `${openingPath}.id`, issues)) { if (ids.has(opening.id)) addIssue(issues, 'duplicate_id', `${openingPath}.id`); ids.add(opening.id); }
      const edgeIndex = typeof opening.edgeIndex === 'number' ? opening.edgeIndex : Number.NaN;
      if (!Number.isSafeInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= (Array.isArray(space.boundary) ? space.boundary.length : 0)) addIssue(issues, 'invalid_opening', `${openingPath}.edgeIndex`);
      if (!['window', 'door'].includes(String(opening.kind))) addIssue(issues, 'invalid_opening', `${openingPath}.kind`);
      checkNumber(opening.offset, `${openingPath}.offset`, issues); checkNumber(opening.width, `${openingPath}.width`, issues, true); checkNumber(opening.height, `${openingPath}.height`, issues, true); checkNumber(opening.sill, `${openingPath}.sill`, issues);
      if (typeof opening.offset === 'number' && opening.offset < 0) addIssue(issues, 'invalid_opening', `${openingPath}.offset`);
      if (typeof opening.sill === 'number' && opening.sill < 0) addIssue(issues, 'invalid_opening', `${openingPath}.sill`);
      if (Array.isArray(space.boundary) && Number.isSafeInteger(edgeIndex) && point2(space.boundary[edgeIndex]) && point2(space.boundary[(edgeIndex + 1) % space.boundary.length]) && typeof opening.offset === 'number' && typeof opening.width === 'number') {
        const start = space.boundary[edgeIndex] as number[]; const end = space.boundary[(edgeIndex + 1) % space.boundary.length] as number[];
        if (opening.offset + opening.width > Math.hypot(end[0] - start[0], end[1] - start[1])) addIssue(issues, 'invalid_opening', `${openingPath}.width`);
      }
      if (typeof opening.sill === 'number' && typeof opening.height === 'number' && (opening.sill < 0 || opening.sill + opening.height > (storeyHeights.get(String(space.storeyId)) ?? 0))) addIssue(issues, 'invalid_opening', `${openingPath}.height`);
    });
    if (Array.isArray(openings)) {
      for (let first = 0; first < openings.length; first++) for (let second = first + 1; second < openings.length; second++) {
        const a = openings[first]; const b = openings[second];
        if (isRecord(a) && isRecord(b) && a.edgeIndex === b.edgeIndex && typeof a.offset === 'number' && typeof a.width === 'number' && typeof b.offset === 'number' && typeof b.width === 'number' && Math.max(a.offset, b.offset) < Math.min(a.offset + a.width, b.offset + b.width)) addIssue(issues, 'invalid_opening', `${path}.openings.${second}`);
      }
    }
  });
  if (!isRecord(value.interior)) addIssue(issues, 'proposal_invalid', '$.interior');
  else {
    const interior = value.interior; checkClosed(interior, new Set(['furniture', 'lights', 'finishes']), '$.interior', issues); const arrays = [interior.furniture, interior.lights, interior.finishes];
    if (arrays.some(item => item !== undefined && !Array.isArray(item))) addIssue(issues, 'proposal_invalid', '$.interior');
    const furniture = Array.isArray(interior.furniture) ? interior.furniture : []; const lights = Array.isArray(interior.lights) ? interior.lights : []; const finishes = Array.isArray(interior.finishes) ? interior.finishes : [];
    objectCount += furniture.length + lights.length + finishes.length;
    if (objectCount > MAX_OBJECTS) addIssue(issues, 'count_limit_exceeded', '$.interior');
    furniture.forEach((item, index) => { const path = `$.interior.furniture.${index}`; if (!isRecord(item)) { addIssue(issues, 'proposal_invalid', path); return; } checkClosed(item, new Set(['id', 'spaceId', 'position', 'size', 'clearance', 'rotationDeg']), path, issues); if (checkId(item.id, `${path}.id`, issues)) { if (ids.has(item.id)) addIssue(issues, 'duplicate_id', `${path}.id`); ids.add(item.id); } if (!spaceIds.has(String(item.spaceId))) addIssue(issues, 'invalid_reference', `${path}.spaceId`); checkPoint(item.position, `${path}.position`, issues, 3); checkPoint(item.size, `${path}.size`, issues, 3); if (point3(item.size) && item.size.some(size => size <= 0)) addIssue(issues, 'numeric_out_of_bounds', `${path}.size`); checkNumber(item.clearance, `${path}.clearance`, issues); if (typeof item.clearance === 'number' && item.clearance < 0) addIssue(issues, 'numeric_out_of_bounds', `${path}.clearance`); if (item.rotationDeg !== undefined) { checkNumber(item.rotationDeg, `${path}.rotationDeg`, issues); if (typeof item.rotationDeg === 'number' && (item.rotationDeg < -360 || item.rotationDeg > 360)) addIssue(issues, 'numeric_out_of_bounds', `${path}.rotationDeg`); } });
    furniture.forEach((item, index) => {
      if (!isRecord(item)) return;
      const path = `$.interior.furniture.${index}`; const geometry = spaceGeometry.get(String(item.spaceId)); const position = item.position; const size = item.size;
      if (!geometry || !point3(position) || !point3(size) || typeof item.clearance !== 'number' || item.clearance < 0 || typeof item.rotationDeg === 'number' && !Number.isFinite(item.rotationDeg)) return;
      const corners = clearanceEnvelopeCorners(position, size, item.clearance, typeof item.rotationDeg === 'number' ? item.rotationDeg : 0);
      if (corners.some(corner => !pointInPolygon(corner, geometry.boundary))) addIssue(issues, 'furniture_envelope_outside_space', `${path}.clearance`);
      const range = storeyRanges.get(geometry.storeyId);
      if (range && (position[2] - item.clearance < range.elevation || position[2] + size[2] + item.clearance > range.elevation + range.height)) addIssue(issues, 'furniture_envelope_outside_storey', `${path}.position`);
    });
    lights.forEach((item, index) => { const path = `$.interior.lights.${index}`; if (!isRecord(item)) { addIssue(issues, 'proposal_invalid', path); return; } checkClosed(item, new Set(['id', 'spaceId', 'position', 'suspension', 'lumens', 'cctK']), path, issues); if (checkId(item.id, `${path}.id`, issues)) { if (ids.has(item.id)) addIssue(issues, 'duplicate_id', `${path}.id`); ids.add(item.id); } if (!spaceIds.has(String(item.spaceId))) addIssue(issues, 'invalid_reference', `${path}.spaceId`); checkPoint(item.position, `${path}.position`, issues, 3); checkNumber(item.suspension, `${path}.suspension`, issues); if (typeof item.suspension === 'number' && item.suspension < 0) addIssue(issues, 'numeric_out_of_bounds', `${path}.suspension`); checkNumber(item.lumens, `${path}.lumens`, issues, true); checkNumber(item.cctK, `${path}.cctK`, issues, true); });
    lights.forEach((item, index) => {
      if (!isRecord(item)) return;
      const path = `$.interior.lights.${index}`; const geometry = spaceGeometry.get(String(item.spaceId)); const position = item.position;
      if (!geometry || !point3(position) || typeof item.suspension !== 'number' || item.suspension < 0) return;
      if (!pointInPolygon([position[0], position[1]], geometry.boundary)) addIssue(issues, 'light_outside_space', `${path}.position`);
      const range = storeyRanges.get(geometry.storeyId);
      if (range && (position[2] < range.elevation || position[2] + item.suspension > range.elevation + range.height)) addIssue(issues, 'light_outside_storey', `${path}.position`);
    });
    finishes.forEach((item, index) => { const path = `$.interior.finishes.${index}`; if (!isRecord(item)) { addIssue(issues, 'proposal_invalid', path); return; } checkClosed(item, new Set(['id', 'spaceId', 'surface', 'materialKey']), path, issues); if (checkId(item.id, `${path}.id`, issues)) { if (ids.has(item.id)) addIssue(issues, 'duplicate_id', `${path}.id`); ids.add(item.id); } if (!spaceIds.has(String(item.spaceId))) addIssue(issues, 'invalid_reference', `${path}.spaceId`); if (!['floor', 'wall', 'ceiling'].includes(String(item.surface)) || typeof item.materialKey !== 'string' || !MATERIAL_KEY.test(item.materialKey)) addIssue(issues, 'proposal_invalid', `${path}.materialKey`); });
  }
  if (issues.length === 0) {
    // Verify that positive source values remain bounded after unit conversion.
    const sourceScale = SOURCE_UNIT_SCALE[unit]; if (!Number.isFinite(sourceScale)) addIssue(issues, 'unsupported_units', '$.units.sourceLength');
  }
  return [...new Map(issues.map(issue => [`${issue.code}:${issue.path}`, issue])).values()];
}

function documentHash(document: unknown): string { return hash(document); }

function openingPosition(start: V2, end: V2, offset: number, sill: number, unit: SourceUnit): V3 {
  const a = [scaled(start[0], unit), scaled(start[1], unit)] as V2; const b = [scaled(end[0], unit), scaled(end[1], unit)] as V2;
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy); const ratio = scaled(offset, unit) / length;
  return [a[0] + dx * ratio, a[1] + dy * ratio, scaled(sill, unit)];
}

export function compileAiArchitectureInteriorDesignProposal(value: unknown):
  | { ok: true; result: CompiledArchitectureInteriorConcept }
  | { ok: false; issues: AiDesignProposalIssue[] } {
  const issues = validateAiArchitectureInteriorDesignProposal(value);
  if (issues.length) return { ok: false, issues };
  const proposal = value as AiArchitectureInteriorDesignProposal;
  const unit = proposal.units.sourceLength;
  const architectureDocumentId = `architecture:${proposal.projectId}:${proposal.proposalId}`;
  const walls: ArchitectureDocument['walls'] = []; const slabs: ArchitectureDocument['slabs'] = []; const ceilings: ArchitectureDocument['ceilings'] = [];
  const spaces: ArchitectureDocument['spaces'] = []; const openings: ArchitectureOpening[] = [];
  for (const sourceSpace of proposal.building.spaces) {
    const boundaryMm = sourceSpace.boundary.map(point => [scaled(point[0], unit), scaled(point[1], unit)] as V2);
    const wallIds: string[] = [];
    boundaryMm.forEach((start, edgeIndex) => {
      const end = boundaryMm[(edgeIndex + 1) % boundaryMm.length]!; const wallId = `wall:${sourceSpace.id}:${edgeIndex}`; wallIds.push(wallId);
      const storey = proposal.building.storeys.find(candidate => candidate.id === sourceSpace.storeyId)!;
      walls.push({ id: wallId, kind: 'line', storeyId: sourceSpace.storeyId, startMm: start, endMm: end, thicknessMm: scaled(proposal.construction.wallThickness, unit), heightMm: scaled(storey.height, unit) });
      const sourceOpenings = sourceSpace.openings ?? [];
      sourceOpenings.filter(opening => opening.edgeIndex === edgeIndex).forEach(opening => openings.push({ id: opening.id, kind: opening.kind, hostWallId: wallId, offsetMm: scaled(opening.offset, unit), widthMm: scaled(opening.width, unit), heightMm: scaled(opening.height, unit), sillMm: scaled(opening.sill, unit), positionMm: openingPosition(sourceSpace.boundary[edgeIndex]!, sourceSpace.boundary[(edgeIndex + 1) % sourceSpace.boundary.length]!, opening.offset, opening.sill, unit) }));
    });
    const slabId = `slab:${sourceSpace.id}`; const ceilingId = `ceiling:${sourceSpace.id}`;
    slabs.push({ id: slabId, storeyId: sourceSpace.storeyId, spaceId: sourceSpace.id, boundaryMm: structuredClone(boundaryMm), thicknessMm: scaled(proposal.construction.slabThickness, unit) });
    ceilings.push({ id: ceilingId, storeyId: sourceSpace.storeyId, spaceId: sourceSpace.id, boundaryMm: structuredClone(boundaryMm), elevationMm: scaled(proposal.building.storeys.find(storey => storey.id === sourceSpace.storeyId)!.elevation, unit) + scaled(proposal.building.storeys.find(storey => storey.id === sourceSpace.storeyId)!.height, unit), thicknessMm: scaled(proposal.construction.ceilingThickness, unit) });
    spaces.push({ id: sourceSpace.id, storeyId: sourceSpace.storeyId, name: sourceSpace.id, usage: sourceSpace.usageKey, boundaryMm, wallIds, slabId, ceilingId });
  }
  const architecture: ArchitectureDocument = { schema: 'nexyfab.architecture.v1', revision: 0, storeys: proposal.building.storeys.map(storey => ({ id: storey.id, name: storey.id, elevationMm: scaled(storey.elevation, unit), heightMm: scaled(storey.height, unit) })), spaces, walls, slabs, ceilings, openings, projectNorthDeg: proposal.coordinateFrame.rotationDeg[2], siteCoordinateSystemId: proposal.coordinateFrame.id };
  const interior: InteriorDocument = {
    schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId,
    furniture: (proposal.interior.furniture ?? []).map(item => ({ id: item.id, spaceId: item.spaceId, positionMm: item.position.map(value => scaled(value, unit)) as V3, sizeMm: item.size.map(value => scaled(value, unit)) as V3, clearanceMm: scaled(item.clearance, unit), rotationDeg: item.rotationDeg })),
    lights: (proposal.interior.lights ?? []).map(item => ({ id: item.id, spaceId: item.spaceId, hostCeilingId: `ceiling:${item.spaceId}`, positionMm: item.position.map(value => scaled(value, unit)) as V3, suspensionMm: scaled(item.suspension, unit), lumens: item.lumens, cctK: item.cctK })),
    finishes: (proposal.interior.finishes ?? []).map(item => ({ id: item.id, spaceId: item.spaceId, hostId: item.surface === 'floor' ? `slab:${item.spaceId}` : item.surface === 'ceiling' ? `ceiling:${item.spaceId}` : `wall:${item.spaceId}:0`, surface: item.surface, material: item.materialKey })),
  };
  const documentIssues = [...validateArchitectureDocument(architecture), ...validateInteriorDocument(interior, architecture)];
  if (documentIssues.length) return { ok: false, issues: [{ code: 'proposal_invalid', path: 'compiled_document' }] };
  const proposalHash = hash(proposal); const architectureContentHash = documentHash(architecture); const interiorContentHash = documentHash(interior);
  const warnings: CompiledArchitectureInteriorConcept['warnings'] = ['concept_only_no_exact_or_release_evidence', 'code_compliance_not_evaluated'];
  if ((proposal.interior.finishes ?? []).some(item => item.surface === 'wall')) warnings.push('wall_finish_host_defaulted_to_edge_zero');
  return { ok: true, result: { architecture, interior, coordinateFrame: { id: proposal.coordinateFrame.id, originMm: proposal.coordinateFrame.origin.map(value => scaled(value, unit)) as V3, rotationDeg: [...proposal.coordinateFrame.rotationDeg] as V3 }, provenance: { architecture: [{ sourceId: `proposal:${proposalHash}`, kind: 'ai', contentHash: proposalHash }], interior: [{ sourceId: `proposal:${proposalHash}`, kind: 'ai', contentHash: proposalHash }] }, hashes: { proposal: proposalHash, architecture: architectureContentHash, interior: interiorContentHash }, compilerVersion: ARCHITECTURE_INTERIOR_AI_COMPILER_VERSION, warnings } };
}
