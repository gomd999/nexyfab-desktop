import { describe, expect, it } from 'vitest';
import { civilDomainDocument, type CivilDocument } from '../civilDocument';
import { validateFederatedDomainProject } from '../federatedDomainValidation';
import { landscapeDomainDocument, type LandscapeDocument } from '../landscapeDocument';
import { analyzeUnifiedChangeImpact, type UnifiedDesignProject } from '../unifiedDesignProject';

const civil: CivilDocument = { schema: 'nexyfab.civil.v1', revision: 2, coordinateSystemId: 'site', crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'Incheon', units: 'm' }, sourceEvidence: [{ id: 'survey', kind: 'survey', sourceRef: 'survey.csv', capturedAt: '2026-08-01T00:00:00Z' }], surveyControls: [], points: [{ id: 'p1', positionM: [0, 0, 0] }, { id: 'p2', positionM: [1, 0, 0] }, { id: 'p3', positionM: [0, 1, 0] }], surfaces: [{ id: 'terrain', kind: 'existing', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['survey'] }], alignments: [], profiles: [], crossSections: [], corridors: [], drainageNodes: [], drainageLinks: [], catchments: [], structures: [], stages: [] };
const landscape: LandscapeDocument = { schema: 'nexyfab.landscape.v1', revision: 0, coordinateSystemId: 'site', terrain: { civilDocumentId: 'civil', surfaceId: 'terrain', civilRevision: 2 }, sourceEvidence: [], siteBoundaryM: [[0, 0], [1, 0], [0, 1]], plants: [], plantingZones: [], hardscapes: [{ id: 'path', kind: 'path', boundaryM: [[0, 0], [1, 0], [0, 1]], material: 'stone', slopePercent: 1, accessible: true }], soilVolumes: [], irrigationNodes: [], irrigationPipes: [], irrigationZones: [], drainagePaths: [], maintenanceZones: [] };
const project = (): UnifiedDesignProject => ({ schema: 'nexyfab.unified-design-project.v1', id: 'site-project', revision: 0, coordinateSystems: [{ id: 'site', kind: 'site', epsg: 5186, units: 'm', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }], documents: [civilDomainDocument(civil), landscapeDomainDocument(landscape)], references: [{ id: 'landscape-terrain', sourceObjectId: 'path', targetObjectId: 'terrain', relation: 'FOLLOWS_TERRAIN', updatePolicy: 'notify' }] });

describe('federated civil/landscape validation', () => {
  it('keeps documents separate while propagating terrain change impact', () => {
    const model = project();
    expect(validateFederatedDomainProject(model)).toEqual([]);
    expect(analyzeUnifiedChangeImpact(model, ['terrain']).notify).toContain('path');
  });
  it('rejects stale terrain revisions and implicit dependencies', () => {
    const model = project();
    (model.documents[1]!.payload as LandscapeDocument).terrain.civilRevision = 1;
    model.references = [];
    const issues = validateFederatedDomainProject(model).join(' ');
    expect(issues).toContain('terrain revision is stale');
    expect(issues).toContain('explicit FOLLOWS_TERRAIN');
  });
});
