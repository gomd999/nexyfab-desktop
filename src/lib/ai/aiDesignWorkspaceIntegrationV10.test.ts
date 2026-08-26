import { describe, expect, it } from 'vitest';
import { dispatchAiDesignChatAction } from './aiDesignChatActionCards';
import { INTEGRATION_FIXTURE_KINDS_V1, createIntegrationFixtureSourceV1, createIntegrationFixtureV1 } from './integrationFixtureV1';
import {
  createAiDesignPreviewDecisionCardV10,
  createAiDesignUnifiedWorkspaceSnapshotV10,
} from './aiDesignWorkspaceIntegrationV10';

describe('AI Design workspace integration V10', () => {
  it.each(INTEGRATION_FIXTURE_KINDS_V1)('binds the %s model and renderer revisions', kind => {
    const source = createIntegrationFixtureSourceV1(kind);
    const fixture = createIntegrationFixtureV1(kind);
    const snapshot = createAiDesignUnifiedWorkspaceSnapshotV10({ model: source, unified: fixture.workspace });
    expect(snapshot).toMatchObject({ projectId: source.projectId, runtimeRevision: 1, complexRevision: 1 });
    expect(snapshot.workspace.authority.manufacturingReleaseReady).toBe(false);
  });

  it('rejects a model/projection revision mismatch', () => {
    const source = createIntegrationFixtureSourceV1('gauge-preview');
    const workspace = createIntegrationFixtureV1('gauge-preview').workspace;
    expect(() => createAiDesignUnifiedWorkspaceSnapshotV10({ model: { ...source, runtimeRevision: 2 }, unified: workspace })).toThrow('invalid_server_revision');
  });

  it('creates apply and reject actions from server preview evidence', () => {
    const card = createAiDesignPreviewDecisionCardV10({
      projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4,
      evidence: {
        proposalId: 'proposal-1', proposalDigest: 'a'.repeat(64), baseRuntimeRevision: 4,
        baseRevisionToken: 'runtime-4:complex-2', affectedRefs: [{ kind: 'parameter', id: 'gauge-1' }],
        summaryCodes: ['concept_preview_only'], previewOnly: true,
        verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
      },
    });
    expect(card.actions.map(action => action.id)).toEqual(['APPLY_CONCEPT_CHANGE', 'REJECT_PREVIEW']);
    expect(dispatchAiDesignChatAction({ card, actionId: 'APPLY_CONCEPT_CHANGE', effectId: 'effect-1', expectedRuntimeRevision: 4 })).toMatchObject({ ok: true, effect: { boundary: 'ai-design-runtime', explicitCommitRequired: true, referenceId: 'proposal-1' } });
  });
});
