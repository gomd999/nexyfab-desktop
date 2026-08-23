// @vitest-environment jsdom

/**
 * sessionRepoStore.persist.test.ts — G4 carry-over: opt-in server persistence.
 *
 * Proves the additive persistence wiring on usePdmSessionStore:
 *   - UNBOUND session = pure in-memory, no network, no behavioural change
 *     (the regression guard for "미바인딩 = in-memory 무변경").
 *   - BOUND session pushes each commit as an explicit version snapshot and
 *     rebuilds the commit graph from the server history on reload — branch and
 *     2-parent merge metadata round-trip.
 *   - Failures surface as typed reasons (lastPersistError), never silently.
 *
 * A tiny in-memory fake stands in for the documents version route so the whole
 * commit → POST → GET → reconstruct loop is exercised end to end at the
 * fetch-mock level (real R2 blob round-trip is a documented follow-up).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { usePdmSessionStore } from './sessionRepoStore';
import type { FeatureInstance } from '../features/types';
import { encodeCommitEnvelope } from './documentPersistence';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

const store = () => usePdmSessionStore.getState();

beforeEach(() => {
  usePdmSessionStore.setState({
    repo: null, rev: 0, isDemo: false, pendingMerge: null, aiRuns: [],
    documentId: null, persistFetch: null, lastPersistError: null,
    versionIdByCommit: {}, restoredGraph: null,
  });
});

/** In-memory stand-in for `/api/documents/[id]/versions` (POST create + GET
 *  list newest-first). Records exactly the fields publicVersionShape returns. */
function makeFakeServer(pusher = 'alice') {
  interface Row {
    id: string; documentId: string; parentVersionId: string | null;
    label: string | null; branchName: string | null;
    gateStatus: 'passed' | 'failed' | null; gateReport: unknown[] | null;
    createdBy: string; createdAt: number;
  }
  const rows: Row[] = [];
  let seq = 0;
  let clock = 1_700_000_000_000;

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const docMatch = /\/api\/documents\/([^/]+)\/versions$/.exec(url);
    const documentId = docMatch ? decodeURIComponent(docMatch[1]) : 'doc';

    if (method === 'POST') {
      const body = JSON.parse(String(init!.body));
      const id = `v${++seq}`;
      // Mirror the real route's gate-report derivation (advisory only).
      const gates = Array.isArray(body.gateReport) ? body.gateReport : null;
      const row: Row = {
        id, documentId,
        parentVersionId: body.parentVersionId ?? null,
        label: body.label ?? null,
        branchName: body.branchName ?? null,
        gateStatus: gates && gates.length > 0 ? (gates.every((g: { pass: boolean }) => g.pass) ? 'passed' : 'failed') : null,
        gateReport: gates && gates.length > 0 ? gates : null,
        createdBy: pusher,
        createdAt: ++clock,
      };
      rows.push(row);
      return json(201, { ok: true, version: shape(row) });
    }
    // GET — newest first.
    const list = rows.filter(r => r.documentId === documentId)
      .slice().sort((a, b) => b.createdAt - a.createdAt).map(shape);
    return json(200, { ok: true, versions: list, docVersion: rows.length });
  }) as unknown as typeof fetch;

  const shape = (r: Row) => ({
    id: r.id, documentId: r.documentId, parentVersionId: r.parentVersionId,
    blobKey: `k/${r.id}`, oplogKey: null, label: r.label, branchName: r.branchName,
    isExplicit: true, sizeBytes: 0, restoredFrom: null,
    gateStatus: r.gateStatus, gateReport: r.gateReport,
    createdBy: r.createdBy, createdAt: r.createdAt,
  });
  const json = (status: number, b: unknown): Response =>
    ({ ok: status < 300, status, json: async () => b } as unknown as Response);

  return { fetchImpl, rows };
}

