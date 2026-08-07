import { describe, expect, it } from 'vitest';
import type { OcctBridge } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';
import { makeThreadFeature } from '../threadFeature';
import { applyThreadOcct, MAX_EXACT_THREAD_TURNS } from '../applyThreadOcct';

const parent: OcctShape = { id: 'rod', kind: 'solid' };

function mockBridge() {
  const calls: unknown[] = [];
  const cutter: OcctShape = { id: 'cutter', kind: 'solid' };
  const result: OcctShape = { id: 'threaded', kind: 'solid' };
  const bridge = {
    buildThreadHelixCutter: async (opts: unknown) => { calls.push(opts); return { ok: true, shape: cutter, warnings: [] }; },
    boolean: { subtract: async () => ({ ok: true, shape: result, warnings: [] }) },
    release: () => undefined,
  } as unknown as OcctBridge;
  return { bridge, calls };
}

describe('applyThreadOcct', () => {
  it('maps an M8 external catalog row to exact cutter radii and pitch', async () => {
    const { bridge, calls } = mockBridge();
    const feature = makeThreadFeature({
      id: 'thread-m8', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 5, mode: 'geometric', threadKind: 'external',
    });
    const result = await applyThreadOcct(bridge, parent, feature, { center: { x: 2, y: 3 }, z0: 4 });
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ center: { x: 2, y: 3 }, z0: 4, pitch: 1.25, outerRadius: 4.01, threadKind: 'external' });
    expect(result.warnings.join(' ')).toContain('M8: exact BREP 4.00 turns');
  });

  it('rejects tapered pipe threads instead of generating a wrong cylinder', async () => {
    const { bridge } = mockBridge();
    const feature = makeThreadFeature({
      id: 'npt', threadRef: { series: 'NPT', designation: 'NPT 1/2' }, length: 5, mode: 'geometric',
    });
    const result = await applyThreadOcct(bridge, parent, feature, { center: { x: 0, y: 0 }, z0: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tapered/);
  });

  it('maps an internal M8 thread from tap-drill radius outward to nominal radius', async () => {
    const { bridge, calls } = mockBridge();
    const feature = makeThreadFeature({
      id: 'tap-m8', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 2.5, mode: 'geometric', threadKind: 'internal',
    });
    const result = await applyThreadOcct(bridge, parent, feature, { center: { x: 0, y: 0 }, z0: 0 });
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ innerRadius: 3.39, outerRadius: 4, pitch: 1.25, threadKind: 'internal' });
  });

  it('enforces the exact-thread turn budget before starting the worker', async () => {
    const { bridge, calls } = mockBridge();
    const feature = makeThreadFeature({
      id: 'long', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 1.25 * (MAX_EXACT_THREAD_TURNS + 1), mode: 'geometric',
    });
    const result = await applyThreadOcct(bridge, parent, feature, { center: { x: 0, y: 0 }, z0: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds.*limit/);
    expect(calls).toHaveLength(0);
  });
});
