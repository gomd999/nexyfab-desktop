import { describe, expect, it } from 'vitest';
import {
  DESIGN_ARTIFACT_GRAPH_SCHEMA,
  type DesignArtifactGraph,
} from './designArtifactGraph';
import { createDesignWorkspaceRevision } from './designWorkspaceRevision';
import type { ComplexProductAssessment } from './complexProductAccuracy';
import type { ManufacturingGateReport } from './manufacturingGates';
import type { NativeMotionVerificationCertificate } from './nativeMotionVerificationCertificate';
import type { ProductAssemblyCertificate } from './productAssemblyCertificate';
import {
  buildMechanicalReleaseCertificate,
  type BoundMechanicalEvidence,
  type MechanicalCoordinateUnitEvidence,
  type MechanicalDrawingEvidence,
  type MechanicalReleaseCertificateInput,
  type MechanicalToleranceEvidence,
} from './mechanicalReleaseCertificate';
import {
  CAD_WORKSPACE_ENVELOPE_SCHEMA,
  hashCadPayload,
  type CadWorkspaceEnvelopeInput,
} from '@/lib/cad/workspaceRevisionStore';

const hash = (value: string) => value.repeat(64);

function graph(): DesignArtifactGraph {
  return {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA,
    projectId: 'mechanical-project',
    revision: 0,
    artifacts: [
      { id: 'model', kind: 'model', revision: 0, contentHash: hash('b'), state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'exact-kernel', evidenceHash: hash('1'), issues: [] }, staleBecause: [] },
      { id: 'drawing', kind: 'drawing', revision: 0, contentHash: hash('c'), state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'drawing-check', evidenceHash: hash('2'), issues: [] }, staleBecause: [] },
      { id: 'bom', kind: 'quantity', revision: 0, contentHash: hash('d'), state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'bom-check', evidenceHash: hash('3'), issues: [] }, staleBecause: [] },
    ],
    dependencies: [],
  };
}

function workspace(): CadWorkspaceEnvelopeInput {
  const requirements = { loadN: 500, criticalDimensions: ['shaft_diameter'] };
  const semantics = { definitions: ['shaft'], occurrences: ['shaft-1'] };
  const relations = [{ from: 'shaft-1', to: 'datum-origin', type: 'placed_at' }];
  return {
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace: createDesignWorkspaceRevision({
      projectId: 'mechanical-project',
      lineageId: 'mechanical-lineage',
      domain: 'mechanical',
      documentHash: hashCadPayload(semantics),
    }),
    requirements: { contentHash: hashCadPayload(requirements), payload: requirements },
    semanticDocument: { schema: 'nexyfab.product-decomposition.v1', contentHash: hashCadPayload(semantics), payload: semantics },
    geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('e') },
    objectRelations: { contentHash: hashCadPayload(relations), payload: relations },
    artifactGraph: graph(),
    provenance: [{ sourceId: 'authoritative-input', kind: 'user', contentHash: hash('4') }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('5'), wasmSha256: hash('6'), stubFallback: false },
  };
}

function bound<T>(payload: T): BoundMechanicalEvidence<T> {
  return {
    workspaceRevision: 0,
    modelContentHash: hash('b'),
    contentHash: hashCadPayload(payload),
    payload,
  };
}

const complexProduct: ComplexProductAssessment = {
  complexity: 'standard',
  releaseReady: true,
  gates: [
    { id: 'decomposition', passed: true, reason: 'definitions preserved', failureCode: 'SEMANTIC_MAPPING_UNAVAILABLE' },
    { id: 'part-evidence', passed: true, reason: 'exact parts verified', failureCode: 'GEOMETRY_INCOMPLETE' },
    { id: 'interfaces', passed: true, reason: 'interfaces verified', failureCode: 'GEOMETRY_INCOMPLETE' },
    { id: 'assembly-depth', passed: true, reason: 'hierarchy appropriate', failureCode: 'SEMANTIC_MAPPING_UNAVAILABLE' },
    { id: 'step-occurrences', passed: true, reason: 'occurrences preserved', failureCode: 'MISSING_TRANSFORM' },
    { id: 'repair-isolation', passed: true, reason: 'repair isolated', failureCode: 'GEOMETRY_INCOMPLETE' },
  ],
};

