import { describe, expect, it } from 'vitest';
import { verifyCrossDomainDesign } from './crossDomainVerification';
import { createDesignWorkspaceRevision } from './designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from './designArtifactGraph';
import type { ArchitectureDocument } from './architectureInteriorDocuments';
import {
  buildBuildingReleaseCertificate,
  type BoundBuildingEvidence,
  type BuildingAxisEvidence,
  type BuildingDeliverableEvidence,
  type BuildingRegistryPolicyEvidence,
  type BuildingReleaseCertificateInput,
  type BuildingSiteCoordinateEvidence,
} from './buildingReleaseCertificate';
import type { IfcDeepSemanticRoundtripReport, IfcDeepSemanticSnapshot } from '@/lib/bim/ifcDeepSemanticRoundtrip';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

const hash = (value: string) => value.repeat(64);

function architecture(): ArchitectureDocument {
  const boundary: [number, number][] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
  return {
    schema: 'nexyfab.architecture.v1', revision: 0,
    siteCoordinateSystemId: 'EPSG:5186', projectNorthDeg: 12,
    storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }],
    grids: [{ id: 'g1', name: 'A', axis: 'x', startMm: [0, 0], endMm: [4000, 0] }],
    spaces: [{ id: 'r1', storeyId: 'l1', name: 'Office', usage: 'office', boundaryMm: boundary, wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 's1', ceilingId: 'c1' }],
    walls: [
      { id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 },
      { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
      { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 },
      { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
    ],
    slabs: [{ id: 's1', storeyId: 'l1', spaceId: 'r1', boundaryMm: boundary, thicknessMm: 180 }],
    ceilings: [{ id: 'c1', storeyId: 'l1', spaceId: 'r1', boundaryMm: boundary, elevationMm: 2600 }],
    openings: [{ id: 'd1', kind: 'door', hostWallId: 'w1', offsetMm: 2000, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [2000, 0, 0], connectsSpaceIds: ['r1'], isExit: true }],
  };
}

function graph(): DesignArtifactGraph {
  const values = [
    ['model', 'model', 'b'], ['drawing', 'drawing', 'c'], ['quantity', 'quantity', 'd'], ['ifc', 'ifc', 'e'],
  ] as const;
  return {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'building-project', revision: 0,
    artifacts: values.map(([id, kind, content]) => ({
      id, kind, revision: 0, contentHash: hash(content), state: 'current', inputs: [], staleBecause: [],
      verification: { status: 'passed', verifierId: `${id}-verifier`, evidenceHash: hash('f'), issues: [] },
    })),
    dependencies: [],
  };
}

function workspace(): CadWorkspaceEnvelopeInput {
  const document = architecture();
  const requirements = { programme: 'office', occupancy: 10 };
  const relations = [{ from: 'd1', to: 'w1', type: 'hosted_by' }];
  return {
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace: createDesignWorkspaceRevision({ projectId: 'building-project', lineageId: 'building-lineage', domain: 'building', documentHash: hashCadPayload(document) }),
    requirements: { contentHash: hashCadPayload(requirements), payload: requirements },
    semanticDocument: { schema: 'nexyfab.architecture.v1', contentHash: hashCadPayload(document), payload: document },
    geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('1') },
    objectRelations: { contentHash: hashCadPayload(relations), payload: relations },
    artifactGraph: graph(),
    provenance: [{ sourceId: 'architect-input', kind: 'expert', contentHash: hash('2') }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('3'), wasmSha256: hash('4'), stubFallback: false },
  };
}

function bound<T>(payload: T): BoundBuildingEvidence<T> {
  return { workspaceRevision: 0, modelContentHash: hash('b'), contentHash: hashCadPayload(payload), payload };
}

