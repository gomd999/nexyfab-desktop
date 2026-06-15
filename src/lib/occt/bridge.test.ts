/**
 * occt/bridge — stub bridge tests.
 *
 * Covers the contract documented in bridge.ts module JSDoc. The WASM bridge
 * is currently a throwing stub; once it lands, the same suite should be
 * runnable against `createWasmBridge()` with minor numerical-tolerance
 * adjustments.
 */
import { describe, it, expect } from 'vitest';
import { createStubBridge, createWasmBridge } from './bridge';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectExtrude(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: 7,
    direction: 'one_sided',
    mode: 'add',
  };
}

function rectExtrudeAt(x0: number, y0: number, w: number, h: number, depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: x0, y: y0 },
      { x: x0 + w, y: y0 },
      { x: x0 + w, y: y0 + h },
      { x: x0, y: y0 + h },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function diskRevolve(): RevolveFeature {
  // Canonical: profile in X≥0, axis = +Y. Disk of radius 4, height 2.
  return {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
}

// ─── construction ─────────────────────────────────────────────────────────

describe('createStubBridge', () => {
  it('returns an OcctBridge with all methods', () => {
    const bridge = createStubBridge();
    expect(typeof bridge.buildFromExtrude).toBe('function');
    expect(typeof bridge.buildFromRevolve).toBe('function');
    expect(typeof bridge.boolean.union).toBe('function');
    expect(typeof bridge.boolean.subtract).toBe('function');
    expect(typeof bridge.boolean.intersect).toBe('function');
    expect(typeof bridge.fillet).toBe('function');
    expect(typeof bridge.chamfer).toBe('function');
    expect(typeof bridge.exportSTEP).toBe('function');
    expect(typeof bridge.importSTEP).toBe('function');
    expect(typeof bridge.release).toBe('function');
  });

  it('issues distinct ids per call (no aliasing)', async () => {
    const bridge = createStubBridge();
    const a = await bridge.buildFromExtrude(rectExtrude());
    const b = await bridge.buildFromExtrude(rectExtrude());
    expect(a.shape!.id).not.toBe(b.shape!.id);
  });
});

// ─── buildFromExtrude ─────────────────────────────────────────────────────

describe('stub.buildFromExtrude', () => {
  it('rect 10x5x7 → solid shape with matching bbox', async () => {
    const bridge = createStubBridge();
    const res = await bridge.buildFromExtrude(rectExtrude());
    expect(res.ok).toBe(true);
    expect(res.shape).toBeDefined();
    expect(res.shape!.kind).toBe('solid');
    expect(res.shape!.id).toMatch(/^stub_\d+$/);
    expect(res.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 7 } });
    expect(res.warnings.some((w) => /stub/.test(w))).toBe(true);
  });

  it('midplane direction centres z on 0', async () => {
    const bridge = createStubBridge();
    const f: ExtrudeFeature = { ...rectExtrude(), direction: 'midplane', depth: 6 };
    const res = await bridge.buildFromExtrude(f);
    expect(res.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: -3 }, max: { x: 10, y: 5, z: 3 } });
  });

  it('two_sided direction spans -depth..+depth on z', async () => {
    const bridge = createStubBridge();
    const f: ExtrudeFeature = { ...rectExtrude(), direction: 'two_sided', depth: 4 };
    const res = await bridge.buildFromExtrude(f);
    expect(res.shape!.bbox!.min.z).toBe(-4);
    expect(res.shape!.bbox!.max.z).toBe(4);
  });

  it('rejects non-positive depth', async () => {
    const bridge = createStubBridge();
    const res = await bridge.buildFromExtrude({ ...rectExtrude(), depth: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/depth/);
  });

  it('rejects loop with < 3 points', async () => {
    const bridge = createStubBridge();
    const f: ExtrudeFeature = { ...rectExtrude(), loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const res = await bridge.buildFromExtrude(f);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/loop/);
  });
});

// ─── buildFromRevolve ─────────────────────────────────────────────────────

