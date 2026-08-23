/**
 * documentPersistence.test.ts — G4 carry-over.
 *
 * Proves the CLIENT fetch layer that bridges the in-memory PDM graph to the
 * server documents version stack, at the fetch-mock level (the server routes
 * are consumed, never modified). Covers:
 *   - envelope encode/decode round-trip (structure + branch/merge parents)
 *   - POST maps commit → explicit snapshot (label + optional branch/parent)
 *   - typed failure IR (locked / offline) — never a silent drop
 *   - GET → reconstructGraph rebuilds the commit graph (2-parent merge kept)
 */

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Commit } from './versionBranch';
import {
  encodeCommitEnvelope,
  decodeCommitEnvelope,
  pushCommitVersion,
  fetchVersionHistory,
  fetchVersionSnapshot,
  checkoutVersion,
  decodeYjsSnapshotJson,
  reconstructGraph,
  PersistenceError,
  ENVELOPE_PREFIX,
  type PublicVersion,
} from './documentPersistence';

const commit = (over: Partial<Commit> = {}): Commit => ({
  id: 'c_1_aaa',
  parents: [],
  authorUserId: 'alice',
  timestamp: 1_700_000_000_000,
  message: 'Initial commit',
  features: [],
  ...over,
});

const version = (over: Partial<PublicVersion> = {}): PublicVersion => ({
  id: 'v1',
  documentId: 'doc-1',
  parentVersionId: null,
  blobKey: 'k',
  oplogKey: null,
  label: null,
  branchName: null,
  isExplicit: true,
  sizeBytes: 0,
  restoredFrom: null,
  gateStatus: null,
  gateReport: null,
  createdBy: 'alice',
  createdAt: 1_700_000_000_000,
  ...over,
});

/** Minimal Response stub matching the fields the layer reads. */
const resp = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);

describe('commit envelope encode/decode', () => {
  it('round-trips structure, branch and author for a linear commit', () => {
    const c = commit({ id: 'c_2_bbb', parents: ['c_1_aaa'], message: 'Add hole' });
    const label = encodeCommitEnvelope(c, 'main');
    expect(label.startsWith(ENVELOPE_PREFIX)).toBe(true);
    const env = decodeCommitEnvelope(label)!;
    expect(env).toMatchObject({
      cid: 'c_2_bbb', p: ['c_1_aaa'], b: 'main', a: 'alice', m: 'Add hole',
    });
  });

  it('preserves TWO parents for a merge commit (merge meta round-trips)', () => {
    const merge = commit({ id: 'c_5_mmm', parents: ['c_3_xxx', 'c_4_yyy'], message: 'Merge alt' });
    const env = decodeCommitEnvelope(encodeCommitEnvelope(merge, 'main'))!;
    expect(env.p).toEqual(['c_3_xxx', 'c_4_yyy']);
  });

  it('truncates a long message but never the structure, staying within 100 chars', () => {
    const c = commit({ id: 'c_9_zzz', parents: ['c_8_www'], message: 'x'.repeat(400) });
    const label = encodeCommitEnvelope(c, 'experiment/lighter');
    expect(label.length).toBeLessThanOrEqual(100);
    const env = decodeCommitEnvelope(label)!;
    expect(env.cid).toBe('c_9_zzz');
    expect(env.p).toEqual(['c_8_www']);          // structure intact
    expect(env.b).toBe('experiment/lighter');
  });

  it('returns null for non-envelope labels (restore labels, plain labels, null)', () => {
    expect(decodeCommitEnvelope(null)).toBeNull();
    expect(decodeCommitEnvelope('Restored from #abc')).toBeNull();
    expect(decodeCommitEnvelope('Milestone v1')).toBeNull();
  });
});

describe('pushCommitVersion (POST)', () => {
  it('posts the label envelope; root commit sends label ONLY (no branch/parent)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(201, { version: version({ id: 'v1' }) }));
    const result = await pushCommitVersion('doc-1', commit(), 'main', { fetchImpl });

    expect(result.id).toBe('v1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/documents/doc-1/versions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const body = JSON.parse(init.body);
    expect(body.label.startsWith(ENVELOPE_PREFIX)).toBe(true);
    expect(body.branchName).toBeUndefined();       // no parent → no server branch
    expect(body.parentVersionId).toBeUndefined();
  });

  it('sends branchName + parentVersionId together when a parent version is known', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(201, { version: version({ id: 'v2' }) }));
    const branchCommit = commit({ id: 'c_3_ccc', parents: ['c_2_bbb'], message: 'branch work' });
    await pushCommitVersion('doc-1', branchCommit, 'experiment/lighter', {
      fetchImpl, parentVersionId: 'v-parent',
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.branchName).toBe('experiment/lighter');
    expect(body.parentVersionId).toBe('v-parent');
  });

  it('surfaces a 423 lock as PersistenceError reason=locked (never silent)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(423, { code: 'document.locked' }));
    await expect(pushCommitVersion('doc-1', commit(), 'main', { fetchImpl }))
      .rejects.toMatchObject({ reason: 'locked' });
  });

  it('maps a network throw to reason=offline', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(pushCommitVersion('doc-1', commit(), 'main', { fetchImpl }))
      .rejects.toBeInstanceOf(PersistenceError);
    await expect(pushCommitVersion('doc-1', commit(), 'main', { fetchImpl }))
      .rejects.toMatchObject({ reason: 'offline' });
  });
});

