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
  it('accepts all-id or legacy id-less PVIs, but rejects partial and duplicate stable PVI identity', () => {
    const stable = civil();
    stable.profiles[0]!.points = [{ id: 'pvi-start', stationM: 0, elevationM: 10 }, { id: 'pvi-end', stationM: 100, elevationM: 10.5 }];
    expect(validateCivilDocument(stable)).toEqual([]);
    expect(civilDomainDocument(stable).objectIds).toEqual(expect.arrayContaining(['pvi-start', 'pvi-end']));
    const partial = structuredClone(stable);
    delete partial.profiles[0]!.points[1]!.id;
    expect(validateCivilDocument(partial).join(' ')).toContain('invalid profile');
    const duplicate = structuredClone(stable);
    duplicate.profiles[0]!.points[1]!.id = 'pvi-start';
    expect(validateCivilDocument(duplicate).join(' ')).toContain('Duplicate or empty civil id pvi-start');
  });

  it('validates bounded vertical curves against an owning profile and stable PVI', () => {
    const model = civil();
    model.profiles[0]!.points = [
      { id: 'pvi-start', stationM: 0, elevationM: 10 },
      { id: 'pvi-middle', stationM: 50, elevationM: 10.2 },
      { id: 'pvi-end', stationM: 100, elevationM: 10.5 },
    ];
    model.verticalCurves = [{ id: 'vc-1', profileId: 'profile-a', pviId: 'pvi-middle', startStationM: 25, endStationM: 75, lengthM: 50 }];
    expect(validateCivilDocument(model)).toEqual([]);
    expect(civilDomainDocument(model).objectIds).toContain('vc-1');

    const invalid = structuredClone(model);
    invalid.verticalCurves = [
      { id: 'vc-1', profileId: 'profile-a', pviId: 'pvi-middle', startStationM: 25, endStationM: 75, lengthM: 49 },
      { id: 'vc-2', profileId: 'profile-a', pviId: 'pvi-middle', startStationM: 60, endStationM: 90, lengthM: 30 },
    ];
    const issues = validateCivilDocument(invalid).join(' ');
    expect(issues).toContain('invalid vertical curve');
    expect(issues).toContain('vertical curves overlap');

    const wrongOwner = structuredClone(model);
    wrongOwner.verticalCurves = [{ id: 'vc-wrong', profileId: 'missing-profile', pviId: 'pvi-middle', startStationM: 25, endStationM: 75, lengthM: 50 }];
    expect(validateCivilDocument(wrongOwner).join(' ')).toContain('profile/PVI reference');
  });

  it('validates alignment-owned superelevation regions with bounded slopes and no overlap', () => {
    const model = civil();
    model.superelevations = [{ id: 'se-1', alignmentId: 'road-a', startStationM: 10, endStationM: 40, leftCrossSlopePercent: 2.5, rightCrossSlopePercent: -2.5 }];
    expect(validateCivilDocument(model)).toEqual([]);
    expect(civilDomainDocument(model).objectIds).toContain('se-1');

    const invalid = structuredClone(model);
    invalid.superelevations = [
      { id: 'se-1', alignmentId: 'road-a', startStationM: 10, endStationM: 40, leftCrossSlopePercent: 101, rightCrossSlopePercent: -2.5 },
      { id: 'se-2', alignmentId: 'road-a', startStationM: 35, endStationM: 60, leftCrossSlopePercent: 2, rightCrossSlopePercent: -2 },
    ];
    const issues = validateCivilDocument(invalid).join(' ');
    expect(issues).toContain('bounded cross slope');
    expect(issues).toContain('superelevation regions overlap');

    const outOfRange = structuredClone(model);
    outOfRange.superelevations = [{ id: 'se-out', alignmentId: 'road-a', startStationM: -1, endStationM: 10, leftCrossSlopePercent: 2, rightCrossSlopePercent: -2 }];
    expect(validateCivilDocument(outOfRange).join(' ')).toContain('station range');

    const stationGapped = structuredClone(model);
    stationGapped.alignments[0]!.segments.push({ id: 'line-gap', kind: 'line', startM: [100, 0], endM: [200, 0], startStationM: 150 });
    stationGapped.superelevations = [{ id: 'se-gap', alignmentId: 'road-a', startStationM: 110, endStationM: 120, leftCrossSlopePercent: 2, rightCrossSlopePercent: -2 }];
    expect(validateCivilDocument(stationGapped).join(' ')).toContain('station range');
  });

  it('validates stable corridor targets by owner, kind, station range, and role overlap', () => {
    const model = civil();
    model.corridorTargets = [
      { id: 'target-surface', corridorId: 'corridor-a', kind: 'surface', targetObjectId: 'eg', startStationM: 10, endStationM: 40 },
      { id: 'target-offset', corridorId: 'corridor-a', kind: 'offset', startStationM: 40, endStationM: 60, offsetM: 3 },
    ];
    expect(validateCivilDocument(model)).toEqual([]);
    expect(civilDomainDocument(model).objectIds).toEqual(expect.arrayContaining(['target-surface', 'target-offset']));

    const notListed = structuredClone(model);
    notListed.corridors[0]!.targetSurfaceIds = [];
    expect(validateCivilDocument(notListed).join(' ')).toContain('invalid corridor target');

    const invalid = structuredClone(model);
    invalid.corridorTargets = [
      { id: 'bad-surface', corridorId: 'corridor-a', kind: 'surface', targetObjectId: 'missing-surface', startStationM: 10, endStationM: 40 },
      { id: 'bad-offset', corridorId: 'corridor-a', kind: 'offset', startStationM: 30, endStationM: 50, offsetM: 3 },
      { id: 'bad-offset-2', corridorId: 'corridor-a', kind: 'offset', startStationM: 45, endStationM: 55, offsetM: 4 },
    ];
    const issues = validateCivilDocument(invalid).join(' ');
    expect(issues).toContain('invalid corridor target');
    expect(issues).toContain('corridor targets overlap');

    const wrongOwner = structuredClone(model);
    wrongOwner.corridorTargets = [{ id: 'wrong-owner', corridorId: 'missing-corridor', kind: 'alignment', targetObjectId: 'road-a', startStationM: 10, endStationM: 20 }];
    expect(validateCivilDocument(wrongOwner).join(' ')).toContain('invalid corridor target');
  });
});
