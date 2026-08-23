import { validateLandscapeDocument, type LandscapeDocument } from '@/lib/ai/landscapeDocument';
import type { InteriorSpatialPart } from './interiorSpatialModel';

export interface LandscapeSpatialParameters {
  widthM: number;
  depthM: number;
  pathWidthM: number;
  treeRows: number;
  treeColumns: number;
  canopyDiameterM: number;
  installedHeightM: number;
  soilDepthM: number;
  gradePercent: number;
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function normalizeLandscapeSpatialParameters(input: LandscapeSpatialParameters): LandscapeSpatialParameters {
  const widthM = clamp(finite(input.widthM, 30), 6, 500);
  const depthM = clamp(finite(input.depthM, 24), 6, 500);
  return {
    widthM,
    depthM,
    pathWidthM: clamp(finite(input.pathWidthM, 2.4), 1, Math.max(1, widthM * 0.45)),
    treeRows: Math.round(clamp(finite(input.treeRows, 3), 1, 20)),
    treeColumns: Math.round(clamp(finite(input.treeColumns, 4), 1, 20)),
    canopyDiameterM: clamp(finite(input.canopyDiameterM, 4), 0.5, Math.min(20, widthM / 2, depthM / 2)),
    installedHeightM: clamp(finite(input.installedHeightM, 3), 0.5, 20),
    soilDepthM: clamp(finite(input.soilDepthM, 1.2), 0.2, 5),
    gradePercent: clamp(finite(input.gradePercent, 1.5), 0.2, 15),
  };
}

export function buildLandscapeConceptDocument(input: LandscapeSpatialParameters): LandscapeDocument {
  const p = normalizeLandscapeSpatialParameters(input);
  const pathLeft = (p.widthM - p.pathWidthM) / 2;
  const pathRight = pathLeft + p.pathWidthM;
  const plants: LandscapeDocument['plants'] = [];
  const leftColumns = Math.ceil(p.treeColumns / 2);
  const rightColumns = Math.floor(p.treeColumns / 2);
  for (let row = 0; row < p.treeRows; row += 1) {
    const y = (row + 1) * p.depthM / (p.treeRows + 1);
    for (let column = 0; column < p.treeColumns; column += 1) {
      const onLeft = column % 2 === 0;
      const lane = Math.floor(column / 2);
      const bandWidth = onLeft ? pathLeft : p.widthM - pathRight;
      const laneCount = onLeft ? leftColumns : rightColumns;
      const x = onLeft
        ? (lane + 1) * bandWidth / (laneCount + 1)
        : pathRight + (lane + 1) * bandWidth / (laneCount + 1);
      plants.push({
        id: `tree-${row + 1}-${column + 1}`,
        speciesCode: 'CONCEPT-TREE',
        positionM: [x, y, y * p.gradePercent / 100],
        installedHeightM: p.installedHeightM,
        matureCanopyDiameterM: p.canopyDiameterM,
        rootZoneDiameterM: Math.max(0.5, p.canopyDiameterM * 0.65),
        spacingM: p.canopyDiameterM,
        evidenceIds: ['concept-plant-source'],
      });
    }
  }
  const boundary: Array<[number, number]> = [[0, 0], [p.widthM, 0], [p.widthM, p.depthM], [0, p.depthM]];
  return {
    schema: 'nexyfab.landscape.v1', revision: 0, coordinateSystemId: 'CONCEPT_LOCAL_UNVERIFIED',
    terrain: { civilDocumentId: 'CIVIL_NOT_CONNECTED', surfaceId: 'SURFACE_NOT_CONNECTED', civilRevision: 0 },
    sourceEvidence: [{ id: 'concept-plant-source', kind: 'nursery', sourceRef: 'concept://unverified-species-selection', capturedAt: '2026-08-13T00:00:00.000Z' }],
    siteBoundaryM: boundary,
    plants,
    soilVolumes: [{ id: 'concept-soil', boundaryM: boundary.map(point => [...point]), depthM: p.soilDepthM, soilType: 'UNCONFIRMED', drainageClass: 'UNCONFIRMED' }],
    plantingZones: [{ id: 'concept-planting-zone', boundaryM: boundary.map(point => [...point]), plantIds: plants.map(plant => plant.id), soilVolumeId: 'concept-soil', targetCoveragePercent: 60 }],
    hardscapes: [{ id: 'central-path', kind: 'path', boundaryM: [[pathLeft, 0], [pathRight, 0], [pathRight, p.depthM], [pathLeft, p.depthM]], material: 'UNCONFIRMED', slopePercent: p.gradePercent, accessible: false }],
    irrigationNodes: [], irrigationPipes: [], irrigationZones: [],
    drainagePaths: [{ id: 'concept-flow', pointsM: [[p.widthM * 0.1, p.depthM, p.depthM * p.gradePercent / 100], [p.widthM * 0.1, 0, 0]], outletObjectId: 'OUTLET_NOT_CONNECTED', minimumSlopePercent: p.gradePercent }],
    maintenanceZones: [{ id: 'concept-maintenance', boundaryM: boundary.map(point => [...point]), accessWidthM: p.pathWidthM, taskCodes: ['CONCEPT_REVIEW'] }],
  };
}

export function landscapeConceptIssues(document: LandscapeDocument): string[] {
  return validateLandscapeDocument(document);
}

function slopedPrism(id: string, role: string, x0: number, x1: number, depth: number, rise: number, thickness: number): InteriorSpatialPart {
  const verts = [[x0, 0, -thickness], [x1, 0, -thickness], [x1, depth, rise - thickness], [x0, depth, rise - thickness], [x0, 0, 0], [x1, 0, 0], [x1, depth, rise], [x0, depth, rise]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { id, type: 'mesh', role, material: `${role}-concept`, params: { verts, faces }, at: { tx: 0, ty: 0, tz: 0 }, aabb: { min: [x0, 0, -thickness], max: [x1, depth, rise] } };
}

function cylinder(id: string, role: string, radius: number, height: number, x: number, y: number, z: number): InteriorSpatialPart {
  const segments = 10;
  const verts: number[][] = [[0, 0, 0], [0, 0, height]];
  const faces: number[][] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = index * Math.PI * 2 / segments;
    verts.push([Math.cos(angle) * radius, Math.sin(angle) * radius, 0], [Math.cos(angle) * radius, Math.sin(angle) * radius, height]);
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const b0 = 2 + index * 2, t0 = b0 + 1, b1 = 2 + next * 2, t1 = b1 + 1;
    faces.push([0, b1, b0], [1, t0, t1], [b0, b1, t1], [b0, t1, t0]);
  }
  return { id, type: 'mesh', role, material: `${role}-concept`, params: { verts, faces }, at: { tx: x, ty: y, tz: z }, aabb: { min: [-radius, -radius, 0], max: [radius, radius, height] } };
}

function ellipsoid(id: string, role: string, radius: number, height: number, x: number, y: number, z: number): InteriorSpatialPart {
  const segments = 12, rings = 5;
  const verts: number[][] = [[0, 0, height / 2]];
  const faces: number[][] = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const phi = ring * Math.PI / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = segment * Math.PI * 2 / segments;
      verts.push([Math.sin(phi) * Math.cos(theta) * radius, Math.sin(phi) * Math.sin(theta) * radius, Math.cos(phi) * height / 2]);
    }
  }
  const bottom = verts.push([0, 0, -height / 2]) - 1;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    faces.push([0, 1 + segment, 1 + next]);
    for (let ring = 0; ring < rings - 2; ring += 1) {
      const a = 1 + ring * segments + segment, b = 1 + ring * segments + next;
      const c = a + segments, d = b + segments;
      faces.push([a, c, d], [a, d, b]);
    }
    const last = 1 + (rings - 2) * segments;
    faces.push([bottom, last + next, last + segment]);
  }
  return { id, type: 'mesh', role, material: `${role}-concept`, params: { verts, faces }, at: { tx: x, ty: y, tz: z }, aabb: { min: [-radius, -radius, -height / 2], max: [radius, radius, height / 2] } };
}

