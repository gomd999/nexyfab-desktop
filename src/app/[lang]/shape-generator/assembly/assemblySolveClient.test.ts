import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { solveAssemblyFromBrowser } from './assemblySolveClient';

const state: AssemblyState = {
  parts: [{
    id: 'p1', name: 'P1', partTemplateId: 'box',
    position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true,
  }],
  mates: [],
};
const tree: FeatureTree = {
  nodes: [{
    id: 'base', name: 'Base', dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10, direction: 'one_sided', mode: 'add',
    },
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe('embedded assembly solve client', () => {
  it('does not call the API when any part lacks active geometry', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(solveAssemblyFromBrowser(state, {})).rejects.toThrow(/FEATURE_TREES_INCOMPLETE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a compatibility stub response instead of presenting it as solved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ok: true, success: true, residuals: [], phase: 'stub' }),
    })));
    await expect(solveAssemblyFromBrowser(state, { p1: tree })).rejects.toThrow(/AUTHORITATIVE_SOLVER_REQUIRED/);
  });

  it('returns an authoritative real solve and always sends featureTrees', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      json: async () => ({ ok: true, success: true, state, dof: 0, residuals: [], phase: 'real' }),
      requestBody: init?.body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await solveAssemblyFromBrowser(state, { p1: tree });
    expect(result.phase).toBe('real');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.featureTrees.p1.nodes).toHaveLength(1);
  });
});
