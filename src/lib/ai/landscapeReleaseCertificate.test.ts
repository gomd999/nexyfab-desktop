import { describe, expect, it } from 'vitest';
import { createDesignWorkspaceRevision } from './designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from './designArtifactGraph';
import type { LandscapeDocument } from './landscapeDocument';
import { buildLandscapeReleaseCertificate, type BoundLandscapeEvidence, type LandscapeAxisEvidence, type LandscapeDeliverableEvidence, type LandscapeReleaseCertificateInput, type LandscapeTerrainAuthorityEvidence } from './landscapeReleaseCertificate';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

const hash = (value: string) => value.repeat(64);
function landscape(): LandscapeDocument { return {
  schema: 'nexyfab.landscape.v1', revision: 0, coordinateSystemId: 'EPSG:5186', terrain: { civilDocumentId: 'civil', surfaceId: 'eg', civilRevision: 2 },
  sourceEvidence: [{ id: 'nursery', kind: 'nursery', sourceRef: 'catalog:2026', capturedAt: '2026-08-01T00:00:00Z' }], siteBoundaryM: [[0, 0], [100, 0], [100, 100], [0, 100]],
  plants: [{ id: 'tree', speciesCode: 'ZEL-SER', positionM: [10, 10, 10], installedHeightM: 3, matureCanopyDiameterM: 8, rootZoneDiameterM: 5, spacingM: 8, evidenceIds: ['nursery'] }],
  soilVolumes: [{ id: 'soil', boundaryM: [[5, 5], [15, 5], [15, 15], [5, 15]], depthM: 1.2, soilType: 'loam', drainageClass: 'well-drained' }],
  plantingZones: [{ id: 'zone', boundaryM: [[5, 5], [15, 5], [15, 15], [5, 15]], plantIds: ['tree'], soilVolumeId: 'soil', targetCoveragePercent: 70 }],
  hardscapes: [{ id: 'path', kind: 'path', boundaryM: [[0, 0], [20, 0], [20, 2], [0, 2]], material: 'paver', slopePercent: 1.5, accessible: true }],
  irrigationNodes: [{ id: 'source', kind: 'source', positionM: [0, 0, 10], pressureKpa: 300, flowLpm: 30 }, { id: 'valve', kind: 'valve', positionM: [5, 5, 10] }, { id: 'emitter', kind: 'emitter', positionM: [10, 10, 10] }],
  irrigationPipes: [{ id: 'pipe1', fromNodeId: 'source', toNodeId: 'valve', diameterMm: 25, lengthM: 10 }, { id: 'pipe2', fromNodeId: 'valve', toNodeId: 'emitter', diameterMm: 16, lengthM: 8 }],
  irrigationZones: [{ id: 'irrigation', valveNodeId: 'valve', emitterNodeIds: ['emitter'], plantingZoneIds: ['zone'], designFlowLpm: 10 }],
  drainagePaths: [{ id: 'swale', pointsM: [[0, 0, 10], [100, 0, 9]], outletObjectId: 'civil:outfall', minimumSlopePercent: 1 }],
  maintenanceZones: [{ id: 'maintenance', boundaryM: [[0, 0], [20, 0], [20, 20], [0, 20]], accessWidthM: 2, taskCodes: ['PRUNE'] }],
}; }
function graph(): DesignArtifactGraph { return { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'landscape-project', revision: 0, artifacts: ([['model', 'model', 'b'], ['drawing', 'drawing', 'c'], ['quantity', 'quantity', 'd']] as const).map(([id, kind, content]) => ({ id, kind, revision: 0, contentHash: hash(content), state: 'current', inputs: [], staleBecause: [], verification: { status: 'passed', verifierId: `${id}-verify`, evidenceHash: hash('f'), issues: [] } })), dependencies: [] }; }
function workspace(): CadWorkspaceEnvelopeInput { const document = landscape(), requirements = { program: 'site landscape' }, relations = [{ from: 'path', to: 'eg', relation: 'FOLLOWS_TERRAIN' }]; return {
  schema: CAD_WORKSPACE_ENVELOPE_SCHEMA, workspace: createDesignWorkspaceRevision({ projectId: 'landscape-project', lineageId: 'landscape-lineage', domain: 'landscape', documentHash: hashCadPayload(document) }),
  requirements: { contentHash: hashCadPayload(requirements), payload: requirements }, semanticDocument: { schema: document.schema, contentHash: hashCadPayload(document), payload: document },
  geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('1') }, objectRelations: { contentHash: hashCadPayload(relations), payload: relations }, artifactGraph: graph(),
  provenance: [{ sourceId: 'nursery', kind: 'catalog', contentHash: hash('2') }], kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('3'), wasmSha256: hash('4'), stubFallback: false },
}; }
function bound<T>(payload: T): BoundLandscapeEvidence<T> { return { workspaceRevision: 0, modelContentHash: hash('b'), contentHash: hashCadPayload(payload), payload }; }
const axis = (): LandscapeAxisEvidence => ({ status: 'pass', expected: 3, checked: 3, issues: [], artifactHashes: [hash('5')] });
const terrain = (): LandscapeTerrainAuthorityEvidence => ({ ...axis(), civilDocumentId: 'civil', civilDocumentContentHash: hash('6'), civilRevision: 2, surfaceId: 'eg', surfaceContentHash: hash('7'), coordinateSystemId: 'EPSG:5186', epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002', units: 'm', federatedValidationIssues: [] });
const deliverables = (): LandscapeDeliverableEvidence => ({ ...axis(), requiredDrawings: 3, verifiedDrawings: 3, expectedScheduleRows: 8, verifiedScheduleRows: 8, expectedQuantityItems: 5, verifiedQuantityItems: 5 });
function completeInput(): LandscapeReleaseCertificateInput { return { workspace: workspace(), terrainAuthority: bound(terrain()), grading: bound(axis()), surfaceFlow: bound(axis()), matureClearance: bound(axis()), irrigation: bound(axis()), deliverables: bound(deliverables()), repair: bound(axis()) }; }

describe('landscape release certificate', () => {
  it('passes exactly all 20 landscape axes with authoritative civil terrain evidence', () => {
    const certificate = buildLandscapeReleaseCertificate(completeInput());
    expect(certificate.assertions).toHaveLength(20);
    expect(certificate.assertions.every(item => item.status === 'pass')).toBe(true);
    expect(certificate.releaseReady).toBe(true);
  });
  it('fails when the civil terrain revision is stale', () => {
    const input = completeInput(), stale = terrain(); stale.civilRevision = 1; input.terrainAuthority = bound(stale);
    const certificate = buildLandscapeReleaseCertificate(input);
    expect(certificate.releaseReady).toBe(false);
    expect(certificate.assertions.find(item => item.axis === 'revision_integrity')).toMatchObject({ status: 'fail' });
  });
  it('keeps irrigation not_run when capacity evidence is absent', () => {
    const input = completeInput(); delete input.irrigation;
    expect(buildLandscapeReleaseCertificate(input).assertions.find(item => item.axis === 'irrigation')).toMatchObject({ status: 'not_run' });
  });
  it('fails release when a drawing artifact is stale', () => {
    const input = completeInput(), drawing = input.workspace.artifactGraph.artifacts.find(item => item.kind === 'drawing')!;
    drawing.state = 'stale'; drawing.verification.status = 'not_run'; drawing.verification.evidenceHash = undefined; drawing.staleBecause = ['model'];
    const certificate = buildLandscapeReleaseCertificate(input);
    expect(certificate.releaseReady).toBe(false);
    expect(certificate.assertions.find(item => item.axis === 'output_consistency')).toMatchObject({ status: 'fail' });
  });
});
