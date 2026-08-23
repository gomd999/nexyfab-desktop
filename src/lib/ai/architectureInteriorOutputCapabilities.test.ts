import { describe, expect, it } from 'vitest';
import { hashArchitectureInteriorEvidenceV2 } from './architectureInteriorWorkspace';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import {
  ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES,
  assertArchitectureInteriorOutputEnabled,
  canEnableArchitectureInteriorOutput,
  evaluateArchitectureInteriorOutputs,
  getArchitectureInteriorOutputCapability,
  validateArchitectureInteriorOutputBundle,
} from './architectureInteriorOutputCapabilities';
import {
  ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA,
  hashArchitectureInteriorArtifactBundle,
  type ArchitectureInteriorArtifactBundle,
} from './architectureInteriorArtifactTransaction';

const source = {
  projectId: 'project-1', revision: 4, contentHash: 'a'.repeat(64), architectureDocumentId: 'architecture-1',
  interiorDocumentId: 'interior-1', architectureDocumentHash: 'b'.repeat(64), interiorDocumentHash: 'c'.repeat(64),
};

function bundle(): ArchitectureInteriorArtifactBundle {
  const model = {
    id: 'model:workspace:4', kind: 'model' as const, revision: 4, contentHash: 'd'.repeat(64), state: 'current' as const,
    inputs: [], verification: { status: 'passed' as const, verifierId: 'model-test', evidenceHash: 'e'.repeat(64), issues: [] }, staleBecause: [],
  };
  const payload = {
    schema: 'nexyfab.architecture-interior-quantity.v1',
    binding: {
      projectId: source.projectId, revision: source.revision, workspaceContentHash: source.contentHash,
      architectureDocumentId: source.architectureDocumentId, interiorDocumentId: source.interiorDocumentId,
      architectureDocumentHash: source.architectureDocumentHash, interiorDocumentHash: source.interiorDocumentHash,
    },
  };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload);
  const artifact = {
    id: 'quantity:architecture-interior:4', kind: 'quantity' as const, revision: 4, contentHash, state: 'current' as const,
    inputs: [{ artifactId: model.id, revision: model.revision, contentHash: model.contentHash }],
    verification: { status: 'passed' as const, verifierId: 'quantity-test', evidenceHash: 'f'.repeat(64), issues: [] }, staleBecause: [],
  };
  const graph = {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: source.projectId, revision: source.revision, artifacts: [model, artifact],
    dependencies: [{ id: 'dependency-1', sourceId: model.id, targetId: artifact.id, policy: 'invalidate' as const }],
  };
  const draft = {
    schema: ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA, source, artifactGraph: graph,
    artifacts: [{ kind: 'quantity' as const, artifact, contentHash, payload }], bundleHash: '',
  } as unknown as Omit<ArchitectureInteriorArtifactBundle, 'bundleHash'>;
  return { ...draft, bundleHash: hashArchitectureInteriorArtifactBundle(draft) };
}

describe('architecture/interior Wave 4 output truth contract', () => {
  it('keeps missing native/round-trip paths as disabled TARGET or NOT_RUN', () => {
    const targets = ARCHITECTURE_INTERIOR_OUTPUT_CAPABILITIES.filter(item => item.status === 'TARGET');
    expect(targets.length).toBeGreaterThan(0);
    for (const item of targets) {
      expect(item.runState).toBe('NOT_RUN');
      expect(item.releaseClaimAllowed).toBe(false);
      expect(item.blocker).toBeTruthy();
      expect(canEnableArchitectureInteriorOutput(item.id)).toBe(false);
      expect(() => assertArchitectureInteriorOutputEnabled(item.id)).toThrow('ARCHITECTURE_INTERIOR_OUTPUT_UNAVAILABLE');
    }
    expect(getArchitectureInteriorOutputCapability('unknown')).toBeNull();
    expect(getArchitectureInteriorOutputCapability('architecture.ifc.structured-semantic')).toMatchObject({ runState: 'NOT_RUN', releaseClaimAllowed: false });
  });

  it('exposes only current, source-bound internal artifacts to the preview contract', () => {
    const value = bundle();
    const result = evaluateArchitectureInteriorOutputs(value, source);
    expect(result).toMatchObject({ bindingValid: true, releaseReady: false, issues: [] });
    expect(result.capabilities.find(item => item.id === 'architecture.schedule.quantity')).toMatchObject({ artifactAvailable: true, enabled: true });
    expect(result.capabilities.find(item => item.id === 'architecture.ifc.structured-semantic')).toMatchObject({ artifactAvailable: false, enabled: false });
  });

  it('rejects stale output state and a live source revision mismatch', () => {
    const stale = bundle();
    stale.artifactGraph.artifacts[1]!.state = 'stale';
    stale.artifactGraph.artifacts[1]!.verification = { status: 'not_run', verifierId: 'stale', issues: ['upstream_changed'] };
    stale.artifactGraph.artifacts[1]!.staleBecause = ['model:workspace:5'];
    stale.artifacts[0]!.artifact = structuredClone(stale.artifactGraph.artifacts[1]!);
    expect(validateArchitectureInteriorOutputBundle(stale)).toEqual(expect.arrayContaining(['bundle_artifact_graph_mismatch:quantity:architecture-interior:4']));

    const current = bundle();
    expect(validateArchitectureInteriorOutputBundle(current, { ...source, revision: 5 })).toEqual(expect.arrayContaining(['stale_source_binding:revision']));
    expect(evaluateArchitectureInteriorOutputs(current, { ...source, contentHash: '9'.repeat(64) }).releaseReady).toBe(false);
  });

  it('does not enable drawing capabilities from a current graph node without a bundled payload', () => {
    const value = bundle();
    value.artifactGraph.artifacts.push({
      id: 'drawing:phantom:4', kind: 'drawing', revision: source.revision,
      contentHash: '8'.repeat(64), state: 'current', inputs: [],
      verification: { status: 'passed', verifierId: 'phantom-graph-node', evidenceHash: '7'.repeat(64), issues: [] },
      staleBecause: [],
    });
    value.bundleHash = hashArchitectureInteriorArtifactBundle(value);

    const result = evaluateArchitectureInteriorOutputs(value, source);
    expect(result.bindingValid).toBe(true);
    for (const id of ['architecture.plan.drawing', 'interior.layout.drawing', 'interior.millwork.drawing']) {
      expect(result.capabilities.find(item => item.id === id)).toMatchObject({ artifactAvailable: false, enabled: false });
    }
    expect(result.capabilities.find(item => item.id === 'architecture.schedule.quantity')).toMatchObject({ artifactAvailable: true, enabled: true });
  });

  it('rejects a bundled output whose artifact revision is detached from the source revision', () => {
    const value = bundle();
    value.artifacts[0]!.artifact.revision = source.revision - 1;
    value.artifactGraph.artifacts[1]!.revision = source.revision - 1;
    value.bundleHash = hashArchitectureInteriorArtifactBundle(value);

    const result = evaluateArchitectureInteriorOutputs(value, source);
    expect(result.bindingValid).toBe(false);
    expect(result.issues).toContain('output_revision_mismatch:quantity:architecture-interior:4');
    expect(result.capabilities.find(item => item.id === 'architecture.schedule.quantity')).toMatchObject({ artifactAvailable: false, enabled: false });
  });
});