const assembly: ProductAssemblyCertificate = {
  schema: 'nexyfab.product-assembly-certificate.v1',
  status: 'pass',
  releaseReady: true,
  definitionCount: 1,
  occurrenceCount: 1,
  gates: ['architecture', 'part_certificates', 'topology_rebind', 'step_body_membership', 'transforms', 'joints']
    .map(gate => ({ gate, status: 'pass', codes: [] })) as ProductAssemblyCertificate['gates'],
};

const motion: NativeMotionVerificationCertificate = {
  schema: 'nexyfab.native-motion-verification-certificate.v1',
  status: 'pass',
  releaseReady: true,
  gates: ['planning', 'solver', 'precise_collision', 'clearance']
    .map(gate => ({ gate, status: 'pass', codes: [] })) as NativeMotionVerificationCertificate['gates'],
  verifiedJointIds: ['joint-1'],
};

const manufacturing: ManufacturingGateReport = {
  version: 1,
  passed: true,
  firstBlockingGate: null,
  gates: (['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'] as const).map((id, index) => ({
    id,
    name: `Gate ${index}`,
    status: 'passed',
    evidence: [hash(String(index))],
    failures: [],
  })),
};

const coordinateUnits: MechanicalCoordinateUnitEvidence = {
  status: 'pass', linearUnit: 'mm', angularUnit: 'deg', handedness: 'right', upAxis: 'z', issues: [], artifactHashes: [hash('7')],
};
const tolerance: MechanicalToleranceEvidence = {
  status: 'pass', requirements: 4, verified: 4, worstExcessMm: 0, issues: [], artifactHashes: [hash('8')],
};
const drawing: MechanicalDrawingEvidence = {
  status: 'pass', requiredSheets: 2, verifiedSheets: 2, expectedBomRows: 1, verifiedBomRows: 1,
  requiredDimensions: 4, verifiedDimensions: 4, requiredToleranceCallouts: 2, verifiedToleranceCallouts: 2,
  issues: [], artifactHashes: [hash('9')],
};

function completeInput(): MechanicalReleaseCertificateInput {
  return {
    workspace: workspace(),
    coordinateUnits: bound(coordinateUnits),
    complexProduct: bound(complexProduct),
    assembly: bound(assembly),
    motion: bound(motion),
    manufacturing: bound(manufacturing),
    tolerance: bound(tolerance),
    drawing: bound(drawing),
  };
}

describe('mechanical release certificate', () => {
  it('requires and passes exactly all 24 revision-bound mechanical axes', () => {
    const certificate = buildMechanicalReleaseCertificate(completeInput());
    expect(certificate.assertions).toHaveLength(24);
    expect(certificate.assertions.every(item => item.status === 'pass')).toBe(true);
    expect(certificate).toMatchObject({ status: 'pass', releaseReady: true, issues: [] });
  });

  it('keeps omitted motion evidence as not_run instead of claiming clearance', () => {
    const input = completeInput();
    delete input.motion;
    const certificate = buildMechanicalReleaseCertificate(input);
    expect(certificate.releaseReady).toBe(false);
    expect(certificate.status).toBe('not_run');
    expect(certificate.assertions.find(item => item.axis === 'collision_clearance')).toMatchObject({ status: 'not_run' });
  });

  it('fails a certificate detached from the exact workspace revision', () => {
    const input = completeInput();
    input.manufacturing!.workspaceRevision = 99;
    const certificate = buildMechanicalReleaseCertificate(input);
    expect(certificate.releaseReady).toBe(false);
    expect(certificate.assertions.find(item => item.axis === 'manufacturing')).toMatchObject({ status: 'fail' });
    expect(certificate.assertions.find(item => item.axis === 'provenance')?.reason).toContain('workspace_revision_mismatch');
  });

  it('blocks output consistency when a drawing is stale', () => {
    const input = completeInput();
    input.workspace.artifactGraph.artifacts.find(item => item.id === 'drawing')!.state = 'stale';
    const certificate = buildMechanicalReleaseCertificate(input);
    expect(certificate.assertions.find(item => item.axis === 'output_consistency')).toMatchObject({ status: 'fail' });
    expect(certificate.releaseReady).toBe(false);
  });
});
