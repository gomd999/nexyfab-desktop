/**
 * kernelCorpus — ungated unit tests (no OCCT). Ring-buffer semantics,
 * geometry signatures, param sanitization, resolution updates, export.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  captureKernelFailure,
  resolveKernelFailure,
  getKernelCorpus,
  clearKernelCorpus,
  exportKernelCorpusJson,
  geometrySignature,
  KERNEL_CORPUS_VERSION,
} from './kernelCorpus';

beforeEach(() => clearKernelCorpus());

describe('geometrySignature', () => {
  it('null/empty geometry → empty signature', () => {
    expect(geometrySignature(null)).toEqual({
      bbox: null, vertexCount: 0, geoHash: 'empty', hasBrepHandle: false,
    });
  });

  it('captures bbox, vertex count and a stable hash', () => {
    const g = new THREE.BoxGeometry(10, 20, 30);
    const s1 = geometrySignature(g);
    expect(s1.vertexCount).toBeGreaterThan(0);
    expect(s1.bbox).toEqual([-5, -10, -15, 5, 10, 15]);
    expect(s1.hasBrepHandle).toBe(false);
    // Deterministic: same geometry → same hash; different size → different hash.
    expect(geometrySignature(new THREE.BoxGeometry(10, 20, 30)).geoHash).toBe(s1.geoHash);
    expect(geometrySignature(new THREE.BoxGeometry(11, 20, 30)).geoHash).not.toBe(s1.geoHash);
  });

  it('picks up the B-rep handle flag and the feature stack from userData', () => {
    const g = new THREE.BoxGeometry(5, 5, 5);
    g.userData.occtHandle = 'occt:3';
    g.userData.nfabFeatureStack = ['sketchExtrude', 'fillet'];
    const s = geometrySignature(g);
    expect(s.hasBrepHandle).toBe(true);
    expect(s.featureStack).toEqual(['sketchExtrude', 'fillet']);
  });
});

describe('captureKernelFailure', () => {
  it('stores a versioned, sanitized record', () => {
    const g = new THREE.BoxGeometry(10, 10, 10);
    const rec = captureKernelFailure({
      op: 'fillet',
      params: { radius: 8, nested: { evil: true } as unknown as number, label: 'x'.repeat(200) },
      geometry: g,
      error: new Error('StdFail_NotDone: fillet failed'),
      forward: false,
    });
    expect(rec.v).toBe(KERNEL_CORPUS_VERSION);
    expect(rec.op).toBe('fillet');
    expect(rec.params.radius).toBe(8);
    expect(rec.params.nested).toBeUndefined(); // objects dropped
    expect((rec.params.label as string).length).toBeLessThanOrEqual(80);
    expect(rec.error).toContain('StdFail_NotDone');
    expect(rec.base.vertexCount).toBeGreaterThan(0);
    expect(rec.resolution.strategy).toBe('none');
    expect(getKernelCorpus()).toHaveLength(1);
  });

  it('caps the ring buffer', () => {
    for (let i = 0; i < 60; i++) {
      captureKernelFailure({ op: 'shell', error: `e${i}`, forward: false });
    }
    const corpus = getKernelCorpus();
    expect(corpus.length).toBe(40);
    // Oldest dropped, newest kept.
    expect(corpus[corpus.length - 1]!.error).toBe('e59');
    expect(corpus[0]!.error).toBe('e20');
  });

  it('never throws on hostile input', () => {
    expect(() => captureKernelFailure({
      op: 'boolean',
      error: { weird: true },
      geometry: {} as never,
      forward: false,
    })).not.toThrow();
  });
});

describe('resolveKernelFailure', () => {
  it('updates the resolution of a captured record', () => {
    const rec = captureKernelFailure({ op: 'fillet', params: { radius: 8 }, error: 'boom', forward: false });
    resolveKernelFailure(rec.id, {
      strategy: 'reduced-radius',
      requested: { radius: 8 },
      applied: { radius: 4 },
      detail: 'radius 8 → 4 mm',
    });
    const stored = getKernelCorpus().find(r => r.id === rec.id)!;
    expect(stored.resolution.strategy).toBe('reduced-radius');
    expect(stored.resolution.applied).toEqual({ radius: 4 });
  });

  it('no-ops for unknown ids', () => {
    expect(() => resolveKernelFailure('kc_missing', { strategy: 'none' })).not.toThrow();
  });
});

describe('exportKernelCorpusJson', () => {
  it('round-trips through JSON', () => {
    captureKernelFailure({ op: 'draft', params: { angle: 5 }, error: 'draft failed', forward: false });
    const parsed = JSON.parse(exportKernelCorpusJson()) as unknown[];
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { op: string }).op).toBe('draft');
  });
});
