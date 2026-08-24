// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createAiDesignWorkspaceRuntime, dispatchAiDesignWorkspaceAction } from './aiDesignWorkspaceRuntime';
import {
  createServerAiDesignWorkspaceRuntime,
  loadServerAiDesignWorkspaceRuntime,
  resetAiDesignWorkspaceRuntimeStoreForTests,
  saveServerAiDesignWorkspaceRuntime,
} from './aiDesignWorkspaceRuntimeStore';

const hash = (char: string) => char.repeat(64);
function runtime() {
  const result = createAiDesignWorkspaceRuntime({
    projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-1', now: '2026-08-24T00:00:00Z',
    inputs: [{ projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('f'), kind: 'text', mimeType: 'text/plain', sizeBytes: 20, authority: 'user_confirmed', provenance: { rights: 'user_owned', origin: 'user' }, fields: [{ key: 'purpose', value: 'bracket' }] }],
  });
  if (!result.ok) throw new Error(result.issues.join(','));
  return result.state;
}

afterEach(() => resetAiDesignWorkspaceRuntimeStoreForTests());

describe('AI Design workspace runtime store', () => {
  it('creates, loads, and compare-and-swaps a runtime', async () => {
    const initial = runtime();
    await createServerAiDesignWorkspaceRuntime('owner-1', initial);
    expect(await loadServerAiDesignWorkspaceRuntime('owner-1', 'project-1', 'session-1')).toEqual(initial);
    const transitioned = dispatchAiDesignWorkspaceAction(initial, {
      type: 'UNDERSTANDING_CONFIRMED', actionId: 'understanding-1', expectedRevision: 0, missingInput: false,
      evidence: { id: 'evidence-1', kind: 'understanding', checkpointId: initial.checkpoint.checkpointId, revision: 0, status: 'PASS', digest: hash('f'), source: 'worker-1' },
    });
    if (!transitioned.ok) throw new Error(transitioned.error);
    await saveServerAiDesignWorkspaceRuntime('owner-1', transitioned.state, 0);
    expect((await loadServerAiDesignWorkspaceRuntime('owner-1', 'project-1', 'session-1')).runtimeRevision).toBe(1);
  });

  it('rejects duplicate creation, stale writes, and cross-owner reads', async () => {
    const initial = runtime();
    await createServerAiDesignWorkspaceRuntime('owner-1', initial);
    await expect(createServerAiDesignWorkspaceRuntime('owner-1', initial)).rejects.toThrow('AI_DESIGN_WORKSPACE_ALREADY_EXISTS');
    await expect(loadServerAiDesignWorkspaceRuntime('owner-2', 'project-1', 'session-1')).rejects.toThrow('AI_DESIGN_WORKSPACE_NOT_FOUND');
    await expect(saveServerAiDesignWorkspaceRuntime('owner-1', { ...initial, runtimeRevision: 2 }, 1)).rejects.toThrow('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
  });
});
