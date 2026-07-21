/**
 * sessionRepoStore.test.ts — Wave 6 Track W6-D.
 *
 * Proves the panel's real-data backend: session repo lifecycle, honest
 * empty/demo separation, the LCA-based merge flow (conflict → resolve →
 * 2-parent merge commit), and the new VersionRepo.merge engine method.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePdmSessionStore } from './sessionRepoStore';
import { VersionRepo } from './versionBranch';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

const store = () => usePdmSessionStore.getState();

beforeEach(() => {
  usePdmSessionStore.setState({ repo: null, rev: 0, isDemo: false, pendingMerge: null });
});

describe('VersionRepo.merge (engine)', () => {
  it('records a two-parent commit and advances head', () => {
    const r = new VersionRepo([f('a', { radius: 3 })], 'u1');
    r.branch('alt');
    r.checkout('alt');
    const altHead = r.commit({ authorUserId: 'u1', message: 'alt', features: [f('a', { radius: 5 })] });
    r.checkout('main');
    const m = r.merge({
      authorUserId: 'u1', message: 'Merge alt into main',
      features: [f('a', { radius: 5 })], otherParentId: altHead.id,
    });
    expect(m.parents).toHaveLength(2);
    expect(m.parents[1]).toBe(altHead.id);
    expect(r.current().commit.id).toBe(m.id);
  });

  it('allows merging INTO a protected branch (protected blocks direct commit only)', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.branch('release', { protectedFlag: true });
    r.commit({ authorUserId: 'u1', message: 'work on main', features: [f('a'), f('b')] });
    const mainHead = r.current().commit;
    r.checkout('release');
    expect(() => r.commit({ authorUserId: 'u1', message: 'x', features: [] })).toThrow(/protected/);
    const m = r.merge({
      authorUserId: 'u1', message: 'Merge main into release',
      features: mainHead.features.slice(), otherParentId: mainHead.id,
    });
    expect(m.parents).toHaveLength(2);
  });

  it('rejects self-merge and unknown parent', () => {
    const r = new VersionRepo([f('a')], 'u1');
    const head = r.current().commit;
    expect(() => r.merge({ authorUserId: 'u1', message: 'm', features: [], otherParentId: head.id })).toThrow(/itself/);
    expect(() => r.merge({ authorUserId: 'u1', message: 'm', features: [], otherParentId: 'nope' })).toThrow(/not found/);
  });
});

describe('usePdmSessionStore lifecycle', () => {
  it('starts with no repo and no demo flag (no auto-seeded data)', () => {
    expect(store().repo).toBeNull();
    expect(store().isDemo).toBe(false);
  });

  it('init creates a real (non-demo) repo with a root commit', () => {
    store().init([f('a', { radius: 3 })], 'tester');
    expect(store().repo).not.toBeNull();
    expect(store().isDemo).toBe(false);
    expect(store().repo!.listCommits()).toHaveLength(1);
    expect(store().repo!.current().commit.authorUserId).toBe('tester');
  });

  it('init is idempotent — never clobbers an existing history', () => {
    store().init([f('a')], 'tester');
    store().commit([f('a'), f('b')], 'second', 'tester');
    store().init([f('z')], 'other');
    expect(store().repo!.listCommits()).toHaveLength(2);
  });

  it('loadDemo marks isDemo and reset clears it', () => {
    store().loadDemo();
    expect(store().isDemo).toBe(true);
    expect(store().repo!.listBranches().length).toBeGreaterThanOrEqual(2);
    store().reset();
    expect(store().repo).toBeNull();
    expect(store().isDemo).toBe(false);
  });

  it('createBranch checks the new branch out', () => {
    store().init([f('a')], 'tester');
    expect(store().createBranch('alt')).toBe(true);
    expect(store().repo!.current().branchName).toBe('alt');
    expect(store().createBranch('alt')).toBe(false); // duplicate
  });
});

describe('usePdmSessionStore merge flow', () => {
  it('modify-modify: conflict surfaced, resolve ours, 2-parent merge commit lands', () => {
    store().init([f('a', { radius: 3 })], 'tester');
    store().createBranch('alt');                              // HEAD → alt
    store().commit([f('a', { radius: 5 })], 'alt change', 'tester');
    store().checkout('main');
    store().commit([f('a', { radius: 7 })], 'main change', 'tester');

    store().startMerge('alt');
    const pm = store().pendingMerge!;
    expect(pm.sourceBranch).toBe('alt');
    expect(pm.targetBranch).toBe('main');
    expect(pm.result.conflicts).toHaveLength(1);
    expect(pm.result.conflicts[0]!.kind).toBe('modify-modify');

    // Unresolved → apply refuses (no fabricated merge).
    expect(store().applyMerge('tester')).toBeNull();

    store().resolvePending('a', 'ours');
    expect(store().pendingMerge!.result.conflicts).toHaveLength(0);

    const m = store().applyMerge('tester')!;
    expect(m).not.toBeNull();
    expect(m.parents).toHaveLength(2);
    expect(m.features.find(x => x.id === 'a')?.params.radius).toBe(7); // ours = main
    expect(store().pendingMerge).toBeNull();
    expect(store().repo!.current().branchName).toBe('main');
    expect(store().repo!.current().commit.id).toBe(m.id);
  });

  it('delete-modify: ours deletes, theirs modifies — taking theirs restores the feature', () => {
    store().init([f('a', { radius: 3 }), f('b', { t: 1 })], 'tester');
    store().createBranch('alt');
    store().commit([f('a', { radius: 3 }), f('b', { t: 9 })], 'alt modifies b', 'tester');
    store().checkout('main');
    store().commit([f('a', { radius: 3 })], 'main deletes b', 'tester');

    store().startMerge('alt');
    const conflicts = store().pendingMerge!.result.conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('delete-modify');

    store().resolvePending('b', 'theirs');
    const m = store().applyMerge('tester')!;
    expect(m.features.find(x => x.id === 'b')?.params.t).toBe(9);
  });

  it('clean merge (one side changed) has zero conflicts and applies directly', () => {
    store().init([f('a', { radius: 3 })], 'tester');
    store().createBranch('alt');
    store().commit([f('a', { radius: 3 }), f('c', { d: 1 })], 'alt adds c', 'tester');
    store().checkout('main');
    store().startMerge('alt');
    expect(store().pendingMerge!.result.conflicts).toHaveLength(0);
    const m = store().applyMerge('tester')!;
    expect(m.features.map(x => x.id).sort()).toEqual(['a', 'c']);
  });

  it('abortMerge discards the pending merge without committing', () => {
    store().init([f('a', { radius: 3 })], 'tester');
    store().createBranch('alt');
    store().commit([f('a', { radius: 5 })], 'alt', 'tester');
    store().checkout('main');
    store().startMerge('alt');
    expect(store().pendingMerge).not.toBeNull();
    const before = store().repo!.listCommits().length;
    store().abortMerge();
    expect(store().pendingMerge).toBeNull();
    expect(store().repo!.listCommits()).toHaveLength(before);
  });
});
