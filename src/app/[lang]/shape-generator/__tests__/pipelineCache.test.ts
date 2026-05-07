/**
 * Pipeline cache unit tests.
 *
 * Validates LRU behaviour, clone-on-hit, and key stability.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { cacheGet, cachePut, cacheDelete, featureCacheKey, stampGeoId, getGeoId } from '../features/pipelineCache';
import type { FeatureInstance } from '../features/types';

function makeGeo(size = 10): THREE.BufferGeometry {
  return new THREE.BoxGeometry(size, size, size);
}

function makeFeature(
  type: string,
  params: Record<string, number> = {},
): FeatureInstance {
  return {
    id: `feat_${Math.random().toString(36).slice(2, 8)}`,
    type: type as FeatureInstance['type'],
    params,
    enabled: true,
    sketchData: undefined,
  };
}

describe('stampGeoId / getGeoId', () => {
  it('stamps a unique id onto a geometry', () => {
    const geo = makeGeo();
    const id = stampGeoId(geo);
    expect(id).toBeTruthy();
    expect(getGeoId(geo)).toBe(id);
  });

  it('returns existing id without overwriting', () => {
    const geo = makeGeo();
    const first = stampGeoId(geo);
    const second = stampGeoId(geo); // should return existing
    expect(first).toBe(second);
  });

  it('allows explicit id override', () => {
    const geo = makeGeo();
    stampGeoId(geo, 'custom_id_123');
    expect(getGeoId(geo)).toBe('custom_id_123');
  });

  it('returns null for geometry with no id', () => {
    const geo = makeGeo();
    expect(getGeoId(geo)).toBeNull();
  });
});

describe('featureCacheKey', () => {
  it('produces the same key for identical feature + upstream', () => {
    const f = makeFeature('fillet', { radius: 3, segments: 4 });
    const k1 = featureCacheKey(f, 'upstream_001');
    const k2 = featureCacheKey(f, 'upstream_001');
    expect(k1).toBe(k2);
  });

  it('produces different keys for different params', () => {
    const f1 = makeFeature('fillet', { radius: 3 });
    const f2 = makeFeature('fillet', { radius: 5 });
    const k1 = featureCacheKey(f1, 'upstream_001');
    const k2 = featureCacheKey(f2, 'upstream_001');
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different upstream ids', () => {
    const f = makeFeature('fillet', { radius: 3 });
    const k1 = featureCacheKey(f, 'upstream_A');
    const k2 = featureCacheKey(f, 'upstream_B');
    expect(k1).not.toBe(k2);
  });

  it('is stable regardless of param key order', () => {
    const f1 = makeFeature('scale', { x: 1, y: 2, z: 3 });
    const f2 = makeFeature('scale', { z: 3, x: 1, y: 2 });
    const k1 = featureCacheKey(f1, 'up');
    const k2 = featureCacheKey(f2, 'up');
    expect(k1).toBe(k2);
  });

  it('separates mesh vs OCCT cache namespaces for the same upstream + params', () => {
    const f = makeFeature('fillet', { radius: 2 });
    const km = featureCacheKey(f, 'upstream_001', 'mesh');
    const ko = featureCacheKey(f, 'upstream_001', 'occt');
    expect(km).not.toBe(ko);
    expect(km.startsWith('mesh::')).toBe(true);
    expect(ko.startsWith('occt::')).toBe(true);
  });
});

describe('cacheDelete', () => {
  it('removes a stored key', () => {
    const geo = makeGeo(5);
    stampGeoId(geo, 'del_test_geo');
    cachePut('del_test_key', geo);
    expect(cacheGet('del_test_key')).not.toBeNull();
    cacheDelete('del_test_key');
    expect(cacheGet('del_test_key')).toBeNull();
  });
});

describe('cacheGet / cachePut', () => {
  it('returns null for a key that has never been cached', () => {
    const hit = cacheGet('nonexistent_key_xyz_12345');
    expect(hit).toBeNull();
  });

  it('round-trips a geometry through the cache', () => {
    const geo = makeGeo(20);
    stampGeoId(geo, 'test_geo_001');
    cachePut('test_key_001', geo);

    const hit = cacheGet('test_key_001');
    expect(hit).not.toBeNull();
    expect(hit!.attributes.position.count).toBe(geo.attributes.position.count);
  });

  it('returns a clone, not the original reference', () => {
    const geo = makeGeo(20);
    stampGeoId(geo, 'test_geo_002');
    cachePut('test_key_002', geo);

    const hit = cacheGet('test_key_002');
    expect(hit).not.toBe(geo); // different object reference
    expect(hit!.attributes.position.count).toBe(geo.attributes.position.count);
  });

  it('mutating the cached clone does not corrupt future hits', () => {
    const geo = makeGeo(20);
    stampGeoId(geo, 'test_geo_003');
    cachePut('test_key_003', geo);

    const hit1 = cacheGet('test_key_003')!;
    // Mutate the clone
    const pos = hit1.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, 999, 999, 999);

    // Second hit should still have original data
    const hit2 = cacheGet('test_key_003')!;
    expect(hit2.attributes.position.getX(0)).not.toBe(999);
  });
});
