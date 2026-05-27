import { describe, it, expect, vi } from 'vitest';
import { createScriptApi, type ScriptApiHost, SCRIPT_API_VERSION } from './scriptApi';

function mockHost(): ScriptApiHost & {
  features: Array<{ id: string; type: string; params: Record<string, number> }>;
} {
  const features: Array<{ id: string; type: string; params: Record<string, number> }> = [];
  let counter = 0;
  return {
    features,
    listFeatures: () => features as never,
    dispatchAdd: (type, params) => {
      const id = `f_${counter++}`;
      features.push({ id, type, params });
      return id;
    },
    dispatchExtrude: (profileKind, config) => {
      const id = `f_${counter++}`;
      features.push({ id, type: 'sketchExtrude', params: { profileKind: profileKind as never, ...(config as unknown as Record<string, number>) } });
      return id;
    },
    dispatchUpdateParam: (id, key, value) => {
      const f = features.find(f => f.id === id);
      if (f) f.params[key] = value;
    },
    dispatchRemove: (id) => {
      const i = features.findIndex(f => f.id === id);
      if (i >= 0) features.splice(i, 1);
    },
    dispatchReorder: (id, idx) => {
      const i = features.findIndex(f => f.id === id);
      if (i >= 0) {
        const [f] = features.splice(i, 1);
        features.splice(idx, 0, f!);
      }
    },
    dispatchToggle: vi.fn(),
    dispatchClearAll: () => { features.length = 0; },
    getBbox: () => ({ min: [0, 0, 0], max: [10, 10, 10] }),
    getMeshStats: () => ({ vertices: 8, triangles: 12 }),
    exportStl: async () => 'blob:fake',
    logSink: vi.fn(),
  };
}

describe('createScriptApi', () => {
  it('returns a frozen object', () => {
    const api = createScriptApi(mockHost());
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('version matches SCRIPT_API_VERSION', () => {
    const api = createScriptApi(mockHost());
    expect(api.version).toBe(SCRIPT_API_VERSION);
  });

  it('addFeature delegates to host and returns id', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    const id = api.addFeature('fillet', { radius: 3 });
    expect(id).toBe('f_0');
    expect(host.features).toHaveLength(1);
  });

  it('addFeature with no params uses empty default', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    const id = api.addFeature('fillet');
    expect(id).toBe('f_0');
    expect(host.features[0]!.params).toEqual({});
  });

  it('addExtrude defaults plane to xy + operation to add', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    api.addExtrude({ profile: 'rect', width: 50, height: 40, depth: 10 });
    expect(host.features[0]!.params.plane).toBe('xy');
    expect(host.features[0]!.params.operation).toBe('add');
  });

  it('updateParam mutates existing feature', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    const id = api.addFeature('fillet', { radius: 2 });
    api.updateParam(id, 'radius', 5);
    expect(host.features[0]!.params.radius).toBe(5);
  });

  it('removeFeature drops by id', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    const id = api.addFeature('fillet', { radius: 2 });
    api.removeFeature(id);
    expect(host.features).toHaveLength(0);
  });

  it('clearAll empties the store', () => {
    const host = mockHost();
    const api = createScriptApi(host);
    api.addFeature('fillet');
    api.addFeature('chamfer');
    api.clearAll();
    expect(host.features).toHaveLength(0);
  });

  it('log/warn/error route to the host log sink', () => {
    const host = mockHost();
    const sink = host.logSink as ReturnType<typeof vi.fn>;
    const api = createScriptApi(host);
    api.log('hello');
    api.warn('careful');
    api.error('boom');
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenNthCalledWith(1, 'info', ['hello']);
    expect(sink).toHaveBeenNthCalledWith(2, 'warn', ['careful']);
    expect(sink).toHaveBeenNthCalledWith(3, 'error', ['boom']);
  });

  it('exportStl returns a promise', async () => {
    const api = createScriptApi(mockHost());
    const url = await api.exportStl();
    expect(typeof url).toBe('string');
  });
});
