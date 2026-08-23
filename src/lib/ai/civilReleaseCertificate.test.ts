import { describe, expect, it } from 'vitest';
import { createDesignWorkspaceRevision } from './designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from './designArtifactGraph';
import type { CivilDocument } from './civilDocument';
import { buildCivilReleaseCertificate, type BoundCivilEvidence, type CivilAxisEvidence, type CivilDeliverableEvidence, type CivilExchangeEvidence, type CivilReleaseCertificateInput } from './civilReleaseCertificate';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

const hash = (value: string) => value.repeat(64);
function civil(): CivilDocument { return {
  schema: 'nexyfab.civil.v1', revision: 0, coordinateSystemId: 'EPSG:5186', crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002', units: 'm' },
  sourceEvidence: [{ id: 'survey', kind: 'survey', sourceRef: 'private-file:survey', capturedAt: '2026-08-01T00:00:00Z', accuracyMm: 10 }],
  surveyControls: [{ id: 'cp1', name: 'CP1', positionM: [0, 0, 10], order: 'combined', evidenceId: 'survey' }, { id: 'cp2', name: 'CP2', positionM: [100, 0, 10], order: 'combined', evidenceId: 'survey' }],
  points: [{ id: 'p1', positionM: [0, 0, 10], evidenceId: 'survey' }, { id: 'p2', positionM: [100, 0, 10.5], evidenceId: 'survey' }, { id: 'p3', positionM: [0, 100, 11], evidenceId: 'survey' }],
  surfaces: [{ id: 'eg', kind: 'existing', pointIds: ['p1', 'p2', 'p3'], triangles: [['p1', 'p2', 'p3']], sourceEvidenceIds: ['survey'] }],
  alignments: [{ id: 'a1', name: 'Road', segments: [{ id: 'line', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 }] }],
  profiles: [{ id: 'pf', alignmentId: 'a1', kind: 'proposed', points: [{ stationM: 0, elevationM: 10 }, { stationM: 100, elevationM: 10.5 }] }],
  crossSections: [{ id: 'xs', alignmentId: 'a1', stationM: 0, points: [{ offsetM: -5, elevationM: 10, code: 'ETW' }, { offsetM: 5, elevationM: 10, code: 'ETW' }] }],
  corridors: [{ id: 'co', alignmentId: 'a1', profileId: 'pf', assemblyCode: '2LANE', targetSurfaceIds: ['eg'], startStationM: 0, endStationM: 100 }],
  drainageNodes: [{ id: 'n1', kind: 'manhole', positionM: [0, 0, 10], invertElevationM: 8, rimElevationM: 10 }, { id: 'n2', kind: 'outfall', positionM: [100, 0, 9], invertElevationM: 7, rimElevationM: 9 }],
  drainageLinks: [{ id: 'l1', fromNodeId: 'n1', toNodeId: 'n2', diameterMm: 450, lengthM: 100, material: 'RCP' }],
  catchments: [{ id: 'cat', boundaryM: [[0, 0], [100, 0], [0, 100]], outletNodeId: 'n1', runoffCoefficient: 0.7 }],
  structures: [{ id: 'rw', kind: 'retaining_wall', alignmentId: 'a1', stationM: 50, sourceEvidenceIds: ['survey'] }],
  stages: [{ id: 'stage', name: 'Earthworks', dependsOnStageIds: [], objectIds: ['co'] }],
}; }
function graph(): DesignArtifactGraph { return { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'civil-project', revision: 0, artifacts: ([['model', 'model', 'b'], ['drawing', 'drawing', 'c'], ['quantity', 'quantity', 'd'], ['exchange', 'ifc', 'e']] as const).map(([id, kind, content]) => ({ id, kind, revision: 0, contentHash: hash(content), state: 'current', inputs: [], staleBecause: [], verification: { status: 'passed', verifierId: `${id}-verify`, evidenceHash: hash('f'), issues: [] } })), dependencies: [] }; }
function workspace(): CadWorkspaceEnvelopeInput { const document = civil(), requirements = { roadClass: 'local' }, relations = [{ from: 'co', to: 'a1' }]; return {
  schema: CAD_WORKSPACE_ENVELOPE_SCHEMA, workspace: createDesignWorkspaceRevision({ projectId: 'civil-project', lineageId: 'civil-lineage', domain: 'civil', documentHash: hashCadPayload(document) }),
  requirements: { contentHash: hashCadPayload(requirements), payload: requirements }, semanticDocument: { schema: 'nexyfab.civil.v1', contentHash: hashCadPayload(document), payload: document },
  geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('1') }, objectRelations: { contentHash: hashCadPayload(relations), payload: relations }, artifactGraph: graph(),
  provenance: [{ sourceId: 'survey', kind: 'import', contentHash: hash('2') }], kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('3'), wasmSha256: hash('4'), stubFallback: false },
}; }
function bound<T>(payload: T): BoundCivilEvidence<T> { return { workspaceRevision: 0, modelContentHash: hash('b'), contentHash: hashCadPayload(payload), payload }; }
const axis = (): CivilAxisEvidence => ({ status: 'pass', expected: 3, checked: 3, issues: [], artifactHashes: [hash('5')] });
const exchange: CivilExchangeEvidence = { ...axis(), landXmlRoundtrip: true, ifcRoundtrip: true, crsPreserved: true, unitsPreserved: true, alignmentPreserved: true, profilePreserved: true, surfacePreserved: true };
const deliverables: CivilDeliverableEvidence = { ...axis(), requiredDrawings: 3, verifiedDrawings: 3, expectedQuantityItems: 5, verifiedQuantityItems: 5 };
function completeInput(): CivilReleaseCertificateInput { return { workspace: workspace(), earthwork: bound(axis()), structures: bound(axis()), exchange: bound(exchange), deliverables: bound(deliverables), repair: bound(axis()) }; }

describe('civil release certificate', () => {
  it('passes exactly all 22 civil axes with revision-bound evidence', () => {
    const certificate = buildCivilReleaseCertificate(completeInput());
    expect(certificate.assertions).toHaveLength(22);
    expect(certificate.assertions.every(item => item.status === 'pass')).toBe(true);
    expect(certificate).toMatchObject({ internalReady: true, releaseReady: false });
  });
  it('keeps exchange not_run when LandXML/IFC evidence is absent', () => {
    const input = completeInput(); delete input.exchange;
    const certificate = buildCivilReleaseCertificate(input);
    expect(certificate.assertions.find(item => item.axis === 'ifc_landxml_roundtrip')).toMatchObject({ status: 'not_run' });
  });
  it('fails a broken TIN instead of emitting quantities', () => {
    const input = completeInput(), document = input.workspace.semanticDocument.payload as CivilDocument;
    document.surfaces[0]!.triangles = [['p1', 'p1', 'p3']];
    input.workspace.semanticDocument.contentHash = hashCadPayload(document); input.workspace.workspace.documentHash = input.workspace.semanticDocument.contentHash;
    const certificate = buildCivilReleaseCertificate(input);
    expect(certificate.releaseReady).toBe(false);
    expect(certificate.assertions.find(item => item.axis === 'semantic_objects')).toMatchObject({ status: 'fail' });
  });
});
