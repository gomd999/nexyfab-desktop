import { validateCivilDocument, type CivilDocument } from '@/lib/ai/civilDocument';
import type { InteriorSpatialPart } from './interiorSpatialModel';

export interface CivilSpatialParameters { epsg: number; lengthM: number; corridorWidthM: number; surfaceWidthM: number; startElevationM: number; endElevationM: number; crossSlopePercent: number; drainDiameterMm: number; drainInletCount: number }
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function normalizeCivilSpatialParameters(input: CivilSpatialParameters): CivilSpatialParameters {
  const lengthM = clamp(finite(input.lengthM, 120), 10, 5000);
  const corridorWidthM = clamp(finite(input.corridorWidthM, 7), 2, 50);
  return { epsg: Number.isSafeInteger(input.epsg) && input.epsg > 0 ? input.epsg : 0, lengthM, corridorWidthM, surfaceWidthM: clamp(finite(input.surfaceWidthM, 24), corridorWidthM + 2, 200), startElevationM: clamp(finite(input.startElevationM, 10), -500, 9000), endElevationM: clamp(finite(input.endElevationM, 11.2), -500, 9000), crossSlopePercent: clamp(finite(input.crossSlopePercent, 2), .2, 15), drainDiameterMm: Math.round(clamp(finite(input.drainDiameterMm, 450), 100, 5000)), drainInletCount: Math.round(clamp(finite(input.drainInletCount, 1), 1, 20)) };
}

export function buildCivilConceptDocument(input: CivilSpatialParameters): CivilDocument {
  const p = normalizeCivilSpatialParameters(input), half = p.surfaceWidthM / 2, roadHalf = p.corridorWidthM / 2;
  return {
    schema: 'nexyfab.civil.v1', revision: 0, coordinateSystemId: p.epsg ? `EPSG:${p.epsg}:CONCEPT_UNVERIFIED` : 'CRS_NOT_CONNECTED',
    crs: { epsg: p.epsg, horizontalDatum: 'UNCONFIRMED', verticalDatum: 'UNCONFIRMED', units: 'm' },
    // Epoch is an explicit synthetic marker for a concept placeholder; it
    // must never look like a real future survey capture date.
    sourceEvidence: [{ id: 'concept-source', kind: 'survey', sourceRef: 'concept://survey-not-connected', capturedAt: '1970-01-01T00:00:00.000Z' }], surveyControls: [],
    points: [
      { id: 'p1', positionM: [0, -half, p.startElevationM], evidenceId: 'concept-source' }, { id: 'p2', positionM: [p.lengthM, -half, p.endElevationM], evidenceId: 'concept-source' },
      { id: 'p3', positionM: [p.lengthM, half, p.endElevationM], evidenceId: 'concept-source' }, { id: 'p4', positionM: [0, half, p.startElevationM], evidenceId: 'concept-source' },
    ],
    surfaces: [{ id: 'concept-surface', kind: 'existing', pointIds: ['p1', 'p2', 'p3', 'p4'], triangles: [['p1', 'p2', 'p3'], ['p1', 'p3', 'p4']], breaklines: [['p1', 'p2'], ['p4', 'p3']], sourceEvidenceIds: ['concept-source'] }],
    alignments: [{ id: 'alignment-a', name: 'Concept Alignment A', segments: [{ id: 'alignment-line', kind: 'line', startM: [0, 0], endM: [p.lengthM, 0], startStationM: 0 }] }],
    profiles: [{ id: 'profile-a', alignmentId: 'alignment-a', kind: 'proposed', points: [{ stationM: 0, elevationM: p.startElevationM }, { stationM: p.lengthM, elevationM: p.endElevationM }] }],
    crossSections: [0, p.lengthM].map((station, index) => ({ id: `xs-${index + 1}`, alignmentId: 'alignment-a', stationM: station, points: [{ offsetM: -roadHalf, elevationM: index ? p.endElevationM : p.startElevationM, code: 'ETW' }, { offsetM: 0, elevationM: (index ? p.endElevationM : p.startElevationM) + roadHalf * p.crossSlopePercent / 100, code: 'CL' }, { offsetM: roadHalf, elevationM: index ? p.endElevationM : p.startElevationM, code: 'ETW' }] })),
    corridors: [{ id: 'corridor-a', alignmentId: 'alignment-a', profileId: 'profile-a', assemblyCode: 'CONCEPT_2LANE', targetSurfaceIds: ['concept-surface'], startStationM: 0, endStationM: p.lengthM }],
    drainageNodes: [
      ...Array.from({ length: p.drainInletCount }, (_, index) => {
        const station = p.lengthM * index / p.drainInletCount;
        const elevation = p.startElevationM + (p.endElevationM - p.startElevationM) * station / p.lengthM;
        return { id: `inlet-${index + 1}`, kind: 'inlet' as const, positionM: [station, roadHalf + 1, elevation] as [number, number, number], invertElevationM: elevation - 1.2, rimElevationM: elevation };
      }),
      { id: 'outfall-1', kind: 'outfall', positionM: [p.lengthM, roadHalf + 1, p.endElevationM - 1], invertElevationM: p.endElevationM - 2.2, rimElevationM: p.endElevationM - 1 },
    ],
    drainageLinks: Array.from({ length: p.drainInletCount }, (_, index) => ({
      id: `drain-${index + 1}`, fromNodeId: `inlet-${index + 1}`,
      toNodeId: index + 1 < p.drainInletCount ? `inlet-${index + 2}` : 'outfall-1',
      diameterMm: p.drainDiameterMm, lengthM: p.lengthM / p.drainInletCount, material: 'UNCONFIRMED',
    })),
    catchments: [{ id: 'catchment-1', boundaryM: [[0, -half], [p.lengthM, -half], [p.lengthM, half], [0, half]], outletNodeId: 'inlet-1', runoffCoefficient: .7 }], structures: [],
    stages: [{ id: 'stage-1', name: 'Concept earthworks', dependsOnStageIds: [], objectIds: ['corridor-a'] }],
  };
}

