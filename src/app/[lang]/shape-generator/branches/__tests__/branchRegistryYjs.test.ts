/**
 * branchRegistryYjs.test.ts — Wave 2 Phase 3 Z6.
 *
 * Y.Doc-backed registry coverage:
 *  - Y helpers (getBranchesRoot, readBranch, readAllBranches, readActiveBranchId)
 *  - applyBranchOp branches (addBranch, removeBranch, renameBranch, setActiveBranch)
 *  - Name-collision rejection scope (siblings under same parent)
 *  - has-children rejection on removeBranch
 *  - LWW on concurrent setActiveBranch
 *  - bulk populate + clear helpers
 *  - syncDocs convergence
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyBranchOp,
  getBranchesRoot,
  getActiveBranchByDocRoot,
  readBranch,
  readAllBranches,
  readActiveBranchId,
  readAllActiveBranches,
  populateBranchRegistry,
  clearBranchRegistry,
  syncDocs,
} from '../branchRegistryYjs';
import type { BranchRef } from '../branchTypes';

function makeRef(id: string, name: string, parent: string | null = null): BranchRef {
  return {
    id,
    name,
    parentDocId: 'doc-workspace',
    parentBranchId: parent,
    forkedFromBranchHead: '',
    createdAt: 1_700_000_000_000,
    createdBy: 'peer-alpha',
  };
}

// ─── 1. Y helpers ──────────────────────────────────────────────────────────

describe('branchRegistryYjs — Y helpers', () => {
  it('getBranchesRoot returns an empty Y.Map on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(getBranchesRoot(doc).size).toBe(0);
  });

  it('getActiveBranchByDocRoot returns an empty Y.Map on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(getActiveBranchByDocRoot(doc).size).toBe(0);
  });

  it('readBranch returns null when branch is absent', () => {
    const doc = new Y.Doc();
    expect(readBranch(doc, 'nope')).toBeNull();
  });

  it('readAllBranches returns an empty array on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(readAllBranches(doc)).toEqual([]);
  });

  it('readActiveBranchId returns null when no active branch is set', () => {
    const doc = new Y.Doc();
    expect(readActiveBranchId(doc, 'doc-1')).toBeNull();
  });

  it('readAllActiveBranches returns an empty record on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(readAllActiveBranches(doc)).toEqual({});
  });
});

// ─── 2. addBranch ──────────────────────────────────────────────────────────

describe('branchRegistryYjs — addBranch', () => {
  it('adds a root branch and makes it readable', () => {
    const doc = new Y.Doc();
    const res = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    expect(res.ok).toBe(true);
    const got = readBranch(doc, 'b1');
    expect(got?.name).toBe('main');
    expect(got?.parentBranchId).toBeNull();
  });

  it('refuses a duplicate name under the same parent (root scope)', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    const res = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b2', 'main') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('name_collision');
    expect(readAllBranches(doc).length).toBe(1);
  });

  it('allows the same name under different parents', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main', null) });
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b2', 'experiment', 'b1') });
    // Both 'draft' branches with different parents — allowed.
    const r1 = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b3', 'draft', 'b1') });
    const r2 = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b4', 'draft', 'b2') });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('refuses a duplicate name under a non-root parent', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b2', 'draft', 'b1') });
    const res = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b3', 'draft', 'b1') });
    expect(res.ok).toBe(false);
  });

  it('refuses an empty-id branch', () => {
    const doc = new Y.Doc();
    const res = applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('', 'main') });
    expect(res.ok).toBe(false);
  });

  it('preserves description when round-tripping', () => {
    const doc = new Y.Doc();
    const ref: BranchRef = { ...makeRef('b1', 'main'), description: 'root branch' };
    applyBranchOp(doc, { kind: 'addBranch', ref });
    expect(readBranch(doc, 'b1')?.description).toBe('root branch');
  });

  it('omits description when not provided', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    expect(readBranch(doc, 'b1')?.description).toBeUndefined();
  });
});

// ─── 3. removeBranch ───────────────────────────────────────────────────────

describe('branchRegistryYjs — removeBranch', () => {
  it('removes a leaf branch', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    const res = applyBranchOp(doc, { kind: 'removeBranch', branchId: 'b1' });
    expect(res.ok).toBe(true);
    expect(readBranch(doc, 'b1')).toBeNull();
  });

  it('refuses to remove a branch with children (protect, not cascade)', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b2', 'child', 'b1') });
    const res = applyBranchOp(doc, { kind: 'removeBranch', branchId: 'b1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('has_children');
    expect(readBranch(doc, 'b1')).not.toBeNull();
  });

  it('returns not_found for an unknown branchId', () => {
    const doc = new Y.Doc();
    const res = applyBranchOp(doc, { kind: 'removeBranch', branchId: 'ghost' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_found');
  });

  it('also clears any activeBranchByDoc entries pointing at the removed branch', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-A', branchId: 'b1' });
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-B', branchId: 'b1' });
    applyBranchOp(doc, { kind: 'removeBranch', branchId: 'b1' });
    expect(readActiveBranchId(doc, 'doc-A')).toBeNull();
    expect(readActiveBranchId(doc, 'doc-B')).toBeNull();
  });
});

// ─── 4. renameBranch ───────────────────────────────────────────────────────

describe('branchRegistryYjs — renameBranch', () => {
  it('renames an existing branch', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'old') });
    applyBranchOp(doc, { kind: 'renameBranch', branchId: 'b1', name: 'new' });
    expect(readBranch(doc, 'b1')?.name).toBe('new');
  });

  it('refuses rename to a sibling-colliding name', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'a') });
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b2', 'b') });
    const res = applyBranchOp(doc, { kind: 'renameBranch', branchId: 'b2', name: 'a' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('name_collision');
    expect(readBranch(doc, 'b2')?.name).toBe('b');
  });

  it('allows rename to the same name (no-op-ish, still ok)', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    const res = applyBranchOp(doc, { kind: 'renameBranch', branchId: 'b1', name: 'main' });
    expect(res.ok).toBe(true);
  });

  it('returns not_found on missing branch', () => {
    const doc = new Y.Doc();
    const res = applyBranchOp(doc, { kind: 'renameBranch', branchId: 'ghost', name: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_found');
  });
});

// ─── 5. setActiveBranch ────────────────────────────────────────────────────

describe('branchRegistryYjs — setActiveBranch', () => {
  it('records the active branch for a doc', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-A', branchId: 'b1' });
    expect(readActiveBranchId(doc, 'doc-A')).toBe('b1');
  });

  it('separate docs have separate active branches', () => {
    const doc = new Y.Doc();
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-A', branchId: 'b1' });
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-B', branchId: 'b2' });
    expect(readActiveBranchId(doc, 'doc-A')).toBe('b1');
    expect(readActiveBranchId(doc, 'doc-B')).toBe('b2');
  });

  it('allows pointing at a branch that does not exist locally (LWW intent)', () => {
    const doc = new Y.Doc();
    const res = applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-A', branchId: 'nope' });
    expect(res.ok).toBe(true);
    expect(readActiveBranchId(doc, 'doc-A')).toBe('nope');
  });
});

// ─── 6. Convergence ────────────────────────────────────────────────────────

describe('branchRegistryYjs — multi-peer convergence', () => {
  it('two peers adding different branches converge', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyBranchOp(a, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    applyBranchOp(b, { kind: 'addBranch', ref: makeRef('b2', 'feature') });
    syncDocs(a, b);
    expect(readAllBranches(a).map((r) => r.id).sort()).toEqual(['b1', 'b2']);
    expect(readAllBranches(b).map((r) => r.id).sort()).toEqual(['b1', 'b2']);
  });

  it('LWW on concurrent rename of the same branch', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyBranchOp(a, { kind: 'addBranch', ref: makeRef('b1', 'main') });
    syncDocs(a, b);
    applyBranchOp(a, { kind: 'renameBranch', branchId: 'b1', name: 'from-a' });
    applyBranchOp(b, { kind: 'renameBranch', branchId: 'b1', name: 'from-b' });
    syncDocs(a, b);
    // Both end up with the same final name (whatever LWW resolves to).
    expect(readBranch(a, 'b1')?.name).toBe(readBranch(b, 'b1')?.name);
  });

  it('LWW on concurrent setActiveBranch', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyBranchOp(a, { kind: 'setActiveBranch', docId: 'doc-X', branchId: 'b1' });
    applyBranchOp(b, { kind: 'setActiveBranch', docId: 'doc-X', branchId: 'b2' });
    syncDocs(a, b);
    expect(readActiveBranchId(a, 'doc-X')).toBe(readActiveBranchId(b, 'doc-X'));
  });
});

// ─── 7. Bulk helpers ───────────────────────────────────────────────────────

describe('branchRegistryYjs — populate + clear', () => {
  it('populateBranchRegistry writes all branches in one transact', () => {
    const doc = new Y.Doc();
    const refs = [
      makeRef('b1', 'main'),
      makeRef('b2', 'draft', 'b1'),
      makeRef('b3', 'fork', 'b1'),
    ];
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    populateBranchRegistry(doc, refs);
    expect(readAllBranches(doc).length).toBe(3);
    expect(updateCount).toBe(1);
  });

  it('clearBranchRegistry empties both branches and actives', () => {
    const doc = new Y.Doc();
    populateBranchRegistry(doc, [makeRef('b1', 'main')]);
    applyBranchOp(doc, { kind: 'setActiveBranch', docId: 'doc-X', branchId: 'b1' });
    clearBranchRegistry(doc);
    expect(readAllBranches(doc)).toEqual([]);
    expect(readAllActiveBranches(doc)).toEqual({});
  });
});
