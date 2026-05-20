import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchFeatureEdit, dispatchFeatureEditBatch, type FeatureStoreApi, type FeatureEditIntent } from './featureEditDispatcher';
import type { FeatureInstance } from '../features/types';

function mockStore(initial: FeatureInstance[] = []): FeatureStoreApi & {
  log: Array<[string, ...unknown[]]>;
} {
  const features = [...initial];
  const log: Array<[string, ...unknown[]]> = [];
  return {
    features,
    log,
    addFeatureWithParams(type, overrides) {
      log.push(['addFeatureWithParams', type, overrides]);
      features.push({ id: `f_${features.length}`, type, params: overrides, enabled: true });
    },
    addSketchFeature(profile, config, plane, operation, planeOffset = 0) {
      log.push(['addSketchFeature', plane, operation]);
      features.push({
        id: `f_${features.length}`,
        type: 'sketchExtrude',
        params: {},
        enabled: true,
        sketchData: { profile, config, plane, planeOffset, operation },
      });
    },
    updateFeatureParam(id, key, value) {
      log.push(['updateFeatureParam', id, key, value]);
      const f = features.find(f => f.id === id);
      if (f) f.params[key] = value;
    },
    removeFeature(id) {
      log.push(['removeFeature', id]);
      const i = features.findIndex(f => f.id === id);
      if (i >= 0) features.splice(i, 1);
    },
    moveFeature(id, newIndex) {
      log.push(['moveFeature', id, newIndex]);
      const i = features.findIndex(f => f.id === id);
      if (i >= 0) {
        const [f] = features.splice(i, 1);
        features.splice(newIndex, 0, f!);
      }
    },
    toggleFeature(id, enabled) {
      log.push(['toggleFeature', id, enabled]);
      const f = features.find(f => f.id === id);
      if (f) f.enabled = enabled;
    },
    clearAll() {
      log.push(['clearAll']);
      features.length = 0;
    },
  };
}

describe('dispatchFeatureEdit', () => {
  it('add_feature appends a new feature', () => {
    const store = mockStore();
    const r = dispatchFeatureEdit({ kind: 'add_feature', featureType: 'fillet', params: { radius: 3 } }, store);
    expect(r.applied).toBe(true);
    expect(store.features).toHaveLength(1);
    expect(store.features[0]!.type).toBe('fillet');
  });

  it('update_param mutates an existing feature', () => {
    const store = mockStore([{ id: 'f_0', type: 'fillet', params: { radius: 2 }, enabled: true }]);
    const r = dispatchFeatureEdit({ kind: 'update_param', featureId: 'f_0', paramKey: 'radius', value: 5 }, store);
    expect(r.applied).toBe(true);
    expect(store.features[0]!.params.radius).toBe(5);
  });

  it('update_param returns error for unknown feature', () => {
    const store = mockStore();
    const r = dispatchFeatureEdit({ kind: 'update_param', featureId: 'phantom', paramKey: 'x', value: 1 }, store);
    expect(r.applied).toBe(false);
    expect(r.errorReason).toMatch(/not found/);
  });

  it('remove_feature drops the feature', () => {
    const store = mockStore([{ id: 'f_0', type: 'fillet', params: {}, enabled: true }]);
    dispatchFeatureEdit({ kind: 'remove_feature', featureId: 'f_0' }, store);
    expect(store.features).toHaveLength(0);
  });

  it('reorder_feature changes index', () => {
    const store = mockStore([
      { id: 'a', type: 'fillet', params: {}, enabled: true },
      { id: 'b', type: 'chamfer', params: {}, enabled: true },
    ]);
    dispatchFeatureEdit({ kind: 'reorder_feature', featureId: 'a', newIndex: 1 }, store);
    expect(store.features.map(f => f.id)).toEqual(['b', 'a']);
  });

  it('reorder_feature rejects invalid index', () => {
    const store = mockStore([{ id: 'a', type: 'fillet', params: {}, enabled: true }]);
    const r = dispatchFeatureEdit({ kind: 'reorder_feature', featureId: 'a', newIndex: -5 }, store);
    expect(r.applied).toBe(false);
  });

  it('toggle_feature flips enabled', () => {
    const store = mockStore([{ id: 'a', type: 'fillet', params: {}, enabled: true }]);
    dispatchFeatureEdit({ kind: 'toggle_feature', featureId: 'a', enabled: false }, store);
    expect(store.features[0]!.enabled).toBe(false);
  });

  it('clear_all empties pipeline', () => {
    const store = mockStore([{ id: 'a', type: 'fillet', params: {}, enabled: true }]);
    dispatchFeatureEdit({ kind: 'clear_all' }, store);
    expect(store.features).toHaveLength(0);
  });

  it('replace_pipeline clears then reloads', () => {
    const store = mockStore([{ id: 'old', type: 'fillet', params: {}, enabled: true }]);
    const r = dispatchFeatureEdit({
      kind: 'replace_pipeline',
      features: [
        { id: 'new1', type: 'chamfer', params: { distance: 2 }, enabled: true },
        { id: 'new2', type: 'shell', params: { thickness: 1 }, enabled: true },
      ],
    }, store);
    expect(r.applied).toBe(true);
    expect(store.features).toHaveLength(2);
  });
});

describe('dispatchFeatureEditBatch', () => {
  let store: ReturnType<typeof mockStore>;
  beforeEach(() => { store = mockStore(); });

  it('runs intents sequentially', () => {
    const intents: FeatureEditIntent[] = [
      { kind: 'add_feature', featureType: 'fillet', params: { radius: 3 } },
      { kind: 'add_feature', featureType: 'chamfer', params: { distance: 1 } },
    ];
    const results = dispatchFeatureEditBatch(intents, store);
    expect(results.every(r => r.applied)).toBe(true);
    expect(store.features).toHaveLength(2);
  });

  it('continues on failure by default', () => {
    const intents: FeatureEditIntent[] = [
      { kind: 'update_param', featureId: 'phantom', paramKey: 'x', value: 1 },
      { kind: 'add_feature', featureType: 'fillet', params: { radius: 3 } },
    ];
    const results = dispatchFeatureEditBatch(intents, store);
    expect(results[0]!.applied).toBe(false);
    expect(results[1]!.applied).toBe(true);
  });

  it('stops on failure when option set', () => {
    const intents: FeatureEditIntent[] = [
      { kind: 'update_param', featureId: 'phantom', paramKey: 'x', value: 1 },
      { kind: 'add_feature', featureType: 'fillet', params: { radius: 3 } },
    ];
    const results = dispatchFeatureEditBatch(intents, store, { stopOnError: true });
    expect(results).toHaveLength(1);
    expect(store.features).toHaveLength(0);
  });
});
