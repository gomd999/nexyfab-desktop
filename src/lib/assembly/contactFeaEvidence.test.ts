import { describe, expect, it } from 'vitest';
import { applyArtifactSourceChanges, DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import { commitDesignWorkspaceRevision, createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import {
  CONTACT_FEA_EVIDENCE_SCHEMA,
  commitContactFeaSimulation,
  verifyContactFeaEvidence,
  type ContactFeaEvidence,
} from './contactFeaEvidence';

const hash = (value: string) => value.repeat(64);
const passed = (id: string) => ({ status: 'passed' as const, verifierId: id, evidenceHash: hash('e'), issues: [] });

function fixture() {
  const initialWorkspace = createDesignWorkspaceRevision({ projectId: 'assembly-1', lineageId: 'lineage-1', domain: 'mechanical', documentHash: hash('1') });
  const workspace = commitDesignWorkspaceRevision(initialWorkspace, {
    baseRevision: 0, actor: 'ai', mode: 'precision_cad', documentHash: hash('2'),
    changedTargets: [{ kind: 'assembly', objectId: 'main' }],
  }).workspace;
  const initialGraph: DesignArtifactGraph = {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'assembly-1', revision: 1,
    artifacts: [
      { id: 'model', kind: 'model', revision: 1, contentHash: hash('1'), state: 'current', inputs: [], verification: passed('model-v1'), staleBecause: [] },
      { id: 'simulation', kind: 'simulation', revision: 1, contentHash: hash('8'), state: 'current', inputs: [{ artifactId: 'model', revision: 1, contentHash: hash('1') }], verification: passed('fea-v1'), staleBecause: [] },
    ],
    dependencies: [{ id: 'model-simulation', sourceId: 'model', targetId: 'simulation', policy: 'invalidate' }],
  };
  const graph = applyArtifactSourceChanges(initialGraph, 1, [{ artifactId: 'model', expectedRevision: 1, contentHash: hash('2'), verification: passed('model-v2') }]).graph;
  const face = (persistentFaceId: string, entity: number, geometryHash: string) => ({
    persistentFaceId, occtEntityId: entity, geometryHash, surfaceType: 'plane' as const, areaMm2: 400,
  });
  const evidence: ContactFeaEvidence = {
    schema: CONTACT_FEA_EVIDENCE_SCHEMA,
    projectId: 'assembly-1', lineageId: 'lineage-1', workspaceRevision: 1, workspaceDocumentHash: hash('2'),
    geometryEvidenceHash: hash('3'), kernel: { id: 'occt', version: '7.9.1', buildHash: hash('4') },
    modelArtifact: { artifactId: 'model', revision: 2, contentHash: hash('2') }, simulationArtifactId: 'simulation',
    occurrences: [
      { occurrenceId: 'plate-a', bodyId: 'body-a', shapeHash: hash('a'), transformHash: hash('b'), faces: [face('f.top', 11, hash('c'))] },
      { occurrenceId: 'plate-b', bodyId: 'body-b', shapeHash: hash('d'), transformHash: hash('5'), faces: [face('f.bottom', 21, hash('6'))] },
      { occurrenceId: 'bolt-1', bodyId: 'body-bolt', shapeHash: hash('7'), transformHash: hash('8'), faces: [face('f.bearing', 31, hash('9'))] },
    ],
    contacts: [{
      id: 'plate-interface',
      faceA: { occurrenceId: 'plate-a', persistentFaceId: 'f.top', geometryHash: hash('c') },
      faceB: { occurrenceId: 'plate-b', persistentFaceId: 'f.bottom', geometryHash: hash('6') },
      behavior: 'frictional', frictionCoefficient: 0.2,
      patch: { source: 'occt_section_extrema', geometryHash: hash('a'), areaMm2: 380, minimumGapMm: 0, maximumGapMm: 0.001, maximumPenetrationMm: 0.0002, normal: [0, 0, 1], samplingToleranceMm: 0.005 },
    }],
    fasteners: [{
      id: 'bolt-clamp-1', occurrenceId: 'bolt-1', standardDesignation: 'ISO 4014 M10-8.8', axis: [0, 0, 1],
      nominalPreloadN: 24000, proofLoadN: 33700, preloadEvidenceHash: hash('b'), clampContactIds: ['plate-interface'],
    }],
    analysis: {
      source: 'server_multibody_contact_fea', solverId: 'nexyfab-contact-fea', solverVersion: '1.0.0',
      geometryEvidenceHash: hash('3'), meshHash: hash('c'), loadCaseHash: hash('d'), resultHash: hash('e'), evidenceHash: hash('f'),
      meshMode: 'boundary_conforming_tet', grade: 'engineering', converged: true, nonlinearIterations: 12,
      equilibriumResidualRatio: 0.0001, energyErrorRatio: 0.012, maxDisplacementMm: 0.08, maxVonMisesMpa: 186,
      boundaryConditions: [
        { id: 'fixed-a', kind: 'fixed', occurrenceId: 'plate-a', persistentFaceId: 'f.top', evidenceHash: hash('1') },
        { id: 'force-b', kind: 'force', occurrenceId: 'plate-b', persistentFaceId: 'f.bottom', magnitude: 5000, evidenceHash: hash('2') },
        { id: 'preload-bolt', kind: 'preload', occurrenceId: 'bolt-1', magnitude: 24000, evidenceHash: hash('3') },
      ],
      contactResults: [{ contactId: 'plate-interface', patchGeometryHash: hash('a'), activeNodeCount: 64, maximumPressureMpa: 122, resultantNormalForceN: 23800 }],
      fastenerResults: [{ fastenerId: 'bolt-clamp-1', preloadN: 24000, axialForceN: 25900, utilization: 0.77 }],
    },
  };
  return { workspace, graph, evidence };
}

describe('B-Rep contact, fastener and multibody FEA evidence', () => {
  it('binds persistent OCCT faces, contact patch, bolt preload and converged load path to one revision', () => {
    const { workspace, graph, evidence } = fixture();
    expect(verifyContactFeaEvidence(evidence, workspace, graph)).toEqual({
      integrationVerified: true, grade: 'engineering', issues: [], contactIds: ['plate-interface'], fastenerIds: ['bolt-clamp-1'], loadPathVerified: true,
    });
    const committed = commitContactFeaSimulation(evidence, workspace, graph);
    expect(committed).toMatchObject({ committed: true, graph: { revision: 3 }, issues: [] });
    expect(committed.graph.artifacts.find(item => item.id === 'simulation')).toMatchObject({ state: 'current', revision: 2, contentHash: hash('e'), verification: { status: 'passed', evidenceHash: hash('f') } });
  });

  it('rejects a contact whose persistent face hash no longer matches the B-Rep', () => {
    const { workspace, graph, evidence } = fixture();
    evidence.contacts[0]!.faceA.geometryHash = hash('0');
    const result = verifyContactFeaEvidence(evidence, workspace, graph);
    expect(result.integrationVerified).toBe(false);
    expect(result.issues).toContain('contact_face_binding_mismatch:plate-interface');
  });

  it('rejects bbox/preview mesh claims, unconverged equilibrium, and missing fixed-to-load paths', () => {
    const { workspace, graph, evidence } = fixture();
    (evidence.analysis as { meshMode: string }).meshMode = 'bbox';
    evidence.analysis.converged = false;
    evidence.analysis.boundaryConditions = evidence.analysis.boundaryConditions.filter(item => item.kind !== 'fixed');
    const result = verifyContactFeaEvidence(evidence, workspace, graph);
    expect(result).toMatchObject({ integrationVerified: false, grade: 'not_verified', loadPathVerified: false });
    expect(result.issues).toEqual(expect.arrayContaining(['invalid_or_unconverged_multibody_analysis', 'fixed_to_load_contact_path_missing']));
  });

  it('keeps the stale simulation artifact unchanged when result evidence is tampered', () => {
    const { workspace, graph, evidence } = fixture();
    evidence.analysis.contactResults[0]!.patchGeometryHash = hash('0');
    const result = commitContactFeaSimulation(evidence, workspace, graph);
    expect(result.committed).toBe(false);
    expect(result.graph).toBe(graph);
    expect(graph.artifacts.find(item => item.id === 'simulation')?.state).toBe('stale');
  });
});
