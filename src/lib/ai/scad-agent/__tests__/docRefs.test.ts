/**
 * R — DocRef tool tests with mock adapter.
 */
import { describe, it, expect } from 'vitest';
import { makeTools, type DocRefAdapter } from '../tools';
import type { AgentSession } from '../types';

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '', modules: {}, composition: null, designPlan: null,
    checkpoints: [], brepEntries: [], sketches: {}, mates: [], gdtFrames: [], docRefs: [], history: [],
    render: { ok: null, errors: [] }, geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

function host(docRefs?: DocRefAdapter) {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    docRefs,
  };
}

describe('import_doc_ref', () => {
  it('returns NO_DOC_REF without adapter', async () => {
    const tools = makeTools(host());
    const r = await tools.import_doc_ref!({ source: 'http://x.com/a.step' }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_DOC_REF');
  });

  it('rejects bad source', async () => {
    const tools = makeTools(host({ resolve: async () => ({ ok: true, brepHandle: 'h', format: 'step' }) }));
    const r = await tools.import_doc_ref!({}, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('STEP import registers as brepEntry + docRef', async () => {
    const adapter: DocRefAdapter = {
      async resolve() { return { ok: true, brepHandle: 'occt:42', format: 'step' as const }; },
    };
    const tools = makeTools(host(adapter));
    const session = blankSession();
    const r = await tools.import_doc_ref!({ source: 'https://example.com/part.step', label: 'imported_motor' }, session);
    expect(r.ok).toBe(true);
    expect(session.docRefs.length).toBe(1);
    expect(session.docRefs[0].brepHandle).toBe('occt:42');
    expect(session.brepEntries.length).toBe(1);
    expect(session.brepEntries[0].handle).toBe('occt:42');
  });

  it('SCAD import stores text source (no brepEntry)', async () => {
    const adapter: DocRefAdapter = {
      async resolve() { return { ok: true, scadSource: 'cube(10);', format: 'scad' as const }; },
    };
    const tools = makeTools(host(adapter));
    const session = blankSession();
    const r = await tools.import_doc_ref!({ source: 'lib/standard.scad' }, session);
    expect(r.ok).toBe(true);
    expect(session.docRefs[0].scadSource).toBe('cube(10);');
    expect(session.brepEntries.length).toBe(0);  // SCAD doesn't create a B-rep
  });

  it('adapter failure surfaces as IMPORT_FAILED', async () => {
    const adapter: DocRefAdapter = {
      async resolve() { return { ok: false, reason: 'HTTP 404' }; },
    };
    const tools = makeTools(host(adapter));
    const r = await tools.import_doc_ref!({ source: 'https://x.com/missing.step' }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('IMPORT_FAILED');
  });
});

describe('list_doc_refs', () => {
  it('empty hint when nothing imported', async () => {
    const tools = makeTools(host({ resolve: async () => ({ ok: true, format: 'step', brepHandle: 'h' }) }));
    const r = await tools.list_doc_refs!({}, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatch(/No external/);
  });

  it('lists imported docs', async () => {
    const adapter: DocRefAdapter = {
      async resolve() { return { ok: true, brepHandle: 'occt:1', format: 'step' as const }; },
    };
    const tools = makeTools(host(adapter));
    const session = blankSession();
    await tools.import_doc_ref!({ source: 'https://a.com/p.step', label: 'plate' }, session);
    await tools.import_doc_ref!({ source: 'https://b.com/q.step' }, session);
    const r = await tools.list_doc_refs!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('2 doc ref(s)');
      expect(r.output).toContain('plate');
    }
  });
});
