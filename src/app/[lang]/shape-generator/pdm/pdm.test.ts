import { describe, it, expect } from 'vitest';
import { VersionRepo } from './versionBranch';
import {
  can, effectiveRole, canView, canCommit, canMerge,
  type PermissionEntry, type PermissionContext,
} from './permissions';
import { mergeFeatures, resolveConflict } from './conflictResolution';
import { layoutCommitGraph, diffCommits } from './historyView';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

// ── VersionRepo ─────────────────────────────────────────────────────

describe('VersionRepo', () => {
  it('initialises with main branch and a root commit', () => {
    const r = new VersionRepo([f('a', { radius: 3 })], 'user1');
    expect(r.listBranches().map(b => b.name)).toEqual(['main']);
    expect(r.listCommits()).toHaveLength(1);
  });

  it('commit advances head pointer', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.commit({ authorUserId: 'u1', message: 'x', features: [f('a'), f('b')] });
    expect(r.listCommits()).toHaveLength(2);
    expect(r.current().commit.message).toBe('x');
  });

  it('branch + checkout switches HEAD', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.branch('feature');
    r.checkout('feature');
    expect(r.current().branchName).toBe('feature');
  });

  it('protected branch rejects direct commit', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.branch('main2', { protectedFlag: true });
    r.checkout('main2');
    expect(() =>
      r.commit({ authorUserId: 'u1', message: 'x', features: [] }),
    ).toThrow(/protected/);
  });

  it('LCA finds shared ancestor', () => {
    const r = new VersionRepo([f('a')], 'u1');
    const c1 = r.commit({ authorUserId: 'u1', message: 'c1', features: [f('a')] });
    r.branch('alt');
    const mainHead = r.commit({ authorUserId: 'u1', message: 'main-2', features: [f('a'), f('b')] });
    r.checkout('alt');
    const altHead = r.commit({ authorUserId: 'u1', message: 'alt-1', features: [f('a'), f('c')] });
    const lca = r.lowestCommonAncestor(altHead.id, mainHead.id);
    expect(lca?.id).toBe(c1.id);
  });

  it('cherry-pick produces new commit', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.branch('alt');
    r.checkout('alt');
    const sourceC = r.commit({ authorUserId: 'u1', message: 'alt feat', features: [f('a'), f('b')] });
    r.checkout('main');
    const cpd = r.cherryPick(sourceC.id, 'u1');
    expect(cpd.message).toContain('Cherry-pick');
  });

  it('tag attaches to commit', () => {
    const r = new VersionRepo([f('a')], 'u1');
    const c = r.current().commit;
    r.tag(c.id, 'v1.0');
    expect(r.getCommit(c.id)?.tags).toContain('v1.0');
  });
});

// ── permissions ─────────────────────────────────────────────────────

describe('permissions', () => {
  const entries: PermissionEntry[] = [
    { principal: 'user1', branchPattern: 'main', role: 'reader' },
    { principal: 'user1', branchPattern: 'feature-*', role: 'writer' },
    { principal: 'team:design', branchPattern: '*', role: 'maintainer' },
    { principal: 'admin1', branchPattern: '*', role: 'admin' },
  ];

  const ctx = (overrides: Partial<PermissionContext>): PermissionContext => ({
    userId: 'user1', teamIds: [], branchName: 'main', ...overrides,
  });

  it('effectiveRole resolves most permissive match', () => {
    expect(effectiveRole(entries, ctx({}))).toBe('reader');
  });

  it('team membership upgrades role', () => {
    expect(effectiveRole(entries, ctx({ teamIds: ['design'] }))).toBe('maintainer');
  });

  it('branch pattern wildcard works', () => {
    expect(effectiveRole(entries, ctx({ branchName: 'feature-foo' }))).toBe('writer');
  });

  it('admin can do everything', () => {
    expect(can('force-push', entries, ctx({ userId: 'admin1' }))).toBe(true);
  });

  it('reader cannot commit', () => {
    expect(canCommit(entries, ctx({}))).toBe(false);
  });

  it('writer cannot merge', () => {
    expect(canMerge(entries, ctx({ branchName: 'feature-x' }))).toBe(false);
  });

  it('canView true for any matched user', () => {
    expect(canView(entries, ctx({}))).toBe(true);
  });

  it('no matching entry denies all', () => {
    expect(canView([], ctx({}))).toBe(false);
  });
});

// ── 3-way merge ─────────────────────────────────────────────────────

describe('mergeFeatures', () => {
  it('clean merge when only one side changes', () => {
    const r = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [f('a', { radius: 5 })],
      theirs: [f('a', { radius: 3 })],
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged[0]!.params.radius).toBe(5);
  });

  it('detects modify-modify conflict', () => {
    const r = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [f('a', { radius: 5 })],
      theirs: [f('a', { radius: 7 })],
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.kind).toBe('modify-modify');
  });

  it('takes consistent change when both sides agree', () => {
    const r = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [f('a', { radius: 5 })],
      theirs: [f('a', { radius: 5 })],
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged[0]!.params.radius).toBe(5);
  });

  it('handles add-add agreement', () => {
    const r = mergeFeatures({
      base: [],
      ours: [f('a')],
      theirs: [f('a')],
    });
    expect(r.merged).toHaveLength(1);
  });

  it('detects delete-modify when ours deletes and theirs modifies', () => {
    const r = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [],
      theirs: [f('a', { radius: 5 })],
    });
    expect(r.conflicts[0]!.kind).toBe('delete-modify');
  });

  it('detects modify-delete when ours modifies and theirs deletes', () => {
    const r = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [f('a', { radius: 5 })],
      theirs: [],
    });
    expect(r.conflicts[0]!.kind).toBe('modify-delete');
  });

  it('resolveConflict applies user choice', () => {
    const result = mergeFeatures({
      base: [f('a', { radius: 3 })],
      ours: [f('a', { radius: 5 })],
      theirs: [f('a', { radius: 7 })],
    });
    const resolved = resolveConflict(result, 'a', 'ours');
    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.merged.find(x => x.id === 'a')?.params.radius).toBe(5);
  });
});

// ── history layout + diff ───────────────────────────────────────────

describe('history view', () => {
  it('layoutCommitGraph assigns columns', () => {
    const r = new VersionRepo([f('a')], 'u1');
    r.commit({ authorUserId: 'u1', message: 'c2', features: [f('a'), f('b')] });
    const graph = layoutCommitGraph(r.listCommits());
    expect(graph.nodes).toHaveLength(2);
    expect(graph.columnCount).toBeGreaterThanOrEqual(1);
  });

  it('diffCommits detects added / removed / modified', () => {
    const r = new VersionRepo([f('a', { radius: 3 })], 'u1');
    const c1 = r.current().commit;
    const c2 = r.commit({
      authorUserId: 'u1', message: 'change',
      features: [f('a', { radius: 5 }), f('b')],
    });
    const d = diffCommits(c1, c2);
    expect(d.added).toBe(1);
    expect(d.modified).toBe(1);
    expect(d.removed).toBe(0);
  });

  it('diffCommits reports param changes', () => {
    const r = new VersionRepo([f('a', { radius: 3 })], 'u1');
    const c1 = r.current().commit;
    const c2 = r.commit({
      authorUserId: 'u1', message: 'r',
      features: [f('a', { radius: 5 })],
    });
    const d = diffCommits(c1, c2);
    const mod = d.entries.find(e => e.kind === 'modified');
    expect(mod?.changedParams?.[0]?.before).toBe(3);
    expect(mod?.changedParams?.[0]?.after).toBe(5);
  });
});
