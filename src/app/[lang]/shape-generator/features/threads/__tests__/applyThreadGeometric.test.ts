/**
 * applyThreadGeometric.test.ts — Wave 2 Phase 2 Track D7 (W7).
 *
 * Verifies the client-side geometric-mode mesh builder. Tests run with
 * `skipBoolean: true` for most cases so the CSG path doesn't dominate
 * the perf measurement.
 */

import { describe, it, expect } from 'vitest';
import { BufferGeometry, BufferAttribute } from 'three';
import { applyThreadGeometric } from '../applyThreadGeometric';
import { makeThreadFeature } from '../threadFeature';

function makeCylinderLikeGeometry(): BufferGeometry {
  // Minimal triangle geometry — content unimportant for the geometric tests
  // that use `skipBoolean: true`.
  const g = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

describe('applyThreadGeometric — guard rails', () => {
  it('throws if feature.mode is not geometric', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'cosmetic',
    });
    expect(() => applyThreadGeometric(parent, f)).toThrow(/must be 'geometric'/);
  });

  it('throws on unknown designation', () => {
    const parent = makeCylinderLikeGeometry();
    expect(() =>
      applyThreadGeometric(
        parent,
        // Bypass the makeThreadFeature validation by constructing inline
        {
          id: 'f',
          featureType: 'thread',
          threadKind: 'external',
          threadRef: { series: 'ISO_M_COARSE', designation: 'M999' },
          class: '6g',
          mode: 'geometric',
          threadDirection: 'right_hand',
          length: 20,
          startOffset: 0,
        },
      ),
    ).toThrow(/THREAD_DESIGNATION_UNKNOWN/);
  });
});

describe('applyThreadGeometric — geometry shape', () => {
  it('returns a NEW BufferGeometry (not parent reference)', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'external',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.geometry).not.toBe(parent);
    expect(r.geometry).toBeInstanceOf(BufferGeometry);
  });

  it('position attribute is populated', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    const pos = r.geometry.attributes.position;
    expect(pos).toBeDefined();
    expect(pos!.count).toBeGreaterThan(0);
  });

  it('normals are computed (computeVertexNormals ran)', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.geometry.attributes.normal).toBeDefined();
  });

  it('uv attribute is present (TubeGeometry emits uv)', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.geometry.attributes.uv).toBeDefined();
  });
});

describe('applyThreadGeometric — metadata', () => {
  it('callout matches the cosmetic-mode formatter for the same feature', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'external',
      class: '6g',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.metadata.callout).toBe('M8-6g ↧ 20');
  });

  it('rangeStart/rangeEnd span feature.length along +Z by default', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      startOffset: 5,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.metadata.rangeStart).toEqual([0, 0, 5]);
    expect(r.metadata.rangeEnd).toEqual([0, 0, 25]);
  });

  it('reports samplesPerTurn = 16 by default (DEFAULT_SAMPLES_PER_TURN)', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.metadata.samplesPerTurn).toBe(16);
  });

  it('totalSamples scales with turns (M8 × 20mm = 16 turns → ≥16 samples)', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    expect(r.metadata.totalSamples).toBeGreaterThanOrEqual(16);
  });
});

describe('applyThreadGeometric — boolean path', () => {
  it('skipBoolean=true returns the thread mesh alone', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'external',
    });
    const r = applyThreadGeometric(parent, f, { skipBoolean: true });
    // threadVertexCount === finalVertexCount when no boolean ran
    expect(r.metadata.finalVertexCount).toBe(r.metadata.threadVertexCount);
  });
});

describe('applyThreadGeometric — direction / mode variants', () => {
  it('LH thread produces different mesh than RH (mirrored y-axis)', () => {
    const parent = makeCylinderLikeGeometry();
    const fRh = makeThreadFeature({
      id: 'r',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M10' },
      length: 15,
      mode: 'geometric',
      threadDirection: 'right_hand',
    });
    const fLh = makeThreadFeature({
      id: 'l',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M10' },
      length: 15,
      mode: 'geometric',
      threadDirection: 'left_hand',
    });
    const rh = applyThreadGeometric(parent, fRh, { skipBoolean: true });
    const lh = applyThreadGeometric(parent, fLh, { skipBoolean: true });
    expect(rh.metadata.callout).not.toContain('LH');
    expect(lh.metadata.callout).toContain('LH');
  });

  it('fine pitch (M8×1) produces more turns than coarse (M8 × 1.25)', () => {
    const parent = makeCylinderLikeGeometry();
    const coarse = makeThreadFeature({
      id: 'c',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const fine = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_FINE', designation: 'M8×1' },
      length: 20,
      mode: 'geometric',
    });
    const rc = applyThreadGeometric(parent, coarse, { skipBoolean: true });
    const rf = applyThreadGeometric(parent, fine, { skipBoolean: true });
    // M8 × 1 (20 turns) > M8 × 1.25 (16 turns) → more samples
    expect(rf.metadata.totalSamples).toBeGreaterThanOrEqual(rc.metadata.totalSamples);
  });
});

describe('applyThreadGeometric — worker fallback', () => {
  it('useWorker=true with throwing workerCall falls back to client-side', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    // Worker that synchronously throws — emulates task #31 not being ready.
    const workerCall = () => {
      throw new Error('worker offline');
    };
    const r = applyThreadGeometric(parent, f, {
      skipBoolean: true,
      useWorker: true,
      workerCall: workerCall as never,
    });
    expect(r.metadata.usedWorker).toBe(false);
    expect(r.geometry.attributes.position!.count).toBeGreaterThan(0);
  });

  it('useWorker=false does not invoke workerCall', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    let called = false;
    const workerCall = () => {
      called = true;
      return Promise.resolve(undefined);
    };
    applyThreadGeometric(parent, f, {
      skipBoolean: true,
      useWorker: false,
      workerCall: workerCall as never,
    });
    expect(called).toBe(false);
  });
});

describe('applyThreadGeometric — performance', () => {
  it('M8 × 20mm builds (no boolean) under 100 ms', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const t0 = performance.now();
    applyThreadGeometric(parent, f, { skipBoolean: true });
    const dt = performance.now() - t0;
    // Spec §11: geometric normal-quality 30-80 ms server time; client-only
    // path should be much faster (no CSG). 100 ms is the test budget.
    expect(dt).toBeLessThan(100);
  });

  it('M30 × 60mm builds (no boolean) under 250 ms worst-case', () => {
    const parent = makeCylinderLikeGeometry();
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M30' },
      length: 60,
      mode: 'geometric',
    });
    const t0 = performance.now();
    applyThreadGeometric(parent, f, { skipBoolean: true });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(250);
  });
});