export const civilConceptIssues = (document: CivilDocument) => validateCivilDocument(document);

function prism(id: string, role: string, length: number, width: number, startZ: number, endZ: number, thickness: number): InteriorSpatialPart {
  const y0 = -width / 2, y1 = width / 2;
  const verts = [[0,y0,startZ-thickness],[length,y0,endZ-thickness],[length,y1,endZ-thickness],[0,y1,startZ-thickness],[0,y0,startZ],[length,y0,endZ],[length,y1,endZ],[0,y1,startZ]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return { id, type: 'mesh', role, material: `${role}-concept`, params: { verts, faces }, at: { tx: 0, ty: 0, tz: 0 }, aabb: { min: [0,y0,startZ-thickness], max: [length,y1,endZ] } };
}

export function civilViewerParts(input: CivilSpatialParameters): InteriorSpatialPart[] {
  const p = normalizeCivilSpatialParameters(input), mm = 1000, start = p.startElevationM * mm, end = p.endElevationM * mm;
  const segmentLength = p.lengthM * mm / p.drainInletCount;
  return [
    prism('concept-surface', 'terrain', p.lengthM*mm, p.surfaceWidthM*mm, start, end, 250),
    prism('corridor-a', 'corridor', p.lengthM*mm, p.corridorWidthM*mm, start+80, end+80, 180),
    ...Array.from({ length: p.drainInletCount }, (_, index) => ({ id: `drain-${index + 1}`, type: 'box' as const, role: 'drainage', material: 'drainage-concept', params: {}, at: { tx: index * segmentLength, ty: (p.corridorWidthM/2+1)*mm, tz: start-1200 }, aabb: { min: [0,0,0] as [number, number, number], max: [segmentLength, Math.max(100,p.drainDiameterMm), Math.max(100,p.drainDiameterMm)] as [number, number, number] } })),
  ];
}
