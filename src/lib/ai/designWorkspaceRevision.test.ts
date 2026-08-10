import { describe, expect, it } from 'vitest';
import {
  commitDesignWorkspaceRevision,
  commitWorkspaceAndArtifactModelChange,
  createDesignWorkspaceRevision,
  switchWorkspaceMode,
  validateDesignWorkspaceRevision,
} from './designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from './designArtifactGraph';

const hash = (value: string) => value.repeat(64);
const passed = (id: string) => ({ status: 'passed' as const, verifierId: id, evidenceHash: hash('e'), issues: [] });

function workspace() {
  return createDesignWorkspaceRevision({ projectId: 'project-7', lineageId: 'lineage-7', domain: 'mechanical', documentHash: hash('a') });
}

function graph(): DesignArtifactGraph {
  const model = { id: 'model', kind: 'model' as const, revision: 1, contentHash: hash('a'), state: 'current' as const, inputs: [], verification: passed('model-v1'), staleBecause: [] };
  const binding = [{ artifactId: 'model', revision: 1, contentHash: hash('a') }];
  return {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA,
    projectId: 'project-7',
    revision: 1,
    artifacts: [
      model,
      { id: 'drawing', kind: 'drawing', revision: 1, contentHash: hash('b'), state: 'current', inputs: binding, verification: passed('drawing-v1'), staleBecause: [] },
      { id: 'quantity', kind: 'quantity', revision: 1, contentHash: hash('c'), state: 'current', inputs: binding, verification: passed('quantity-v1'), staleBecause: [] },
    ],
    dependencies: [
      { id: 'model-drawing', sourceId: 'model', targetId: 'drawing', policy: 'invalidate' },
      { id: 'model-quantity', sourceId: 'model', targetId: 'quantity', policy: 'invalidate' },
    ],
  };
}

describe('shared AI/manual/precision workspace revision', () => {
  it('switches guided, expert and precision modes without forking lineage or revision', () => {
    const original = workspace();
    const result = switchWorkspaceMode(original, { experience: 'expert', workMode: 'precision_cad' });
    expect(result).toMatchObject({ committed: true, workspace: { lineageId: 'lineage-7', revision: 0, experience: 'expert', workMode: 'precision_cad' } });
    expect(result.workspace.documentHash).toBe(original.documentHash);
  });

  it('preserves a human parameter lock against AI while allowing an explicit expert override', () => {
    const original = workspace();
    const human = commitDesignWorkspaceRevision(original, {
      baseRevision: 0,
      actor: 'human',
      mode: 'manual',
      documentHash: hash('b'),
      changedTargets: [{ kind: 'parameter', objectId: 'fillet-1', field: 'radius' }],
      addLocks: [{ id: 'lock-radius', target: { kind: 'parameter', objectId: 'fillet-1', field: 'radius' }, source: 'human', reason: 'User-entered exact dimension', valueHash: hash('b') }],
    });
    expect(human.committed).toBe(true);
    const ai = commitDesignWorkspaceRevision(human.workspace, {
      baseRevision: 1, actor: 'ai', mode: 'ai_assisted', documentHash: hash('c'),
      changedTargets: [{ kind: 'parameter', objectId: 'fillet-1', field: 'radius' }],
    });
    expect(ai).toMatchObject({ committed: false, blockedLockIds: ['lock-radius'], issues: ['protected_user_or_authority_value'] });
    expect(ai.workspace).toBe(human.workspace);
    const expert = commitDesignWorkspaceRevision(human.workspace, {
      baseRevision: 1, actor: 'expert', mode: 'precision_cad', documentHash: hash('d'),
      changedTargets: [{ kind: 'parameter', objectId: 'fillet-1', field: 'radius' }], unlockIds: ['lock-radius'],
    });
    expect(expert).toMatchObject({ committed: true, workspace: { revision: 2, workMode: 'precision_cad', locks: [] } });
  });

  it('blocks stale revisions and AI attempts to clear a locked feature subtree', () => {
    const locked = commitDesignWorkspaceRevision(workspace(), {
      baseRevision: 0, actor: 'human', mode: 'manual', documentHash: hash('b'),
      changedTargets: [{ kind: 'feature', objectId: 'boss-1' }],
      addLocks: [{ id: 'lock-boss', target: { kind: 'feature', objectId: 'boss-1' }, source: 'human', reason: 'Manual feature', valueHash: hash('b') }],
    }).workspace;
    expect(commitDesignWorkspaceRevision(locked, {
      baseRevision: 0, actor: 'ai', mode: 'ai_assisted', documentHash: hash('c'), changedTargets: [{ kind: 'feature', objectId: 'boss-1' }],
    }).issues).toEqual(['stale_workspace_revision']);
    expect(commitDesignWorkspaceRevision(locked, {
      baseRevision: 1, actor: 'ai', mode: 'ai_assisted', documentHash: hash('c'), changedTargets: [{ kind: 'parameter', objectId: 'boss-1', field: 'height' }],
    })).toMatchObject({ committed: false, blockedLockIds: ['lock-boss'] });
    expect(validateDesignWorkspaceRevision(locked)).toEqual([]);
  });

  it('commits the model and dependent stale propagation together or rolls both back', () => {
    const originalWorkspace = workspace();
    const originalGraph = graph();
    const result = commitWorkspaceAndArtifactModelChange(originalWorkspace, originalGraph, {
      baseRevision: 0, actor: 'ai', mode: 'ai_assisted', documentHash: hash('2'),
      changedTargets: [{ kind: 'feature', objectId: 'ai-feature-2' }],
      modelArtifactId: 'model', modelExpectedRevision: 1, modelContentHash: hash('2'), modelVerification: passed('model-v2'),
    });
    expect(result).toMatchObject({ committed: true, workspace: { revision: 1 }, graph: { revision: 2 }, staleArtifactIds: ['drawing', 'quantity'] });

    const failed = commitWorkspaceAndArtifactModelChange(originalWorkspace, originalGraph, {
      baseRevision: 0, actor: 'ai', mode: 'ai_assisted', documentHash: hash('3'),
      changedTargets: [{ kind: 'feature', objectId: 'ai-feature-3' }],
      modelArtifactId: 'model', modelExpectedRevision: 99, modelContentHash: hash('3'), modelVerification: passed('model-v3'),
    });
    expect(failed.committed).toBe(false);
    expect(failed.workspace).toBe(originalWorkspace);
    expect(failed.graph).toBe(originalGraph);
  });
});