describe('fetchVersionHistory (GET) + reconstructGraph', () => {
  it('returns the versions array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, { versions: [version()] }));
    const rows = await fetchVersionHistory('doc-1', { fetchImpl });
    expect(rows).toHaveLength(1);
  });

  it('rebuilds the commit graph oldest-first, keeping a 2-parent merge', () => {
    // Server returns newest-first. Graph: root → (main c2) & (alt c3) → merge c4.
    const mk = (c: Commit, branch: string, vid: string, createdAt: number): PublicVersion =>
      version({ id: vid, label: encodeCommitEnvelope(c, branch), createdAt, createdBy: c.authorUserId });

    const root = commit({ id: 'c1', parents: [], message: 'root' });
    const c2 = commit({ id: 'c2', parents: ['c1'], message: 'main work' });
    const c3 = commit({ id: 'c3', parents: ['c1'], message: 'alt work', authorUserId: 'bob' });
    const c4 = commit({ id: 'c4', parents: ['c2', 'c3'], message: 'Merge alt into main' });

    const newestFirst: PublicVersion[] = [
      mk(c4, 'main', 'v4', 40),
      mk(c3, 'alt',  'v3', 30),
      mk(c2, 'main', 'v2', 20),
      mk(root, 'main', 'v1', 10),
    ];

    const graph = reconstructGraph(newestFirst);
    expect(graph.commits.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']); // oldest-first
    const merge = graph.commits.find(c => c.id === 'c4')!;
    expect(merge.parents).toEqual(['c2', 'c3']);                             // merge preserved
    expect(graph.commits.find(c => c.id === 'c3')!.author).toBe('bob');      // author round-trip
    expect(graph.branches.map(b => b.name).sort()).toEqual(['alt', 'main']);
    expect(graph.headBranch).toBe('main');
    expect(graph.skipped).toBe(0);
  });

  it('counts non-envelope versions as skipped, never reinterpreting them', () => {
    const rows: PublicVersion[] = [
      version({ id: 'v2', label: 'Restored from #abc', createdAt: 20 }),
      version({ id: 'v1', label: encodeCommitEnvelope(commit(), 'main'), createdAt: 10 }),
    ];
    const graph = reconstructGraph(rows);
    expect(graph.commits).toHaveLength(1);
    expect(graph.skipped).toBe(1);
  });
});

describe('PDM checkout payload restore', () => {
  it('downloads a signed JSON feature snapshot without treating it as a graph label', async () => {
    const snapshot = JSON.stringify({ featureTrees: { body: { nodes: [{ id: 'sketch-1' }] } }, parts: [{ id: 'body' }] });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(snapshot, { status: 200, headers: { 'content-type': 'application/json' } }));
    const out = await fetchVersionSnapshot(version({ id: 'v-json', blobUrl: 'https://signed/snapshot' }), { fetchImpl });
    expect(out.versionId).toBe('v-json');
    expect(out.contentType).toBe('json');
    expect(out.json).toMatchObject({ featureTrees: { body: { nodes: [{ id: 'sketch-1' }] } } });
  });

  it('decodes the existing CRDT state/snapshot convention from Yjs bytes', () => {
    const doc = new Y.Doc();
    doc.getMap<string>('state').set('snapshot', JSON.stringify({ features: [{ id: 'hole-1', type: 'hole', params: { diameter: 8 } }] }));
    const bytes = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    expect(decodeYjsSnapshotJson(bytes)).toMatchObject({ features: [{ id: 'hole-1', params: { diameter: 8 } }] });
  });

  it('restores a version and refreshes the current document URL', async () => {
    const restored = version({ id: 'v-restored', restoredFrom: 'v-source' });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(201, { version: restored }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ blobUrl: 'https://signed/current' }), { status: 200 }));
    const out = await checkoutVersion('doc-1', 'v-source', { fetchImpl });
    expect(out.version.id).toBe('v-restored');
    expect(out.currentBlobUrl).toBe('https://signed/current');
    expect(fetchImpl.mock.calls[0][0]).toContain('/versions/v-source/restore');
  });
});
