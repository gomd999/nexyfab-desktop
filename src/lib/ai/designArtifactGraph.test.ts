import { describe, expect, it } from 'vitest';
import {
  DESIGN_ARTIFACT_GRAPH_SCHEMA,
  applyArtifactSourceChanges,
  commitArtifactRegeneration,
  evaluateArtifactRelease,
  validateDesignArtifactGraph,
  type ArtifactInputBinding,
  type DesignArtifactGraph,
  type DesignArtifactNode,
} from './designArtifactGraph';

const hash = (character: string) => character.repeat(64);
const passed = (id: string) => ({ status: 'passed' as const, verifierId: id, evidenceHash: hash('e'), issues: [] });
function node(id: string, kind: DesignArtifactNode['kind'], contentHash: string, inputs: ArtifactInputBinding[] = []): DesignArtifactNode {
  return { id, kind, revision: 1, contentHash, state: 'current', inputs, verification: passed(`verify-${id}`), staleBecause: [] };
}
function graph(): DesignArtifactGraph {
  const model = node('model', 'model', hash('a'));
  const fromModel = [{ artifactId: 'model', revision: 1, contentHash: hash('a') }];
  const drawing = node('drawing', 'drawing', hash('b'), fromModel);
  const quantity = node('quantity', 'quantity', hash('c'), fromModel);
  const qualityInputs = [
    { artifactId: 'model', revision: 1, contentHash: hash('a') },
    { artifactId: 'drawing', revision: 1, contentHash: hash('b') },
    { artifactId: 'quantity', revision: 1, contentHash: hash('c') },
  ];
  const quality = node('quality', 'bim_quality', hash('d'), qualityInputs);
  const ifc = node('ifc', 'ifc', hash('f'), [{ artifactId: 'model', revision: 1, contentHash: hash('a') }, { artifactId: 'quality', revision: 1, contentHash: hash('d') }]);
  return {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1,
    artifacts: [model, drawing, quantity, quality, ifc],
    dependencies: [
      { id: 'model-drawing', sourceId: 'model', targetId: 'drawing', policy: 'invalidate' },
      { id: 'model-quantity', sourceId: 'model', targetId: 'quantity', policy: 'invalidate' },
      { id: 'model-quality', sourceId: 'model', targetId: 'quality', policy: 'invalidate' },
      { id: 'drawing-quality', sourceId: 'drawing', targetId: 'quality', policy: 'invalidate' },
      { id: 'quantity-quality', sourceId: 'quantity', targetId: 'quality', policy: 'invalidate' },
      { id: 'model-ifc', sourceId: 'model', targetId: 'ifc', policy: 'invalidate' },
      { id: 'quality-ifc', sourceId: 'quality', targetId: 'ifc', policy: 'invalidate' },
    ],
  };
}

describe('design artifact dependency graph', () => {
  it('starts release-ready only when every required artifact is verified and bound to exact inputs', () => {
    expect(validateDesignArtifactGraph(graph())).toEqual([]);
    expect(evaluateArtifactRelease(graph())).toMatchObject({ releaseReady: true, missingKinds: [], staleArtifactIds: [] });
  });

  it('atomically propagates a model change to drawing, quantity, BIM quality and IFC', () => {
    const original = graph();
    const result = applyArtifactSourceChanges(original, 1, [{ artifactId: 'model', expectedRevision: 1, contentHash: hash('1'), verification: passed('model-v2') }]);
    expect(result.committed).toBe(true);
    expect(result.staleArtifactIds).toEqual(['drawing', 'ifc', 'quality', 'quantity']);
    expect(result.graph.artifacts.find(value => value.id === 'model')).toMatchObject({ revision: 2, contentHash: hash('1'), state: 'current' });
    expect(evaluateArtifactRelease(result.graph).releaseReady).toBe(false);
    expect(original).toEqual(graph());
  });

  it('regenerates in dependency order and rejects stale bindings or failed verification atomically', () => {
    const changed = applyArtifactSourceChanges(graph(), 1, [{ artifactId: 'model', expectedRevision: 1, contentHash: hash('1'), verification: passed('model-v2') }]).graph;
    const modelBinding = [{ artifactId: 'model', revision: 2, contentHash: hash('1') }];
    const bad = commitArtifactRegeneration(changed, 2, [{ artifactId: 'drawing', expectedRevision: 1, contentHash: hash('2'), inputs: [{ artifactId: 'model', revision: 1, contentHash: hash('a') }], verification: passed('drawing-v2') }]);
    expect(bad).toMatchObject({ committed: false, issues: ['regeneration_input_binding_mismatch:drawing'] });
    expect(bad.graph).toBe(changed);
    const result = commitArtifactRegeneration(changed, 2, [
      { artifactId: 'drawing', expectedRevision: 1, contentHash: hash('2'), inputs: modelBinding, verification: passed('drawing-v2') },
      { artifactId: 'quantity', expectedRevision: 1, contentHash: hash('3'), inputs: modelBinding, verification: passed('quantity-v2') },
      { artifactId: 'quality', expectedRevision: 1, contentHash: hash('4'), inputs: [modelBinding[0]!, { artifactId: 'drawing', revision: 2, contentHash: hash('2') }, { artifactId: 'quantity', revision: 2, contentHash: hash('3') }], verification: passed('quality-v2') },
      { artifactId: 'ifc', expectedRevision: 1, contentHash: hash('5'), inputs: [modelBinding[0]!, { artifactId: 'quality', revision: 2, contentHash: hash('4') }], verification: passed('ifc-v2') },
    ]);
    expect(result).toMatchObject({ committed: true, staleArtifactIds: [], issues: [] });
    expect(evaluateArtifactRelease(result.graph).releaseReady).toBe(true);
  });

  it('blocks locked downstream artifacts and dependency cycles', () => {
    const locked = graph(); locked.dependencies.find(value => value.id === 'model-ifc')!.policy = 'locked';
    expect(applyArtifactSourceChanges(locked, 1, [{ artifactId: 'model', expectedRevision: 1, contentHash: hash('1'), verification: passed('v') }])).toMatchObject({ committed: false, issues: ['locked_downstream_requires_approval:ifc'] });
    const cyclic = graph(); cyclic.dependencies.push({ id: 'ifc-model', sourceId: 'ifc', targetId: 'model', policy: 'invalidate' });
    expect(validateDesignArtifactGraph(cyclic)).toContain('dependency_cycle');
  });

  it('rejects stale graph revisions without mutating state', () => {
    const original = graph();
    const result = applyArtifactSourceChanges(original, 0, [{ artifactId: 'model', expectedRevision: 1, contentHash: hash('1'), verification: passed('v') }]);
    expect(result).toMatchObject({ committed: false, issues: ['stale_graph_revision'] });
    expect(result.graph).toBe(original);
  });
});
