import { describe, expect, it } from 'vitest';
import { civilDomainDocument, civilReleaseReadiness, validateCivilDocument, type CivilDocument } from '../civilDocument';

const civil = (): CivilDocument => ({
  schema: 'nexyfab.civil.v1', revision: 0, coordinateSystemId: 'site', crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'Incheon mean sea level', units: 'm' },
  sourceEvidence: [{ id: 'survey-1', kind: 'survey', sourceRef: 'file://survey.csv', capturedAt: '2026-08-01T00:00:00Z', accuracyMm: 10 }],
  surveyControls: [{ id: 'cp-1', name: 'CP1', positionM: [200000, 500000, 10], order: 'combined', evidenceId: 'survey-1' }, { id: 'cp-2', name: 'CP2', positionM: [200100, 500000, 10.2], order: 'combined', evidenceId: 'survey-1' }],
  points: [{ id: 'p1', positionM: [0, 0, 10], evidenceId: 'survey-1' }, { id: 'p2', positionM: [100, 0, 10.5], evidenceId: 'survey-1' }, { id: 'p3', positionM: [0, 100, 11], evidenceId: 'survey-1' }],
  surfaces: [{ id: 'eg', kind: 'existing', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['survey-1'] }],
  alignments: [{ id: 'road-a', name: 'Road A', segments: [{ id: 'line-1', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 }] }],
  profiles: [{ id: 'profile-a', alignmentId: 'road-a', kind: 'proposed', points: [{ stationM: 0, elevationM: 10 }, { stationM: 100, elevationM: 10.5 }] }],
  crossSections: [{ id: 'xs-0', alignmentId: 'road-a', stationM: 0, points: [{ offsetM: -5, elevationM: 10, code: 'ETW' }, { offsetM: 5, elevationM: 10, code: 'ETW' }] }],
  corridors: [{ id: 'corridor-a', alignmentId: 'road-a', profileId: 'profile-a', assemblyCode: '2LANE', targetSurfaceIds: ['eg'], startStationM: 0, endStationM: 100 }],
  drainageNodes: [{ id: 'mh-1', kind: 'manhole', positionM: [0, 0, 10], invertElevationM: 8, rimElevationM: 10 }, { id: 'out-1', kind: 'outfall', positionM: [100, 0, 9], invertElevationM: 7, rimElevationM: 9 }],
  drainageLinks: [{ id: 'pipe-1', fromNodeId: 'mh-1', toNodeId: 'out-1', diameterMm: 450, lengthM: 100, material: 'RCP' }],
  catchments: [{ id: 'cat-1', boundaryM: [[0, 0], [100, 0], [0, 100]], outletNodeId: 'mh-1', runoffCoefficient: 0.7 }],
  structures: [{ id: 'rw-1', kind: 'retaining_wall', alignmentId: 'road-a', stationM: 50, sourceEvidenceIds: ['survey-1'] }],
  stages: [{ id: 'stage-1', name: 'Earthworks', dependsOnStageIds: [], objectIds: ['corridor-a'] }],
});

describe('CivilDocument', () => {
  it('preserves survey, TIN, alignment, profile, corridor, drainage and stage semantics', () => {
    const model = civil();
    expect(validateCivilDocument(model)).toEqual([]);
    expect(Object.values(civilReleaseReadiness(model)).every(Boolean)).toBe(true);
    expect(civilDomainDocument(model).representations).toEqual(expect.arrayContaining(['tin', 'alignment', 'gis']));
  });
  it('fails closed on discontinuous alignments, broken TINs and stage cycles', () => {
    const model = civil();
    model.alignments[0]!.segments.push({ id: 'line-2', kind: 'line', startM: [101, 0], endM: [200, 0], startStationM: 100 });
    model.surfaces[0]!.triangles = [['p1', 'p1', 'p3']];
    model.stages[0]!.dependsOnStageIds = ['stage-1'];
    const issues = validateCivilDocument(model).join(' ');
    expect(issues).toContain('position-continuous');
    expect(issues).toContain('TIN triangle');
    expect(issues).toContain('dependency cycle');
  });
});
