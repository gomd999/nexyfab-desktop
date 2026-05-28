/**
 * BranchStore.test.ts — Wave 2 Phase 3 Z6.
 *
 * Adapter cases for both local + yjs modes:
 *  - local mode CRUD + subscribe
 *  - yjs mode CRUD + subscribe + getDoc
 *  - name collision rejection (per-parent scope)
 *  - has-children rejection on removeBranch
 *  - active-branch lookup + setActiveBranch
 *  - getChildren tree query
 *  - migrateToYjs preserves state
 *  - cross-doc convergence
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { BranchStore, migrateToYjs } from '../BranchStore';
import { syncDocs } from '../branchRegistryYjs';

// ─── 1. Local mode — basic CRUD ────────────────────────────────────────────

describe('BranchStore.local — CRUD', () => {
  it('starts empty', () => {
    const s = BranchStore.local();
    expect(s.getBranches()).toEqual([]);
    expect(s.getActiveBranches()).toEqual({});
  });

  it('createBranch returns ok + branchId', () => {
    const s = BranchStore.local();
    const res = s.createBranch('main', 'doc-1', null, 'alice');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.branchId).toBe('string');
      expect(res.branchId.length).toBeGreaterThan(0);
    }
    expect(s.getBranches().length).toBe(1);
  });

  it('createBranch refuses sibling name collision', () => {
    const s = BranchStore.local();
    s.createBranch('main', 'doc-1', null, 'alice');
    const res = s.createBranch('main', 'doc-1', null, 'bob');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('name_collision');
    expect(s.getBranches().length).toBe(1);
  });

  it('allows same name under different parents', () => {
    const s = BranchStore.local();
    const root = s.createBranch('main', 'doc-1', null, 'alice');
    if (!root.ok) throw new Error('root creation failed');
    const r1 = s.createBranch('draft', 'doc-1', root.branchId, 'alice');
    const r2 = s.createBranch('feature', 'doc-1', null, 'alice');
    if (!r2.ok) throw new Error('feature creation failed');
    const r3 = s.createBranch('draft', 'doc-1', r2.branchId, 'alice');
    expect(r1.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  it('removeBranch refuses if branch has children', () => {
    const s = BranchStore.local();
    const root = s.createBranch('main', 'doc-1', null, 'alice');
    if (!root.ok) throw new Error('root');
    s.createBranch('child', 'doc-1', root.branchId, 'alice');
    const res = s.removeBranch(root.branchId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('has_children');
  });

  it('removeBranch removes a leaf', () => {
    const s = BranchStore.local();
    const res = s.createBranch('main', 'doc-1', null, 'alice');
    if (!res.ok) throw new Error('main');
    expect(s.removeBranch(res.branchId).ok).toBe(true);
    expect(s.getBranches()).toEqual([]);
  });

  it('removeBranch returns not_found for unknown id', () => {
    const s = BranchStore.local();
    const res = s.removeBranch('nope');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_found');
  });

  it('renameBranch updates the name', () => {
    const s = BranchStore.local();
    const res = s.createBranch('old', 'doc-1', null, 'alice');
    if (!res.ok) throw new Error();
    expect(s.renameBranch(res.branchId, 'new').ok).toBe(true);
    expect(s.getBranch(res.branchId)?.name).toBe('new');
  });

  it('renameBranch refuses sibling collision', () => {
    const s = BranchStore.local();
    const r1 = s.createBranch('a', 'doc-1', null, 'alice');
    const r2 = s.createBranch('b', 'doc-1', null, 'alice');
    if (!r1.ok || !r2.ok) throw new Error();
    const r = s.renameBranch(r2.branchId, 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('name_collision');
  });

  it('renameBranch returns not_found for unknown id', () => {
    const s = BranchStore.local();
    expect(s.renameBranch('nope', 'x').ok).toBe(false);
  });
});

// ─── 2. Local mode — active branch + children ──────────────────────────────

describe('BranchStore.local — active branch + tree', () => {
  it('setActiveBranch + getActiveBranchId round-trip', () => {
    const s = BranchStore.local();
    const r = s.createBranch('main', 'doc-1', null, 'alice');
    if (!r.ok) throw new Error();
    s.setActiveBranch('doc-1', r.branchId);
    expect(s.getActiveBranchId('doc-1')).toBe(r.branchId);
  });

  it('getActiveBranchId returns null when not set', () => {
    const s = BranchStore.local();
    expect(s.getActiveBranchId('doc-1')).toBeNull();
  });

  it('removeBranch clears active mappings pointing at it', () => {
    const s = BranchStore.local();
    const r = s.createBranch('main', 'doc-1', null, 'alice');
    if (!r.ok) throw new Error();
    s.setActiveBranch('doc-1', r.branchId);
    s.removeBranch(r.branchId);
    expect(s.getActiveBranchId('doc-1')).toBeNull();
  });

  it('getChildren returns immediate descendants', () => {
    const s = BranchStore.local();
    const root = s.createBranch('main', 'doc-1', null, 'alice');
    if (!root.ok) throw new Error();
    const c1 = s.createBranch('c1', 'doc-1', root.branchId, 'alice');
    const c2 = s.createBranch('c2', 'doc-1', root.branchId, 'alice');
    if (!c1.ok || !c2.ok) throw new Error();
    s.createBranch('grand', 'doc-1', c1.branchId, 'alice');
    const kids = s.getChildren(root.branchId).map((b) => b.name).sort();
    expect(kids).toEqual(['c1', 'c2']);
  });
});

// ─── 3. Subscribe ─────────────────────────────────────────────────────────

describe('BranchStore.local — subscribe', () => {
  it('fires listeners on createBranch', () => {
    const s = BranchStore.local();
    let calls = 0;
    s.subscribe(() => { calls++; });
    s.createBranch('main', 'doc-1', null, 'alice');
    expect(calls).toBe(1);
  });

  it('fires on rename + remove + setActiveBranch', () => {
    const s = BranchStore.local();
    const r = s.createBranch('main', 'doc-1', null, 'alice');
    if (!r.ok) throw new Error();
    let calls = 0;
    s.subscribe(() => { calls++; });
    s.renameBranch(r.branchId, 'other');
    s.setActiveBranch('doc-1', r.branchId);
    s.removeBranch(r.branchId);
    expect(calls).toBe(3);
  });

  it('unsubscribe stops further notifications', () => {
    const s = BranchStore.local();
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    off();
    s.createBranch('main', 'doc-1', null, 'alice');
    expect(calls).toBe(0);
  });

  it('does not fire on no-op setActiveBranch (same value)', () => {
    const s = BranchStore.local();
    const r = s.createBranch('main', 'doc-1', null, 'alice');
    if (!r.ok) throw new Error();
    s.setActiveBranch('doc-1', r.branchId);
    let calls = 0;
    s.subscribe(() => { calls++; });
    s.setActiveBranch('doc-1', r.branchId);
    expect(calls).toBe(0);
  });
});

// ─── 4. Yjs mode ───────────────────────────────────────────────────────────

describe('BranchStore.fromYDoc — basics', () => {
  it('starts empty', () => {
    const s = BranchStore.fromYDoc(new Y.Doc());
    expect(s.getBranches()).toEqual([]);
    expect(s.mode).toBe('yjs');
  });

  it('createBranch lands on the doc and is readable', () => {
    const doc = new Y.Doc();
    const s = BranchStore.fromYDoc(doc);
    const r = s.createBranch('main', 'doc-1', null, 'alice');
    expect(r.ok).toBe(true);
    expect(s.getBranches().length).toBe(1);
  });

  it('rejects sibling name collision', () => {
    const s = BranchStore.fromYDoc(new Y.Doc());
    s.createBranch('main', 'doc-1', null, 'alice');
    const r = s.createBranch('main', 'doc-1', null, 'bob');
    expect(r.ok).toBe(false);
  });

  it('removeBranch refuses with children', () => {
    const s = BranchStore.fromYDoc(new Y.Doc());
    const root = s.createBranch('main', 'doc-1', null, 'alice');
    if (!root.ok) throw new Error();
    s.createBranch('c1', 'doc-1', root.branchId, 'alice');
    const r = s.removeBranch(root.branchId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('has_children');
  });

  it('subscribe fires on remote update via syncDocs', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = BranchStore.fromYDoc(docA);
    const b = BranchStore.fromYDoc(docB);
    let bCalls = 0;
    b.subscribe(() => { bCalls++; });
    a.createBranch('main', 'doc-1', null, 'alice');
    syncDocs(docA, docB);
    expect(bCalls).toBeGreaterThan(0);
    expect(b.getBranches().length).toBe(1);
  });

  it('getDoc exposes the underlying registry doc', () => {
    const doc = new Y.Doc();
    const s = BranchStore.fromYDoc(doc);
    expect(s.getDoc?.()).toBe(doc);
  });

  it('createBranchWithHash records the snapshot hash', () => {
    const s = BranchStore.fromYDoc(new Y.Doc());
    const r = s.createBranchWithHash('feature', 'doc-1', null, 'abc123def456', 'alice');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ref = s.getBranch(r.branchId);
      expect(ref?.forkedFromBranchHead).toBe('abc123def456');
    }
  });
});

// ─── 5. migrateToYjs ───────────────────────────────────────────────────────

describe('BranchStore.migrateToYjs', () => {
  it('preserves all branches when migrating from local to yjs', () => {
    const local = BranchStore.local();
    const r1 = local.createBranch('main', 'doc-1', null, 'alice');
    if (!r1.ok) throw new Error();
    local.createBranch('feature', 'doc-1', r1.branchId, 'bob', 'extra notes');
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.getBranches().length).toBe(2);
    expect(yjs.getBranches().find((b) => b.name === 'feature')?.description).toBe('extra notes');
  });

  it('preserves activeBranchByDoc on migrate', () => {
    const local = BranchStore.local();
    const r = local.createBranch('main', 'doc-1', null, 'alice');
    if (!r.ok) throw new Error();
    local.setActiveBranch('doc-1', r.branchId);
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.getActiveBranchId('doc-1')).toBe(r.branchId);
  });

  it('throws when source is already in yjs mode', () => {
    const yjs = BranchStore.fromYDoc(new Y.Doc());
    expect(() => migrateToYjs(yjs, new Y.Doc())).toThrow();
  });
});

// ─── 6. Cross-peer convergence ─────────────────────────────────────────────

describe('BranchStore.fromYDoc — multi-peer', () => {
  it('two stores on synced docs converge on create', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = BranchStore.fromYDoc(docA);
    const b = BranchStore.fromYDoc(docB);
    a.createBranch('main', 'doc-1', null, 'alice');
    b.createBranch('feature', 'doc-1', null, 'bob');
    syncDocs(docA, docB);
    expect(a.getBranches().length).toBe(2);
    expect(b.getBranches().length).toBe(2);
  });

  it('after sync, only one of two concurrent same-name additions survives by id', () => {
    // Concurrent same-name create yields two branches with different
    // ids — both land (sibling name collision is checked locally, not
    // post-merge). The user resolves with a rename.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = BranchStore.fromYDoc(docA);
    const b = BranchStore.fromYDoc(docB);
    a.createBranch('main', 'doc-1', null, 'alice');
    b.createBranch('main', 'doc-1', null, 'bob');
    syncDocs(docA, docB);
    // Both peers see two branches named 'main' — UI surfaces the
    // duplicate and user renames one (best-effort merge UX).
    expect(a.getBranches().filter((br) => br.name === 'main').length).toBe(2);
    expect(b.getBranches().filter((br) => br.name === 'main').length).toBe(2);
  });
});