const axis = (): BuildingAxisEvidence => ({ status: 'pass', expected: 4, checked: 4, issues: [], artifactHashes: [hash('5')] });
const site: BuildingSiteCoordinateEvidence = {
  status: 'pass', linearUnit: 'mm', angularUnit: 'deg', crsId: 'EPSG:5186', verticalDatumId: 'KVD2002', projectNorthDeg: 12,
  projectToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 2000, 30, 1], issues: [], artifactHashes: [hash('6')],
};
const deliverables: BuildingDeliverableEvidence = {
  ...axis(), requiredDrawings: 4, verifiedDrawings: 4, expectedScheduleRows: 8, verifiedScheduleRows: 8,
  expectedQuantityItems: 6, verifiedQuantityItems: 6,
};
const registry: BuildingRegistryPolicyEvidence = {
  status: 'quarantined', usedForRelease: false, sourceIssueCount: 2303, issues: ['source_workbooks_not_authoritative'], artifactHashes: [hash('7')],
};
const snapshot: IfcDeepSemanticSnapshot = {
  schema: 'IFC4', occurrences: [{ globalId: 'wall-guid', ifcClass: 'IFCWALL', parentGlobalId: 'storey-guid' }],
  placements: [{ globalId: 'wall-guid', status: 'available', worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  propertySets: [{ occurrenceGlobalId: 'wall-guid', psetGlobalId: 'pset-guid', name: 'Pset_WallCommon', values: [{ name: 'IsExternal', ifcClass: 'IFCPROPERTYSINGLEVALUE', value: '.T.', unit: null }] }],
  classifications: [{ occurrenceGlobalId: 'wall-guid', relationGlobalId: 'rel-guid', scheme: 'Uniclass', code: 'EF_25', name: 'Walls', reference: 'EF_25' }],
  quantities: [{ occurrenceGlobalId: 'wall-guid', setGlobalId: 'q-guid', setName: 'Qto_WallBaseQuantities', name: 'NetArea', ifcClass: 'IFCQUANTITYAREA', value: '12', unit: 'm2' }],
  georeference: ['IFCPROJECTEDCRS(EPSG:5186)', 'IFCMAPCONVERSION(1000,2000)'], duplicateGlobalIds: [], unresolvedPlacementGlobalIds: [],
};
const ifc: IfcDeepSemanticRoundtripReport = {
  schema: 'nexyfab.ifc-deep-semantic-roundtrip.v1', passed: true,
  requirements: { occurrences: true, hierarchy: true, placements: true, propertySets: true, classifications: true, quantities: true, georeference: true },
  before: snapshot, after: structuredClone(snapshot), errors: [],
  changes: { occurrenceIds: [], hierarchyIds: [], placementIds: [], propertySetKeys: [], classificationKeys: [], quantityKeys: [] },
};

function completeInput(): BuildingReleaseCertificateInput {
  return {
    workspace: workspace(), siteCoordinates: bound(site), accessibility: bound(axis()), envelopeContinuity: bound(axis()),
    crossDomain: bound(verifyCrossDomainDesign({
      structure: { valid: true }, placement: { required: 7, resolved: 7, invalid: 0 },
      interior: { applicable: true, spaceBoundary: { ran: true, openBoundaries: 0, conservative: true }, egress: { ran: true, passed: true, conservative: true }, doorSwing: { ran: true, clear: true, conservative: true }, mepInterference: { ran: true, collisions: 0, missingGeometry: 0, conservative: true } },
    })),
    ifcRoundtrip: bound(ifc), deliverables: bound(deliverables), repair: bound(axis()), registryPolicy: bound(registry),
  };
}

describe('building release certificate', () => {
  it('passes exactly all 20 building axes while keeping the flawed source registry quarantined', () => {
    const certificate = buildBuildingReleaseCertificate(completeInput());
    expect(certificate.assertions).toHaveLength(20);
    expect(certificate.assertions.every(item => item.status === 'pass')).toBe(true);
    expect(certificate).toMatchObject({ status: 'pass', releaseReady: true, issues: [] });
  });

  it('does not claim IFC fidelity when the deep roundtrip is missing', () => {
    const input = completeInput(); delete input.ifcRoundtrip;
    const certificate = buildBuildingReleaseCertificate(input);
    expect(certificate.status).toBe('not_run');
    expect(certificate.assertions.find(item => item.axis === 'ifc_roundtrip')).toMatchObject({ status: 'not_run' });
  });

  it('fails provenance when quarantined registry data is selected for release', () => {
    const input = completeInput();
    const invalid = { ...registry, usedForRelease: true };
    input.registryPolicy = bound(invalid);
    const certificate = buildBuildingReleaseCertificate(input);
    expect(certificate.assertions.find(item => item.axis === 'provenance')).toMatchObject({ status: 'fail' });
    expect(certificate.releaseReady).toBe(false);
  });

  it('fails host/opening integrity when a door exceeds its wall', () => {
    const input = completeInput();
    const document = input.workspace.semanticDocument.payload as ArchitectureDocument;
    document.openings[0]!.offsetMm = 100;
    input.workspace.semanticDocument.contentHash = hashCadPayload(document);
    input.workspace.workspace.documentHash = input.workspace.semanticDocument.contentHash;
    const certificate = buildBuildingReleaseCertificate(input);
    expect(certificate.assertions.find(item => item.axis === 'hosts_openings')).toMatchObject({ status: 'fail' });
  });
});
