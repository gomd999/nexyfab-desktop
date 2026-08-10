import {
  validateArchitectureDocument,
  type ArchitectureDocument,
  type ArchitectureOpening,
  type ArchitectureWall,
} from './architectureInteriorDocuments';
import { planWallOpeningBooleans, verifyArchitectureTopology } from './architectureTopologyVerification';
import { architectureDomainDocument } from './architectureInteriorProjectAdapter';
import { validateUnifiedDesignProject, type UnifiedDesignProject } from './unifiedDesignProject';

type V2 = [number, number];
type LineWall = Extract<ArchitectureWall, { kind: 'line' }>;
export type ArchitectureDrawingTrack = 'STR' | 'SPA' | 'OBJ' | 'OCR';
export type DrawingGateStatus = 'passed' | 'failed' | 'not_run';

export interface ArchitectureDrawingAnnotation {
  id: string;
  track: ArchitectureDrawingTrack;
  category: string;
  confidence: number;
  sourceRef: string;
  polygonPx?: V2[];
  bboxPx?: [number, number, number, number];
  text?: string;
  quarantined?: boolean;
}

export interface AuthoritativeNumber {
  value: number;
  authoritative: boolean;
  sourceRef: string;
}

export interface ArchitectureDrawingInput {
  drawingId: string;
  widthPx: number;
  heightPx: number;
  annotations: ArchitectureDrawingAnnotation[];
  scale?: {
    pixelDistance: number;
    realDistanceMm: number;
    authoritative: boolean;
    sourceRef: string;
  };
  minimumConfidence?: number;
  reprojectionTolerancePx?: number;
}

export interface ArchitectureReconstructionRequirements {
  storeyHeightMm: AuthoritativeNumber;
  wallThicknessMm: AuthoritativeNumber;
  slabThicknessMm: AuthoritativeNumber;
  ceilingElevationMm: AuthoritativeNumber;
  doorHeightMm: AuthoritativeNumber;
  windowHeightMm: AuthoritativeNumber;
  windowSillMm: AuthoritativeNumber;
  openingHostToleranceMm: AuthoritativeNumber;
  wallEvidenceToleranceMm: AuthoritativeNumber;
}

export interface ArchitectureDrawingNode {
  id: string;
  track: ArchitectureDrawingTrack;
  kind: 'wall' | 'door' | 'window' | 'space' | 'object' | 'text' | 'background' | 'unknown';
  category: string;
  confidence: number;
  sourceRef: string;
  polygonPx: V2[];
  bboxPx: [number, number, number, number];
}

export interface ArchitectureDrawingRelation {
  sourceId: string;
  targetId: string;
  kind: 'CONTAINS';
}

export interface ArchitectureDrawingGate {
  id: 'input-integrity' | 'quarantine' | 'confidence' | 'scale' | 'authoritative-inputs' | 'wall-evidence' | 'opening-host' | 'topology' | 'reprojection';
  status: DrawingGateStatus;
  reasons: string[];
}

export interface ArchitectureDrawingSemanticGraph {
  schema: 'nexyfab.architecture-drawing-graph.v1';
  drawingId: string;
  widthPx: number;
  heightPx: number;
  nodes: ArchitectureDrawingNode[];
  relations: ArchitectureDrawingRelation[];
  gates: ArchitectureDrawingGate[];
}

export interface ArchitectureSolidPlan {
  schema: 'nexyfab.architecture-solid-plan.v1';
  walls: Array<{ wallId: string; centerMm: V2; lengthMm: number; thicknessMm: number; heightMm: number; angleDeg: number }>;
  slabs: Array<{ slabId: string; boundaryMm: V2[]; thicknessMm: number }>;
  ceilings: Array<{ ceilingId: string; boundaryMm: V2[]; elevationMm: number }>;
  cuts: ReturnType<typeof planWallOpeningBooleans>;
}

export interface ArchitectureDrawingReconstructionResult {
  status: 'ready_for_exact_3d' | 'authoritative_input_required' | 'review_required' | 'blocked';
  graph: ArchitectureDrawingSemanticGraph;
  architecture: ArchitectureDocument | null;
  solidPlan: ArchitectureSolidPlan | null;
  gates: ArchitectureDrawingGate[];
  mmPerPixel: number | null;
  reprojection: { maxErrorPx: number; comparedObjects: number } | null;
}

