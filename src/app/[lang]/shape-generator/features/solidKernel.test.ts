// @vitest-environment node
/**
 * solidKernel — W3a facade. The kernelParity harness is pure (always-on). The
 * K-series kernel runs over the REAL opencascade.js via createNodeOcctBridge
 * (skips gracefully without the wasm), asserting the absolute numbers the
 * cross-kernel browser parity will later compare replicad against.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import {
  createKSeriesKernel,
  kernelParity,
  type SolidKernel,
  type KernelShape,
} from './solidKernel';

// ─── parity harness (pure, no WASM) ─────────────────────────────────────────

describe('kernelParity', () => {
  const shape = (volume: number, bb = 1): KernelShape => ({
    id: 'x', kind: 'solid', volume,
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: bb, y: bb, z: bb } },
  });

  it('passes for identical volume + bbox', () => {
    const v = kernelParity(shape(500), shape(500));
    expect(v.ok).toBe(true);
    expect(v.volRelErr).toBe(0);
    expect(v.bboxErr).toBe(0);
  });

  it('passes within the default 0.5% volume tolerance', () => {
    const v = kernelParity(shape(500), shape(501.5)); // 0.3% off
    expect(v.ok).toBe(true);
  });

  it('fails a volume divergence beyond tolerance', () => {
    const v = kernelParity(shape(500), shape(520)); // 4% off
    expect(v.ok).toBe(false);
    expect(v.volRelErr).toBeCloseTo(0.04, 3);
    expect(v.note).toMatch(/parity FAIL/);
  });

  it('fails a bbox divergence beyond tolerance', () => {
    const v = kernelParity(shape(500, 1), shape(500, 1.5)); // corner 0.866mm off
    expect(v.ok).toBe(false);
    expect(v.bboxErr).toBeGreaterThan(0.01);
  });

  it('fails when a volume is missing', () => {
    const v = kernelParity({ id: 'a', kind: 'solid' }, shape(500));
    expect(v.ok).toBe(false);
    expect(v.volRelErr).toBe(Infinity);
  });
});

// ─── K-series kernel over real OCCT (node) ──────────────────────────────────

let okLoad = false;
let kernel: SolidKernel;

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) { kernel = createKSeriesKernel(createNodeOcctBridge(r.oc)); okLoad = true; }
  else console.warn(`[solidKernel] K-series tests skipped — ${r.reason}`);
}, 60_000);

const SQ = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];

describe('createKSeriesKernel (real OCCT via node bridge)', () => {
  it('extrude → solid with the right volume (500)', async () => {
    if (!okLoad) return;
    const s = await kernel.extrude(SQ(0, 10), 5);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('solid');
    expect(s!.volume).toBeCloseTo(500, 1);
  });

  it('boolean subtract threads two ids → holed solid (420)', async () => {
    if (!okLoad) return;
    const base = await kernel.extrude(SQ(0, 10), 5);
    const tool = await kernel.extrude(SQ(3, 7), 7);
    const cut = await kernel.boolean('subtract', base!.id, tool!.id);
    expect(cut).not.toBeNull();
    expect(cut!.volume).toBeCloseTo(420, 1);
  });

  it('ceiling op: buildPlanarFace → thicken → solid (200)', async () => {
    if (!okLoad) return;
    const face = await kernel.buildPlanarFace(SQ(0, 10), 0);
    expect(face!.kind).toBe('face');
    const solid = await kernel.thicken(face!.id, 2);
    expect(solid).not.toBeNull();
    expect(Math.abs(solid!.volume ?? 0)).toBeCloseTo(200, 1);
  });

  it('parity verdict on a real K-series extrude vs an exact reference passes', async () => {
    if (!okLoad) return;
    const s = await kernel.extrude(SQ(0, 10), 5);
    // Stand-in for the replicad side: the analytic exact solid.
    const ref: KernelShape = { id: 'ref', kind: 'solid', volume: 500, bbox: s!.bbox };
    const v = kernelParity(s!, ref);
    expect(v.ok).toBe(true);
  });

  it('tessellate returns viewer buffers; release drops the id', async () => {
    if (!okLoad) return;
    const s = await kernel.extrude(SQ(0, 10), 5);
    const mesh = await kernel.tessellate(s!.id);
    expect(mesh).not.toBeNull();
    expect(mesh!.triangleCount).toBeGreaterThan(0);
    kernel.release(s!.id);
    await expect(kernel.tessellate(s!.id)).rejects.toThrow(/unknown id/);
  });
});

describe('createKSeriesKernel — full op coverage (real OCCT)', () => {
  const VERT_EDGES = ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'];

  it('revolve 360° → cylinder volume πr²h', async () => {
    if (!okLoad) return;
    // rectangle (X≥0, axis=Y) r=10, h=20 → cylinder vol ≈ π·100·20 ≈ 6283.
    const s = await kernel.revolve([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }], 360);
    expect(s).not.toBeNull();
    expect(s!.volume).toBeCloseTo(Math.PI * 100 * 20, -1);
  });

  it('fillet the 4 vertical edges removes the expected material', async () => {
    if (!okLoad) return;
    const box = await kernel.extrude(SQ(0, 10), 5);
    const f = await kernel.fillet(box!.id, VERT_EDGES, 1);
    expect(f).not.toBeNull();
    expect(f!.volume).toBeCloseTo(495.71, 1); // 500 − 4·(1−π/4)·1·5
  });

  it('chamfer the 4 vertical edges', async () => {
    if (!okLoad) return;
    const box = await kernel.extrude(SQ(0, 10), 5);
    const c = await kernel.chamfer(box!.id, VERT_EDGES, 1);
    expect(c).not.toBeNull();
    expect(c!.volume).toBeCloseTo(490, 0); // 500 − 4·0.5·1·1·5
  });

  it('variableFillet applies per-edge radii (more removed than uniform 1mm)', async () => {
    if (!okLoad) return;
    const box = await kernel.extrude(SQ(0, 10), 5);
    const vf = await kernel.variableFillet(box!.id, [
      { edgeId: 'e.vert.0', radius: 1 }, { edgeId: 'e.vert.1', radius: 1.5 },
      { edgeId: 'e.vert.2', radius: 0.5 }, { edgeId: 'e.vert.3', radius: 2 },
    ]);
    expect(vf).not.toBeNull();
    expect(vf!.volume).toBeLessThan(495.71);
    expect(vf!.volume).toBeGreaterThan(485);
  });

  it('draft tapers the side walls (volume shrinks)', async () => {
    if (!okLoad) return;
    const box = await kernel.extrude(SQ(0, 10), 5);
    const d = await kernel.draft(box!.id, { angleDeg: 5 });
    expect(d).not.toBeNull();
    expect(d!.volume).toBeLessThan(500);
    expect(d!.volume).toBeGreaterThan(440);
  });

  it('STEP round-trips a solid with volume preserved', async () => {
    if (!okLoad) return;
    const box = await kernel.extrude(SQ(0, 10), 5);
    const step = await kernel.exportStep(box!.id);
    expect(step).not.toBeNull();
    expect(step!.startsWith('ISO-10303-21')).toBe(true);
    const back = await kernel.importStep(step!);
    expect(back).not.toBeNull();
    expect(back!.volume).toBeCloseTo(500, 1);
  });
});
