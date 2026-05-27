import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabUndoManager } from '../collabUndo';

describe('CollabUndoManager · single-user', () => {
  it('undoes the last local mutation', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });
    mgr.transact(doc, () => { map.set('k', 1); });
    expect(map.get('k')).toBe(1);
    expect(mgr.undo()).toBe(true);
    expect(map.get('k')).toBeUndefined();
  });

  it('redoes after undo', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });
    mgr.transact(doc, () => { map.set('k', 42); });
    mgr.undo();
    expect(mgr.redo()).toBe(true);
    expect(map.get('k')).toBe(42);
  });

  it('reports stack sizes for toolbar enable state', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });
    expect(mgr.canUndo()).toBe(false);
    mgr.transact(doc, () => { map.set('k', 1); });
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
    mgr.undo();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);
  });

  it('clear wipes both stacks', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });
    mgr.transact(doc, () => { map.set('k', 1); });
    mgr.transact(doc, () => { map.set('k', 2); });
    mgr.clear();
    expect(mgr.undoStackSize()).toBe(0);
    expect(mgr.redoStackSize()).toBe(0);
  });
});

describe('CollabUndoManager · multi-user origin isolation', () => {
  it('only undoes operations authored under the local origin', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });

    // Alice's local edit (tracked).
    mgr.transact(doc, () => { map.set('a', 1); });
    // Bob's remote edit applied via a different origin (NOT tracked).
    doc.transact(() => { map.set('b', 2); }, 'bob');

    // Undo should remove Alice's edit but leave Bob's intact.
    mgr.undo();
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBe(2);
  });

  it('does not push remote-origin transactions onto the undo stack', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 0,
    });
    doc.transact(() => { map.set('x', 1); }, 'bob');
    expect(mgr.canUndo()).toBe(false);
  });
});

describe('CollabUndoManager · capture window', () => {
  it('merges rapid edits within captureTimeoutMs into one undo step', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
      captureTimeoutMs: 5_000, // wide enough to combine
    });
    mgr.transact(doc, () => { map.set('k', 1); });
    mgr.transact(doc, () => { map.set('k', 2); });
    // Both edits in the same capture window → 1 undo step.
    expect(mgr.undoStackSize()).toBe(1);
    mgr.undo();
    expect(map.get('k')).toBeUndefined();
  });
});

describe('CollabUndoManager · destroy', () => {
  it('destroy releases observers without throwing', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const mgr = new CollabUndoManager({
      trackedTypes: [map],
      localOrigin: 'alice',
    });
    expect(() => mgr.destroy()).not.toThrow();
  });
});
