/**
 * T — FEA tool tests with mock adapter (real CalculiX integration is
 * user-side; this validates the agent → adapter contract).
 */
import { describe, it, expect } from 'vitest';
import { makeTools, type FeaAdapter } from '../tools';
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

function host(fea?: FeaAdapter) {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    fea,
  };
}

const passingFea: FeaAdapter = {
  async setup() { return { ok: true, studyId: 'study_1', nodeCount: 1280, elementCount: 720 }; },
  async solve() { return { ok: true, converged: true, iterations: 8, elapsedMs: 1234 }; },
  async stress() { return { ok: true, maxStressMPa: 85, locationMm: [10, 5, 0], safetyFactor: 2.5 }; },
};

describe('fea_* tools', () => {
  it('NO_FEA without adapter', async () => {
    const tools = makeTools(host());
    const r = await tools.fea_setup!({ hostHandle: 'h', material: 'steel', constraints: [], loads: [] }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_FEA');
  });

  it('fea_setup validates required args', async () => {
    const tools = makeTools(host(passingFea));
    const r = await tools.fea_setup!({}, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('fea_setup → solve → stress reports safety factor', async () => {
    const tools = makeTools(host(passingFea));
    const session = blankSession();
    const setup = await tools.fea_setup!({
      hostHandle: 'h1', material: 'steel',
      constraints: [{ faceId: 'f0', type: 'fixed' }],
      loads: [{ faceId: 'f1', forceN: [0, 0, -500] }],
    }, session);
    expect(setup.ok).toBe(true);

    const solve = await tools.fea_solve!({ studyId: 'study_1' }, session);
    expect(solve.ok).toBe(true);
    if (solve.ok) expect(solve.output).toMatch(/converged/);

    const stress = await tools.fea_stress!({ studyId: 'study_1', measure: 'von_mises' }, session);
    expect(stress.ok).toBe(true);
    if (stress.ok) {
      expect(stress.output).toContain('85.0 MPa');
      expect(stress.output).toContain('safety factor 2.50');
    }
  });

  it('safety factor < 1 produces FAIL flag', async () => {
    const failFea: FeaAdapter = {
      ...passingFea,
      async stress() { return { ok: true, maxStressMPa: 350, locationMm: [0, 0, 0], safetyFactor: 0.7 }; },
    };
    const tools = makeTools(host(failFea));
    const r = await tools.fea_stress!({ studyId: 's' }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('FAIL');
  });

  it('non-converged solve surfaces WARN', async () => {
    const stuckFea: FeaAdapter = {
      ...passingFea,
      async solve() { return { ok: true, converged: false, iterations: 100, elapsedMs: 60_000 }; },
    };
    const tools = makeTools(host(stuckFea));
    const r = await tools.fea_solve!({ studyId: 's' }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('did NOT converge');
  });

  it('adapter failure flows as FEA_FAILED', async () => {
    const broken: FeaAdapter = {
      async setup() { return { ok: false, reason: 'mesh too small' }; },
      async solve() { return { ok: true, converged: true, iterations: 0, elapsedMs: 0 }; },
      async stress() { return { ok: false, reason: 'no result' }; },
    };
    const tools = makeTools(host(broken));
    const r = await tools.fea_setup!({
      hostHandle: 'h', material: 'steel', constraints: [], loads: [],
    }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FEA_FAILED');
  });
});