describe('unbound session = pure in-memory (regression guard)', () => {
  it('commitAndPersist commits in memory and reports not_bound with NO network call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    store().init([f('a')], 'alice');
    const { commit, persist } = await store().commitAndPersist([f('a'), f('b')], 'second', 'alice');

    expect(commit).not.toBeNull();
    expect(store().repo!.listCommits()).toHaveLength(2);   // in-memory history advanced
    expect(persist).toEqual({ ok: false, reason: 'not_bound' });
    expect(store().lastPersistError).toBeNull();            // not_bound is not an error
    expect(spy).not.toHaveBeenCalled();                     // never touched the network
    spy.mockRestore();
  });

  it('loadHistory on an unbound session is a not_bound no-op', async () => {
    const res = await store().loadHistory();
    expect(res).toEqual({ ok: false, reason: 'not_bound' });
  });
});

describe('bound session pushes commits as version snapshots', () => {
  it('maps each commit id to the server version id', async () => {
    const srv = makeFakeServer();
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });

    const root = store().repo!.current().commit;
    const r0 = await store().persistCommit(root);
    const { commit, persist } = await store().commitAndPersist([f('a'), f('b')], 'add b', 'alice');

    expect(r0.ok).toBe(true);
    expect(persist.ok).toBe(true);
    expect(store().versionIdByCommit[root.id]).toBe(r0.versionId);
    expect(store().versionIdByCommit[commit!.id]).toBe(persist.versionId);
    expect(srv.rows).toHaveLength(2);
  });
});

describe('commit graph round-trips through the server history', () => {
  it('reload reconstructs branch + 2-parent merge from GET', async () => {
    const srv = makeFakeServer();
    // Build main→(alt)→merge in memory, persisting every commit.
    store().init([f('a', { r: 3 })], 'alice');
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });
    const rootC = store().repo!.current().commit;
    await store().persistCommit(rootC);                              // root

    store().createBranch('alt');                                      // HEAD → alt
    const altC = store().commit([f('a', { r: 5 })], 'alt change', 'alice')!;
    await store().persistCommit(altC);

    store().checkout('main');
    const mainC = store().commit([f('a', { r: 7 })], 'main change', 'alice')!;
    await store().persistCommit(mainC);

    store().startMerge('alt');
    store().resolvePending('a', 'ours');
    const mergeC = store().applyMerge('alice')!;
    const mp = await store().persistCommit(mergeC);
    expect(mp.ok).toBe(true);
    expect(mergeC.parents).toHaveLength(2);

    // ── Simulate a refresh: fresh session, same document, load from server ──
    usePdmSessionStore.setState({
      repo: null, rev: 0, isDemo: false, pendingMerge: null, aiRuns: [],
      documentId: null, persistFetch: null, lastPersistError: null,
      versionIdByCommit: {}, restoredGraph: null,
    });
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });
    const res = await store().loadHistory();

    expect(res.ok).toBe(true);
    const graph = res.graph!;
    // All four commits recovered, oldest-first (root first), lineage intact.
    expect(graph.commits.map(c => c.id)).toEqual([rootC.id, altC.id, mainC.id, mergeC.id]);
    const merge = graph.commits.find(c => c.id === mergeC.id)!;
    expect(merge.parents).toEqual([mainC.id, altC.id]);              // merge meta preserved
    expect(graph.commits.find(c => c.id === altC.id)!.branch).toBe('alt'); // branch meta preserved
    expect(graph.branches.map(b => b.name).sort()).toEqual(['alt', 'main']);
    expect(graph.headBranch).toBe('main');
    expect(graph.skipped).toBe(0);
    // Lineage map rebuilt so a further branch-commit push still has parents.
    expect(store().versionIdByCommit[mergeC.id]).toBe(mp.versionId);
  });
});

