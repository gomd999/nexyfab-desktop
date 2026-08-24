import { describe, expect, it } from 'vitest';
import { createAiDesignWorkspaceRuntime, dispatchAiDesignWorkspaceAction } from './aiDesignWorkspaceRuntime';
import { createAiDesignWorkspaceV2ViewModel } from './aiDesignWorkspaceV2ViewModel';

const hash = (char: string) => char.repeat(64);
const input = { projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('b'), kind: 'text' as const, mimeType: 'text/plain', sizeBytes: 10, authority: 'user_confirmed' as const, provenance: { rights: 'user_owned' as const, origin: 'user' }, fields: [{ key: 'purpose', value: 'bracket', category: 'requirement' as const }] };

function initial() {
  const result = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-1', inputs: [input], now: '2026-08-24T00:00:00.000Z' });
  if (!result.ok) throw new Error(result.issues.join(','));
  return result.state;
}

describe('AI Design workspace V2 view-model', () => {
  it('uses a mobile intent sheet and server-command CTA without fabricated progress', () => {
    const view = createAiDesignWorkspaceV2ViewModel(initial(), { viewportWidth: 390 });
    expect(view).toMatchObject({ layout: { mode: 'mobile', primaryRegion: 'understanding', mobileSheet: 'intent', stickyPrimaryAction: true }, primaryAction: { command: 'REQUEST_UNDERSTANDING_CONFIRMATION' }, generation: { percent: null }, trust: { precisionVerification: 'NOT_RUN', manufacturingReleaseReady: false } });
  });

  it('explains the public model and exposes a stage-run request while generation is active', () => {
    let state = initial();
    const confirmed = dispatchAiDesignWorkspaceAction(state, { type: 'UNDERSTANDING_CONFIRMED', actionId: 'confirm-1', expectedRevision: 0, missingInput: false, evidence: { id: 'e1', kind: 'understanding', checkpointId: state.checkpoint.checkpointId, revision: 0, status: 'PASS', digest: hash('b'), source: 'server-receipt' } });
    if (!confirmed.ok) throw new Error(confirmed.error); state = confirmed.state;
    const started = dispatchAiDesignWorkspaceAction(state, { type: 'START_GENERATION', actionId: 'start-1', expectedRevision: 1, runId: 'run-1', modelSelection: { mode: 'auto', plan: 'free', task: 'simple-execution' } });
    if (!started.ok) throw new Error(started.error); state = started.state;
    const view = createAiDesignWorkspaceV2ViewModel(state);
    expect(view.primaryAction).toMatchObject({ command: 'RUN_GENERATION_STAGE_REQUEST', enabled: true });
    expect(view.model).toMatchObject({ publicModelId: 'gpt-luna', selectionStatus: 'selected', exactGeometryAuthority: false });
    expect(view.model.explanation.join(' ')).not.toContain('private');
  });
});
