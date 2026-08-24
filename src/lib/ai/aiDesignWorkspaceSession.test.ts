import { describe, expect, it } from 'vitest';
import {
  AiDesignWorkspaceSessionV1,
  validateAiDesignWorkspaceSessionSnapshot,
} from './aiDesignWorkspaceSession';

const make = () => AiDesignWorkspaceSessionV1.create({ projectId: 'project-1', sessionId: 'session-1', checkpointId: 'checkpoint-1', workflowId: 'workflow-1' });

describe('AiDesignWorkspaceSessionV1', () => {
  it('rejects stale revisions and binds checkpoint/workflow identities', () => {
    const session = make();
    const stale = session.apply({ eventId: 'e-1', type: 'set-view', expectedRevision: 2, owner: 'ai', reversible: true, payload: { tab: 'input' } });
    expect(stale).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(session.snapshotState.bindings).toEqual({ checkpointId: 'checkpoint-1', checkpointRevision: 0, workflowId: 'workflow-1', workflowRevision: 0 });
  });

  it('replays duplicate event IDs without applying twice', () => {
    const first = make().apply({ eventId: 'e-1', type: 'set-view', owner: 'ai', reversible: true, payload: { tab: 'input' } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = first.session.apply({ eventId: 'e-1', type: 'set-view', owner: 'ai', reversible: true, payload: { tab: 'other' } });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(second.session.revision).toBe(1);
    expect(second.session.snapshotState.data.tab).toBe('input');
  });

  it('supports AI view undo/redo and records Precision events as non-undoable', () => {
    const applied = make().apply({ eventId: 'e-1', type: 'set-view', owner: 'ai', reversible: true, payload: { tab: 'candidates' } });
    if (!applied.ok) throw new Error('setup failed');
    const undone = applied.session.undo();
    expect(undone.ok && undone.session.snapshotState.data.tab).toBeUndefined();
    if (!undone.ok) return;
    const redone = undone.session.redo();
    expect(redone.ok && redone.session.snapshotState.data.tab).toBe('candidates');
    const exact = make().apply({ eventId: 'precision-1', type: 'commit', owner: 'precision', target: 'precision-exact-commit', payload: { receiptId: 'r-1' } });
    expect(exact).toMatchObject({ ok: true, session: { revision: 1 } });
    if (!exact.ok) return;
    expect(exact.session.undo()).toMatchObject({ ok: false, error: 'nothing_to_undo' });
    expect(make().apply({ eventId: 'precision-2', type: 'commit', owner: 'precision', target: 'precision-exact-commit', reversible: true })).toMatchObject({ ok: false, error: 'irreversible_event' });
  });

  it('detects tampered snapshots and fails closed for oversized/secrets/geometry bytes', () => {
    const session = make().apply({ eventId: 'e-1', type: 'set-view', owner: 'ai', reversible: true, payload: { tab: 'input' } });
    if (!session.ok) throw new Error('setup failed');
    const snapshot = session.session.exportSnapshot();
    expect(validateAiDesignWorkspaceSessionSnapshot({ ...snapshot, revision: 99 })).toMatchObject({ valid: false, error: 'invalid_snapshot' });
    expect(make().apply({ eventId: 'secret', type: 'set', payload: { apiKey: 'do-not-store' } })).toMatchObject({ ok: false, error: 'secret_key' });
    expect(make().apply({ eventId: 'bytes', type: 'set', payload: { geometryBytes: 'AA==' } })).toMatchObject({ ok: false, error: 'geometry_bytes' });
    expect(make().apply({ eventId: 'large', type: 'set', payload: { text: 'x'.repeat(513) } })).toMatchObject({ ok: false, error: 'oversize' });
  });
});