export function architectureReconstructionUnifiedProject(
  result: ArchitectureDrawingReconstructionResult,
  projectId: string,
): { project: UnifiedDesignProject | null; issues: string[] } {
  if (result.status !== 'ready_for_exact_3d' || !result.architecture || !result.solidPlan) {
    return { project: null, issues: ['Architecture reconstruction has not passed every exact-3D gate.'] };
  }
  const document = architectureDomainDocument(result.architecture, 'architecture-drawing');
  document.semanticState = {
    status: 'deep_document_validated',
    targetSchema: 'nexyfab.architecture.v1',
    note: 'STR/SPA/OBJ/OCR graph, authoritative scale, architecture topology and reprojection gates passed.',
  };
  const project: UnifiedDesignProject = {
    schema: 'nexyfab.unified-design-project.v1', id: projectId, revision: 0,
    coordinateSystems: [{ id: 'project-local', kind: 'building', units: 'mm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }],
    documents: [document], references: [],
  };
  return { project, issues: validateUnifiedDesignProject(project) };
}

const finitePoint = (point: unknown): point is V2 => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const bboxPolygon = ([x, y, width, height]: [number, number, number, number]): V2[] => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const polygonBounds = (polygon: readonly V2[]): [number, number, number, number] => {
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return [minX, minY, maxX - minX, maxY - minY];
};
const bboxCenter = ([x, y, width, height]: [number, number, number, number]): V2 => [x + width / 2, y + height / 2];
const pointInPolygon = (point: V2, polygon: readonly V2[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!;
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const gate = (id: ArchitectureDrawingGate['id'], status: DrawingGateStatus, reasons: string[] = []): ArchitectureDrawingGate => ({ id, status, reasons });

function annotationKind(annotation: ArchitectureDrawingAnnotation): ArchitectureDrawingNode['kind'] {
  if (annotation.category === 'background') return 'background';
  if (annotation.track === 'SPA' && annotation.category.startsWith('공간_')) return 'space';
  if (annotation.track === 'OBJ' && annotation.category.startsWith('객체_')) return 'object';
  if (annotation.track === 'OCR' && annotation.category === 'OCR') return 'text';
  if (annotation.track === 'STR' && annotation.category === '구조_벽체') return 'wall';
  if (annotation.track === 'STR' && annotation.category === '구조_출입문') return 'door';
  if (annotation.track === 'STR' && annotation.category === '구조_창호') return 'window';
  return 'unknown';
}

function normalizeAnnotation(annotation: ArchitectureDrawingAnnotation): ArchitectureDrawingNode | null {
  const polygon = annotation.polygonPx?.length ? annotation.polygonPx : annotation.bboxPx ? bboxPolygon(annotation.bboxPx) : [];
  if (polygon.length < 3 || polygon.some(point => !finitePoint(point))) return null;
  return {
    id: annotation.id,
    track: annotation.track,
    kind: annotationKind(annotation),
    category: annotation.category,
    confidence: annotation.confidence,
    sourceRef: annotation.sourceRef,
    polygonPx: polygon.map(point => [...point] as V2),
    bboxPx: annotation.bboxPx ? [...annotation.bboxPx] : polygonBounds(polygon),
  };
}

export function buildArchitectureDrawingSemanticGraph(input: ArchitectureDrawingInput): ArchitectureDrawingSemanticGraph {
  const integrityReasons: string[] = [];
  if (!input.drawingId.trim() || !(input.widthPx > 0) || !(input.heightPx > 0) || !Number.isFinite(input.widthPx) || !Number.isFinite(input.heightPx)) integrityReasons.push('Drawing id and pixel dimensions must be valid.');
  const ids = new Set<string>(), nodes: ArchitectureDrawingNode[] = [];
  for (const annotation of input.annotations) {
    if (!annotation.id.trim() || ids.has(annotation.id)) integrityReasons.push(`Duplicate or empty annotation id ${annotation.id || '(empty)'}.`);
    ids.add(annotation.id);
    if (!annotation.sourceRef.trim()) integrityReasons.push(`${annotation.id}: sourceRef is required.`);
    if (!Number.isFinite(annotation.confidence) || annotation.confidence < 0 || annotation.confidence > 1) integrityReasons.push(`${annotation.id}: confidence must be within 0..1.`);
    const node = normalizeAnnotation(annotation);
    if (!node) { integrityReasons.push(`${annotation.id}: polygon or bbox geometry is required.`); continue; }
    if (node.polygonPx.some(point => point[0] < 0 || point[1] < 0 || point[0] > input.widthPx || point[1] > input.heightPx)) integrityReasons.push(`${annotation.id}: geometry is outside the drawing.`);
    if (node.kind === 'unknown') integrityReasons.push(`${annotation.id}: category ${annotation.category} does not match ${annotation.track}.`);
    nodes.push(node);
  }
  const quarantineReasons = input.annotations.filter(item => item.quarantined).map(item => `${item.id}: quarantined source ${item.sourceRef}.`);
  const minimumConfidence = input.minimumConfidence ?? 0.8;
  const confidenceReasons = nodes.filter(node => node.kind !== 'background' && node.confidence < minimumConfidence).map(node => `${node.id}: confidence ${node.confidence} is below ${minimumConfidence}.`);
  const spaces = nodes.filter(node => node.kind === 'space');
  const relations: ArchitectureDrawingRelation[] = [];
  for (const node of nodes.filter(item => item.kind === 'object' || item.kind === 'text')) {
    const center = bboxCenter(node.bboxPx);
    for (const space of spaces) if (pointInPolygon(center, space.polygonPx)) relations.push({ sourceId: node.id, targetId: space.id, kind: 'CONTAINS' });
  }
  return {
    schema: 'nexyfab.architecture-drawing-graph.v1', drawingId: input.drawingId, widthPx: input.widthPx, heightPx: input.heightPx, nodes, relations,
    gates: [
      gate('input-integrity', integrityReasons.length ? 'failed' : 'passed', integrityReasons),
      gate('quarantine', quarantineReasons.length ? 'failed' : 'passed', quarantineReasons),
      gate('confidence', confidenceReasons.length ? 'not_run' : 'passed', confidenceReasons),
    ],
  };
}

function validAuthoritative(value: AuthoritativeNumber | undefined, allowZero = false) {
  return !!value && value.authoritative && Boolean(value.sourceRef.trim()) && Number.isFinite(value.value) && (allowZero ? value.value >= 0 : value.value > 0);
}

function distancePointToSegment(point: V2, start: V2, end: V2) {
  const dx = end[0] - start[0], dy = end[1] - start[1], denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator)) : 0;
  const projected: V2 = [start[0] + dx * t, start[1] + dy * t];
  return { distance: Math.hypot(point[0] - projected[0], point[1] - projected[1]), t, projected };
}

function wallKey(start: V2, end: V2) {
  const pointKey = (point: V2) => `${Math.round(point[0] * 100) / 100},${Math.round(point[1] * 100) / 100}`;
  const a = pointKey(start), b = pointKey(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function reconstructArchitectureDrawing(input: ArchitectureDrawingInput, requirements: ArchitectureReconstructionRequirements): ArchitectureDrawingReconstructionResult {
  const graph = buildArchitectureDrawingSemanticGraph(input), gates = [...graph.gates];
  const blockingGraph = graph.gates.some(item => item.status === 'failed');
  const reviewGraph = graph.gates.some(item => item.status === 'not_run');
  const scaleValid = !!input.scale && input.scale.authoritative && Boolean(input.scale.sourceRef.trim()) && input.scale.pixelDistance > 0 && input.scale.realDistanceMm > 0 && Number.isFinite(input.scale.pixelDistance) && Number.isFinite(input.scale.realDistanceMm);
  gates.push(gate('scale', scaleValid ? 'passed' : 'not_run', scaleValid ? [] : ['An authoritative measured drawing scale is required.']));
  const requiredEntries = Object.entries(requirements) as Array<[keyof ArchitectureReconstructionRequirements, AuthoritativeNumber]>;
  const missingRequirements = requiredEntries.filter(([key, value]) => !validAuthoritative(value, key === 'windowSillMm')).map(([key]) => `${key} requires an authoritative finite value and sourceRef.`);
  gates.push(gate('authoritative-inputs', missingRequirements.length ? 'not_run' : 'passed', missingRequirements));
  if (blockingGraph) return { status: 'blocked', graph, architecture: null, solidPlan: null, gates, mmPerPixel: null, reprojection: null };
  if (reviewGraph) return { status: 'review_required', graph, architecture: null, solidPlan: null, gates, mmPerPixel: scaleValid ? input.scale!.realDistanceMm / input.scale!.pixelDistance : null, reprojection: null };
  if (!scaleValid || missingRequirements.length) return { status: 'authoritative_input_required', graph, architecture: null, solidPlan: null, gates, mmPerPixel: scaleValid ? input.scale!.realDistanceMm / input.scale!.pixelDistance : null, reprojection: null };

  const mmPerPixel = input.scale!.realDistanceMm / input.scale!.pixelDistance;
  const toMm = (point: V2): V2 => [point[0] * mmPerPixel, (input.heightPx - point[1]) * mmPerPixel];
  const toPx = (point: V2): V2 => [point[0] / mmPerPixel, input.heightPx - point[1] / mmPerPixel];
  const spaces = graph.nodes.filter(node => node.kind === 'space');
  if (!spaces.length) {
    gates.push(gate('topology', 'not_run', ['At least one SPA space polygon is required.']));
    return { status: 'review_required', graph, architecture: null, solidPlan: null, gates, mmPerPixel, reprojection: null };
  }

  const walls: LineWall[] = [], wallByKey = new Map<string, LineWall>();
  const documentSpaces: ArchitectureDocument['spaces'] = [], slabs: ArchitectureDocument['slabs'] = [], ceilings: ArchitectureDocument['ceilings'] = [];
  const sourceSpaceById = new Map<string, ArchitectureDrawingNode>();
  for (const [spaceIndex, source] of spaces.entries()) {
    const boundaryMm = source.polygonPx.map(toMm), wallIds: string[] = [];
    for (let edgeIndex = 0; edgeIndex < boundaryMm.length; edgeIndex++) {
      const startMm = boundaryMm[edgeIndex]!, endMm = boundaryMm[(edgeIndex + 1) % boundaryMm.length]!, key = wallKey(startMm, endMm);
      let wall = wallByKey.get(key);
      if (!wall) {
        wall = { id: `wall-${walls.length + 1}`, kind: 'line', storeyId: 'storey-1', startMm, endMm, thicknessMm: requirements.wallThicknessMm.value, heightMm: requirements.storeyHeightMm.value };
        walls.push(wall); wallByKey.set(key, wall);
      }
      wallIds.push(wall.id);
    }
    const id = `space-${spaceIndex + 1}`, slabId = `slab-${spaceIndex + 1}`, ceilingId = `ceiling-${spaceIndex + 1}`;
    documentSpaces.push({ id, storeyId: 'storey-1', name: source.category.replace(/^공간_/, ''), usage: source.category, boundaryMm, wallIds, slabId, ceilingId });
    slabs.push({ id: slabId, storeyId: 'storey-1', spaceId: id, boundaryMm, thicknessMm: requirements.slabThicknessMm.value });
    ceilings.push({ id: ceilingId, storeyId: 'storey-1', spaceId: id, boundaryMm, elevationMm: requirements.ceilingElevationMm.value });
    sourceSpaceById.set(id, source);
  }

  const wallEvidence = graph.nodes.filter(node => node.kind === 'wall');
  const unmatchedWalls = walls.filter(wall => {
    const wallCenter: V2 = [(wall.startMm[0] + wall.endMm[0]) / 2, (wall.startMm[1] + wall.endMm[1]) / 2];
    const wallAngle = Math.atan2(wall.endMm[1] - wall.startMm[1], wall.endMm[0] - wall.startMm[0]) * 180 / Math.PI;
    return !wallEvidence.some(source => {
      const evidenceCenter = toMm(bboxCenter(source.bboxPx));
      const evidenceAngle = source.bboxPx[2] >= source.bboxPx[3] ? 0 : 90;
      const angleDelta = Math.abs(((wallAngle - evidenceAngle + 90) % 180 + 180) % 180 - 90);
      return distancePointToSegment(evidenceCenter, wall.startMm, wall.endMm).distance <= requirements.wallEvidenceToleranceMm.value
        && angleDelta <= 10
        && distancePointToSegment(wallCenter, toMm(source.polygonPx[0]!), toMm(source.polygonPx[2]!)).distance <= Math.max(requirements.wallEvidenceToleranceMm.value, Math.hypot(source.bboxPx[2], source.bboxPx[3]) * mmPerPixel / 2);
    });
  });
  gates.push(gate('wall-evidence', unmatchedWalls.length ? 'not_run' : 'passed', unmatchedWalls.map(wall => `${wall.id}: no matching STR wall evidence.`)));

  const openings: ArchitectureOpening[] = [], openingReasons: string[] = [], openingSources = graph.nodes.filter(node => node.kind === 'door' || node.kind === 'window');
  for (const [index, source] of openingSources.entries()) {
    const centerMm = toMm(bboxCenter(source.bboxPx));
    const candidates = walls.map(wall => ({ wall, ...distancePointToSegment(centerMm, wall.startMm, wall.endMm) })).sort((a, b) => a.distance - b.distance);
    const nearest = candidates[0];
    if (!nearest || nearest.distance > requirements.openingHostToleranceMm.value) { openingReasons.push(`${source.id}: no wall within opening host tolerance.`); continue; }
    const dx = nearest.wall.endMm[0] - nearest.wall.startMm[0], dy = nearest.wall.endMm[1] - nearest.wall.startMm[1], length = Math.hypot(dx, dy);
    const widthMm = (Math.abs(dx / length) * source.bboxPx[2] + Math.abs(dy / length) * source.bboxPx[3]) * mmPerPixel;
    const connectsSpaceIds = documentSpaces.filter(space => space.wallIds.includes(nearest.wall.id)).map(space => space.id).slice(0, 2);
    const isDoor = source.kind === 'door';
    openings.push({
      id: `opening-${index + 1}`, kind: isDoor ? 'door' : 'window', hostWallId: nearest.wall.id,
      offsetMm: nearest.t * length, widthMm,
      heightMm: isDoor ? requirements.doorHeightMm.value : requirements.windowHeightMm.value,
      sillMm: isDoor ? 0 : requirements.windowSillMm.value,
      positionMm: [nearest.projected[0], nearest.projected[1], isDoor ? 0 : requirements.windowSillMm.value],
      ...(connectsSpaceIds.length ? { connectsSpaceIds } : {}),
      ...(isDoor && connectsSpaceIds.length === 1 ? { isExit: true } : {}),
    });
  }
  gates.push(gate('opening-host', openingReasons.length ? 'failed' : 'passed', openingReasons));

  const architecture: ArchitectureDocument = {
    schema: 'nexyfab.architecture.v1', revision: 0,
    storeys: [{ id: 'storey-1', name: 'Level 1', elevationMm: 0, heightMm: requirements.storeyHeightMm.value }],
    spaces: documentSpaces, walls, slabs, ceilings, openings,
    siteCoordinateSystemId: 'project-local',
  };
  const documentIssues = validateArchitectureDocument(architecture);
  const topology = verifyArchitectureTopology(architecture);
  const topologyReasons = [...documentIssues, ...topology.gates.filter(item => item.status !== 'passed').flatMap(item => item.reasons)];
  gates.push(gate('topology', topologyReasons.length ? 'failed' : 'passed', topologyReasons));

  let maxErrorPx = 0, comparedObjects = 0;
  for (const space of architecture.spaces) {
    const source = sourceSpaceById.get(space.id)!;
    for (let index = 0; index < space.boundaryMm.length; index++) {
      const projected = toPx(space.boundaryMm[index]!), expected = source.polygonPx[index]!;
      maxErrorPx = Math.max(maxErrorPx, Math.hypot(projected[0] - expected[0], projected[1] - expected[1]));
      comparedObjects++;
    }
  }
  for (let index = 0; index < openings.length; index++) {
    const projected = toPx([openings[index]!.positionMm[0], openings[index]!.positionMm[1]]), expected = bboxCenter(openingSources[index]!.bboxPx);
    maxErrorPx = Math.max(maxErrorPx, Math.hypot(projected[0] - expected[0], projected[1] - expected[1]));
    comparedObjects++;
  }
  const reprojectionTolerance = input.reprojectionTolerancePx ?? 2;
  const reprojectionReasons = maxErrorPx <= reprojectionTolerance ? [] : [`Maximum reprojection error ${maxErrorPx.toFixed(3)}px exceeds ${reprojectionTolerance}px.`];
  gates.push(gate('reprojection', reprojectionReasons.length ? 'failed' : 'passed', reprojectionReasons));

  const blocking = gates.some(item => item.status === 'failed');
  const notRun = gates.some(item => item.status === 'not_run');
  if (blocking || notRun) return { status: blocking ? 'blocked' : 'review_required', graph, architecture, solidPlan: null, gates, mmPerPixel, reprojection: { maxErrorPx, comparedObjects } };
  const solidPlan: ArchitectureSolidPlan = {
    schema: 'nexyfab.architecture-solid-plan.v1',
    walls: walls.map(wall => {
      if (wall.kind !== 'line') throw new Error('Drawing reconstruction currently emits line walls only.');
      const dx = wall.endMm[0] - wall.startMm[0], dy = wall.endMm[1] - wall.startMm[1];
      return { wallId: wall.id, centerMm: [(wall.startMm[0] + wall.endMm[0]) / 2, (wall.startMm[1] + wall.endMm[1]) / 2], lengthMm: Math.hypot(dx, dy), thicknessMm: wall.thicknessMm, heightMm: wall.heightMm, angleDeg: Math.atan2(dy, dx) * 180 / Math.PI };
    }),
    slabs: slabs.map(item => ({ slabId: item.id, boundaryMm: item.boundaryMm, thicknessMm: item.thicknessMm })),
    ceilings: ceilings.map(item => ({ ceilingId: item.id, boundaryMm: item.boundaryMm, elevationMm: item.elevationMm })),
    cuts: planWallOpeningBooleans(architecture),
  };
  return { status: 'ready_for_exact_3d', graph, architecture, solidPlan, gates, mmPerPixel, reprojection: { maxErrorPx, comparedObjects } };
}