describe('stub.buildFromRevolve', () => {
  it('disk r=4 h=2 → solid shape with full-revolve envelope', async () => {
    const bridge = createStubBridge();
    const res = await bridge.buildFromRevolve(diskRevolve());
    expect(res.ok).toBe(true);
    expect(res.shape!.kind).toBe('solid');
    // Full revolve around +Y of radius 4: x/z in [-4,4], y in [0,2].
    expect(res.shape!.bbox).toEqual({
      min: { x: -4, y: 0, z: -4 },
      max: { x: 4, y: 2, z: 4 },
    });
  });

  it('partial sweep emits envelope warning', async () => {
    const bridge = createStubBridge();
    const f: RevolveFeature = { ...diskRevolve(), angleDegrees: 90 };
    const res = await bridge.buildFromRevolve(f);
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /partial sweep/.test(w))).toBe(true);
  });

  it('rejects loop with < 3 points', async () => {
    const bridge = createStubBridge();
    const res = await bridge.buildFromRevolve({ ...diskRevolve(), loop: [{ x: 0, y: 0 }, { x: 4, y: 0 }] });
    expect(res.ok).toBe(false);
  });
});

// ─── boolean ──────────────────────────────────────────────────────────────

describe('stub.boolean.union', () => {
  it('bbox union of two disjoint boxes', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrudeAt(0, 0, 10, 10, 5))).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrudeAt(20, 5, 4, 8, 3))).shape!;
    const u = (await bridge.boolean.union(a, b)).shape!;
    expect(u.bbox).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 24, y: 13, z: 5 },
    });
  });

  it('union with overlapping boxes shrinks to the wrapping envelope', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrudeAt(0, 0, 10, 10, 5))).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrudeAt(5, 5, 10, 10, 5))).shape!;
    const u = (await bridge.boolean.union(a, b)).shape!;
    expect(u.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 15, y: 15, z: 5 } });
  });
});

describe('stub.boolean.subtract', () => {
  it('returns A bbox unchanged with warning', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrudeAt(0, 0, 10, 10, 5))).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrudeAt(2, 2, 4, 4, 5))).shape!;
    const r = await bridge.boolean.subtract(a, b);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual(a.bbox);
    expect(r.shape!.id).not.toBe(a.id); // fresh id
    expect(r.warnings.some((w) => /no real cut/.test(w))).toBe(true);
  });
});

describe('stub.boolean.intersect', () => {
  it('returns the overlap bbox of two boxes', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrudeAt(0, 0, 10, 10, 5))).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrudeAt(5, 5, 10, 10, 5))).shape!;
    const r = await bridge.boolean.intersect(a, b);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual({ min: { x: 5, y: 5, z: 0 }, max: { x: 10, y: 10, z: 5 } });
  });

  it('returns ok=false when bboxes do not overlap', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrudeAt(0, 0, 5, 5, 5))).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrudeAt(20, 20, 5, 5, 5))).shape!;
    const r = await bridge.boolean.intersect(a, b);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disjoint|overlap/);
  });
});

// ─── fillet / chamfer ─────────────────────────────────────────────────────

describe('stub.fillet', () => {
  it('returns same-bbox shape with warning', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.fillet(a, ['edge_1', 'edge_2'], 1.5);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual(a.bbox);
    expect(r.shape!.id).not.toBe(a.id);
    expect(r.warnings.some((w) => /no actual fillet/.test(w))).toBe(true);
  });

  it('rejects non-positive radius', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.fillet(a, ['e1'], 0);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/radius/);
  });
});

describe('stub.chamfer', () => {
  it('returns same-bbox shape with warning', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.chamfer(a, ['edge_1'], 0.8);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual(a.bbox);
    expect(r.warnings.some((w) => /no actual chamfer/.test(w))).toBe(true);
  });

  it('rejects negative distance', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.chamfer(a, ['e1'], -0.5);
    expect(r.ok).toBe(false);
  });
});

// ─── STEP I/O ─────────────────────────────────────────────────────────────