describe('gate report passthrough (advisory, 260723)', () => {
  it('commitAndPersist forwards gateReport and it round-trips as a badge on reload', async () => {
    const srv = makeFakeServer();
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });

    const { commit, persist } = await store().commitAndPersist(
      [f('a'), f('b')], 'add b', 'alice',
      [{ id: 'geometry.watertight', pass: true }],
    );
    expect(persist.ok).toBe(true);
    expect(srv.rows[0].gateStatus).toBe('passed');

    const res = await store().loadHistory();
    const badge = res.graph!.commits.find(c => c.id === commit!.id);
    expect(badge?.gateStatus).toBe('passed');
  });

  it('a failed gate is recorded as gateStatus=failed but the push still succeeds', async () => {
    const srv = makeFakeServer();
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });

    const root = store().repo!.current().commit;
    const r0 = await store().persistCommit(root, [{ id: 'dimension.measured', pass: false, reason: 'oversize' }]);
    expect(r0.ok).toBe(true);              // advisory only — never blocks the write
    expect(srv.rows[0].gateStatus).toBe('failed');
  });

  it('omitting gateReport leaves gateStatus null (always-safe default)', async () => {
    const srv = makeFakeServer();
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl: srv.fetchImpl });

    const root = store().repo!.current().commit;
    await store().persistCommit(root);
    expect(srv.rows[0].gateStatus).toBeNull();
  });
});

describe('persistence failures are surfaced, never silent', () => {
  it('a 423 lock sets lastPersistError with reason=locked', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      { ok: false, status: 423, json: async () => ({ code: 'document.locked' }) } as unknown as Response,
    ) as unknown as typeof fetch;
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl });

    const res = await store().persistCommit(store().repo!.current().commit);
    expect(res).toMatchObject({ ok: false, reason: 'locked' });
    expect(store().lastPersistError?.reason).toBe('locked');
  });

  it('an offline network throw yields reason=offline', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    store().init([f('a')], 'alice');
    store().bindDocument('doc-1', { fetchImpl });
    const res = await store().persistCommit(store().repo!.current().commit);
    expect(res).toMatchObject({ ok: false, reason: 'offline' });
    expect(store().lastPersistError?.reason).toBe('offline');
  });
});

describe('server checkout restores the immutable model payload', () => {
  it('decodes Yjs features, performs server restore, and emits the live-model event', async () => {
    store().init([f('base', { r: 2 })], 'alice');
    const commit = store().repo!.current().commit;
    const ydoc = new Y.Doc();
    ydoc.getMap<string>('state').set('snapshot', JSON.stringify({ features: [f('restored-hole', { diameter: 8 })] }));
    const bytes = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    const version = {
      id: 'v1', documentId: 'doc-1', parentVersionId: null, blobKey: 'k/v1', blobUrl: 'https://signed/v1',
      oplogKey: null, label: encodeCommitEnvelope(commit, 'main'), branchName: null, isExplicit: true,
      sizeBytes: bytes.length, restoredFrom: null, gateStatus: null, gateReport: null, createdBy: 'alice', createdAt: 1,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://signed/v1') return new Response(new Uint8Array(bytes).buffer, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      if (url.endsWith('/versions') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ versions: [version] }), { status: 200 });
      if (url.endsWith('/versions/v1/restore')) return new Response(JSON.stringify({ version: { ...version, id: 'v2', restoredFrom: 'v1' } }), { status: 201 });
      if (url.endsWith('/api/documents/doc-1')) return new Response(JSON.stringify({ blobUrl: 'https://signed/current' }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    store().bindDocument('doc-1', { fetchImpl });
    usePdmSessionStore.setState({ versionIdByCommit: { [commit.id]: 'v1' } });
    const events: Array<{ commit?: { features?: FeatureInstance[] }; snapshot?: { currentBlobUrl?: string } }> = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('nexyfab:pdm-checkout-restore', listener);
    const result = await store().checkoutServerVersion(commit.id);
    window.removeEventListener('nexyfab:pdm-checkout-restore', listener);
    expect(result).toMatchObject({ ok: true, versionId: 'v1' });
    expect(events[0]?.commit?.features?.[0]?.id).toBe('restored-hole');
    expect(events[0]?.snapshot?.currentBlobUrl).toBe('https://signed/current');
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/versions/v1/restore'))).toBe(true);
  });
});
