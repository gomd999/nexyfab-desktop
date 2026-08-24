import { describe, expect, it } from 'vitest';
import { createAiDesignInteractionState } from './aiDesignInteractionContract';
import { createAiDesignWorkflowState } from './aiDesignWorkflow';
import { createAiDesignWorkspaceViewModel } from './aiDesignWorkspaceViewModel';
import { createDesignIntentCheckpoint } from './designIntentCheckpoint';
import { selectCodegenModel } from './modelSelectionPolicy';

const hash = (value: string) => value.repeat(64);

function checkpoint() {
  return createDesignIntentCheckpoint({
    checkpointId: 'checkpoint-1',
    projectId: 'project-1',
    revision: 0,
    projectContentHash: hash('a'),
    sources: [{
      id: 'text-1',
      kind: 'text',
      projectId: 'project-1',
      revision: 0,
      sourceHash: hash('b'),
      authority: 'user_confirmed',
      provenance: { rights: 'user_owned', aiUseAllowed: true, derivativeUseAllowed: true },
      fields: [{ key: 'purpose', value: 'mounting bracket', category: 'requirement' }],
    }],
  });
}

describe('AI Design workspace view model', () => {
  it('composes intake, model selection, workflow, and presentation without granting exact geometry authority', () => {
    const cp = checkpoint();
    const selected = selectCodegenModel({ mode: 'auto', plan: 'free', task: 'simple-execution' });
    if (!selected.ok) throw new Error('expected Luna selection');
    const view = createAiDesignWorkspaceViewModel({
      projectId: 'project-1',
      revision: 0,
      revisionToken: 'rev-0',
      checkpoint: cp,
      workflow: createAiDesignWorkflowState({ revision: 0 }),
      interaction: createAiDesignInteractionState(),
      modelSelection: selected.receipt,
    });
    expect(view).toMatchObject({
      safety: 'READY',
      header: { selectedModelId: 'gpt-luna', exactGeometryAuthority: false, precisionStatus: 'NOT_RUN' },
      intake: { sourceKinds: ['text'], confirmedFacts: 1, missing: 0, copyrightUsable: true },
      presentation: { mode: 'desktop' },
    });
    expect(view.primaryAction?.id).toBe('provide-input');
  });

  it('blocks stale cross-module revision bindings instead of presenting a coherent workspace', () => {
    const view = createAiDesignWorkspaceViewModel({
      projectId: 'project-1',
      revision: 1,
      revisionToken: 'rev-1',
      checkpoint: checkpoint(),
      workflow: createAiDesignWorkflowState({ revision: 1 }),
      interaction: createAiDesignInteractionState(),
      candidates: {
        schema: 'nexyfab.design-candidate-comparison.v1',
        baseRevision: 'rev-0',
        revision: 1,
        candidates: [],
        recommendation: { candidateId: null, eligible: false, verificationRequired: true, reasons: [] },
        selectableCandidateIds: [],
      },
    });
    expect(view.safety).toBe('BLOCKED');
    expect(view.issues).toEqual(expect.arrayContaining([
      'checkpoint_workspace_binding_mismatch',
      'candidate_workspace_revision_mismatch',
    ]));
    expect(view.panels.intake).toBe('blocked');
  });
});