export function landscapeViewerParts(document: LandscapeDocument, input: LandscapeSpatialParameters): InteriorSpatialPart[] {
  const p = normalizeLandscapeSpatialParameters(input);
  const mm = 1000;
  const rise = p.depthM * p.gradePercent / 100 * mm;
  const path = document.hardscapes[0]!;
  const pathXs = path.boundaryM.map(point => point[0] * mm);
  const parts: InteriorSpatialPart[] = [
    slopedPrism('concept-terrain', 'terrain', 0, p.widthM * mm, p.depthM * mm, rise, 120),
    slopedPrism('central-path', 'hardscape', Math.min(...pathXs), Math.max(...pathXs), p.depthM * mm, rise + 35, 80),
  ];
  document.plants.forEach(plant => {
    const [xM, yM, zM] = plant.positionM;
    const trunkHeight = plant.installedHeightM * mm * 0.65;
    const trunkWidth = Math.max(120, plant.installedHeightM * 80);
    const canopy = plant.matureCanopyDiameterM * mm;
    parts.push(cylinder(`${plant.id}-trunk`, 'plant-trunk', trunkWidth / 2, trunkHeight, xM * mm, yM * mm, zM * mm));
    parts.push(ellipsoid(`${plant.id}-canopy`, 'plant-canopy', canopy / 2, canopy * 0.65, xM * mm, yM * mm, zM * mm + trunkHeight + canopy * 0.325));
  });
  return parts;
}
