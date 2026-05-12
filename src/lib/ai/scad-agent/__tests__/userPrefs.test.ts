/**
 * Y3 — User preferences tools (set/get/forget) and validation rules.
 *
 * Confirms the contract the system prompt advertises: keys are
 * normalized to lowercase a-z0-9_, values are size-capped, and the
 * session.userPrefs map is the single source of truth that the
 * runScadAgent loop will surface in the system prompt.
 */

import { describe, it, expect } from 'vitest';
import { makeTools } from '../tools';
import type { AgentSession } from '../types';

function makeSession(): AgentSession {
  return {
    id: 'test',
    scadSource: '',
    modules: {}, composition: null, designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {}, mates: [], gdtFrames: [], docRefs: [],
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
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

const tools = makeTools({
  render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: Date.now() }),
  geometry: async () => ({}),
  dfm: async () => ({ summary: '', issuesCount: 0 }),
});

describe('set_user_pref', () => {
  it('stores a valid key/value', async () => {
    const session = makeSession();
    const r = await tools.set_user_pref!({ key: 'units', value: 'mm' }, session);
    expect(r.ok).toBe(true);
    expect(session.userPrefs?.units).toBe('mm');
  });

  it('lowercases the key', async () => {
    const session = makeSession();
    await tools.set_user_pref!({ key: 'UNITS', value: 'inch' }, session);
    expect(session.userPrefs?.units).toBe('inch');
    expect(session.userPrefs?.UNITS).toBeUndefined();
  });

  it('rejects invalid characters in key', async () => {
    const session = makeSession();
    const r = await tools.set_user_pref!({ key: 'my.key!', value: 'x' }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('rejects empty value (use forget_user_pref instead)', async () => {
    const session = makeSession();
    const r = await tools.set_user_pref!({ key: 'units', value: '' }, session);
    expect(r.ok).toBe(false);
  });

  it('caps value to 200 chars', async () => {
    const session = makeSession();
    await tools.set_user_pref!({ key: 'note', value: 'A'.repeat(500) }, session);
    expect(session.userPrefs?.note?.length).toBe(200);
  });
});

describe('get_user_prefs', () => {
  it('reports no prefs when empty', async () => {
    const r = await tools.get_user_prefs!({}, makeSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatch(/No saved preferences/);
  });

  it('returns the populated map in meta', async () => {
    const session = makeSession();
    session.userPrefs = { units: 'mm', default_process: '3d_printing' };
    const r = await tools.get_user_prefs!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.meta as { prefs: Record<string, string> }).prefs).toEqual({
        units: 'mm', default_process: '3d_printing',
      });
    }
  });
});

describe('forget_user_pref', () => {
  it('removes an existing key', async () => {
    const session = makeSession();
    session.userPrefs = { units: 'mm', extra: 'keep' };
    const r = await tools.forget_user_pref!({ key: 'units' }, session);
    expect(r.ok).toBe(true);
    expect(session.userPrefs).toEqual({ extra: 'keep' });
  });

  it('is idempotent (no-op when key absent)', async () => {
    const session = makeSession();
    const r = await tools.forget_user_pref!({ key: 'never_set' }, session);
    expect(r.ok).toBe(true);
  });
});