describe('stub.exportSTEP', () => {
  it('emits ISO-10303-21 STEP for an extrude-derived shape', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    expect(step).toContain('ISO-10303-21');
    expect(step).toContain('END-ISO-10303-21');
    expect(step).toContain('MANIFOLD_SOLID_BREP');
  });

  it('preserves originating feature across a fillet', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const filleted = (await bridge.fillet(a, ['e1'], 1.0)).shape!;
    const step = await bridge.exportSTEP(filleted);
    expect(step).toContain('MANIFOLD_SOLID_BREP');
  });

  it('throws for a shape that has no originating feature', async () => {
    const bridge = createStubBridge();
    // Hand-craft a shape that wasn't built through the bridge.
    const orphan = { id: 'stub_999', kind: 'solid' as const, bbox: undefined };
    await expect(bridge.exportSTEP(orphan)).rejects.toThrow(/no originating feature/);
  });
});

describe('stub.importSTEP', () => {
  it('round-trips an extrude STEP into a shape with matching XY bbox', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    const imported = await bridge.importSTEP(step);
    expect(imported.ok).toBe(true);
    expect(imported.shape!.bbox!.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(imported.shape!.bbox!.max.x).toBeCloseTo(10, 4);
    expect(imported.shape!.bbox!.max.y).toBeCloseTo(5, 4);
    expect(imported.shape!.bbox!.max.z).toBeCloseTo(7, 4);
  });

  it('returns ok=false for an unparseable source', async () => {
    const bridge = createStubBridge();
    const r = await bridge.importSTEP('not a step file');
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('returns ok=false for empty source', async () => {
    const bridge = createStubBridge();
    const r = await bridge.importSTEP('');
    expect(r.ok).toBe(false);
  });
});

// ─── release ──────────────────────────────────────────────────────────────

describe('stub.release', () => {
  it('does not throw on a live shape', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    expect(() => bridge.release(a)).not.toThrow();
  });

  it('subsequent boolean op on released shape throws', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    bridge.release(a);
    await expect(bridge.boolean.union(a, b)).rejects.toThrow(/released/);
  });

  it('release is idempotent', async () => {
    const bridge = createStubBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    bridge.release(a);
    expect(() => bridge.release(a)).not.toThrow();
  });
});

// ─── tessellate ───────────────────────────────────────────────────────────

describe('stub.tessellate', () => {
  it('meshes an extrude into viewer buffers via featureMesh', async () => {
    const bridge = createStubBridge();
    const built = await bridge.buildFromExtrude(rectExtrude()); // 10×5×7 box
    const res = await bridge.tessellate(built.shape!);
    expect(res.ok).toBe(true);
    expect(res.mesh!.triangleCount).toBe(12);       // 6 faces → 12 triangles
    expect(res.mesh!.edgeCount).toBe(12);           // box has 12 feature edges
    expect(res.mesh!.positions).toHaveLength(12 * 9);
    expect(res.mesh!.bounds.size).toEqual([10, 5, 7]);
    expect(res.warnings.some((w) => /featureMesh/.test(w))).toBe(true);
  });

  it('errors on a released shape', async () => {
    const bridge = createStubBridge();
    const built = await bridge.buildFromExtrude(rectExtrude());
    bridge.release(built.shape!);
    await expect(bridge.tessellate(built.shape!)).rejects.toThrow();
  });

  it('errors on a shape with no tracked feature', async () => {
    const bridge = createStubBridge();
    const res = await bridge.tessellate({ id: 'stub_999', kind: 'solid' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/tessellate/);
  });
});

// ─── WASM bridge stub ─────────────────────────────────────────────────────

describe('createWasmBridge', () => {
  it('throws "Not implemented" (Phase 4)', () => {
    expect(() => createWasmBridge()).toThrow(/Not implemented/);
  });

  it('throws even with worker URL passed', () => {
    expect(() => createWasmBridge({ workerUrl: '/occt-worker/worker.js' })).toThrow(/Not implemented/);
  });
});
