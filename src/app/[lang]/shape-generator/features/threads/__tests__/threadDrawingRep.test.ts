/**
 * threadDrawingRep.test.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * ISO 6410-1 simplified-thread builder coverage. Pure-geometry checks:
 *  - line counts per view kind / thread kind
 *  - dashed-vs-solid swap on internal vs external
 *  - axial endpoints respect `length` + `startOffset`
 *  - end-view uses 3/4-arc for the dashed circle
 *  - flag stays `false` until Phase 3 ships
 */

import { describe, it, expect } from 'vitest';
import {
  buildThreadDrawingRep,
  shouldEmitDrawingRep,
  PHASE_3_DRAWING_REP_ENABLED,
  type ViewProjection,
} from '../threadDrawingRep';
import { makeThreadFeature } from '../threadFeature';

const LONG_X: ViewProjection = { kind: 'longitudinal' };
const END_VIEW: ViewProjection = { kind: 'endView' };

describe('PHASE_3_DRAWING_REP_ENABLED — Phase 3 integration flag', () => {
  it('is false by default (Phase 3 not yet shipped)', () => {
    expect(PHASE_3_DRAWING_REP_ENABLED).toBe(false);
  });

  it('shouldEmitDrawingRep returns false when flag is off', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    expect(shouldEmitDrawingRep(f)).toBe(false);
  });

  it('shouldEmitDrawingRep is false for annotation-only features regardless of flag', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 0,
    });
    expect(shouldEmitDrawingRep(f)).toBe(false);
  });
});

describe('buildThreadDrawingRep — longitudinal view (internal thread)', () => {
  const internalM8 = makeThreadFeature({
    id: 'f',
    threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
    length: 20,
    threadKind: 'internal',
  });

  it('returns 2 dashed lines (at major Ø) and 2 solid lines (at minor Ø)', () => {
    const rep = buildThreadDrawingRep(internalM8, LONG_X);
    expect(rep.dashed).toHaveLength(2);
    expect(rep.solid).toHaveLength(2);
    expect(rep.extensionLines).toHaveLength(2);
  });

  it('dashed lines sit at ±major/2 from axis', () => {
    const rep = buildThreadDrawingRep(internalM8, LONG_X);
    // Default origin (0,0), axis along +x → radial along +y.
    // M8 major = 8, so dashed lines are at y = ±4.
    const ys = rep.dashed.map((l) => l.start[1]);
    expect(ys.sort((a, b) => a - b)).toEqual([-4, 4]);
  });

  it('solid lines sit at ±minor/2 from axis (M8 minor ≈ 6.647 → ±3.324)', () => {
    const rep = buildThreadDrawingRep(internalM8, LONG_X);
    const ys = rep.solid.map((l) => l.start[1]).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-3.324, 2);
    expect(ys[1]).toBeCloseTo(3.324, 2);
  });

  it('lines span from startOffset to startOffset + length along axis', () => {
    const rep = buildThreadDrawingRep(internalM8, LONG_X);
    const xs = rep.solid.flatMap((l) => [l.start[0], l.end[0]]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(20);
  });

  it('respects a non-zero startOffset', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      startOffset: 5,
    });
    const rep = buildThreadDrawingRep(f, LONG_X);
    const xs = rep.solid.flatMap((l) => [l.start[0], l.end[0]]);
    expect(Math.min(...xs)).toBe(5);
    expect(Math.max(...xs)).toBe(25);
  });

  it('extension-line ticks sit just outside ±major/2', () => {
    const rep = buildThreadDrawingRep(internalM8, LONG_X);
    // Both extension lines have positive y because the perp is +y;
    // exact positions: inner = 4 + 0.5 = 4.5, outer = 4 + 0.5 + 1.5 = 6.
    const ys = rep.extensionLines.flatMap((l) => [l.start[1], l.end[1]]);
    expect(ys).toContain(4.5);
    expect(ys).toContain(6);
  });
});

describe('buildThreadDrawingRep — longitudinal view (external thread)', () => {
  const externalM8 = makeThreadFeature({
    id: 'f',
    threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
    length: 20,
    threadKind: 'external',
    class: '6g',
  });

  it('swaps solid/dashed roles vs internal: solid at major, dashed at minor', () => {
    const rep = buildThreadDrawingRep(externalM8, LONG_X);
    expect(rep.solid).toHaveLength(2);
    expect(rep.dashed).toHaveLength(2);

    // Solid is at major (±4); dashed is at minor (±3.324).
    const solidYs = rep.solid.map((l) => l.start[1]).sort((a, b) => a - b);
    expect(solidYs).toEqual([-4, 4]);

    const dashedYs = rep.dashed.map((l) => l.start[1]).sort((a, b) => a - b);
    expect(dashedYs[0]).toBeCloseTo(-3.324, 2);
    expect(dashedYs[1]).toBeCloseTo(3.324, 2);
  });
});

describe('buildThreadDrawingRep — end view', () => {
  it('internal: solid full circle (32 segments) at minor + dashed 3/4 arc (24 segments) at major', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      threadKind: 'internal',
    });
    const rep = buildThreadDrawingRep(f, END_VIEW);
    expect(rep.solid).toHaveLength(32);
    expect(rep.dashed).toHaveLength(24);
    expect(rep.extensionLines).toHaveLength(0);
  });

  it('external: solid full circle at major + dashed 3/4 arc at minor', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      threadKind: 'external',
      class: '6g',
    });
    const rep = buildThreadDrawingRep(f, END_VIEW);
    expect(rep.solid).toHaveLength(32);
    expect(rep.dashed).toHaveLength(24);
  });

  it('solid circle segments all sit at minor radius (3.324 mm) for internal', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      threadKind: 'internal',
    });
    const rep = buildThreadDrawingRep(f, END_VIEW);
    for (const seg of rep.solid) {
      const r = Math.hypot(seg.start[0], seg.start[1]);
      expect(r).toBeCloseTo(8 * 0.4154, 1); // minor ≈ 0.83 × major ≈ 3.32
    }
  });
});

describe('buildThreadDrawingRep — annotation-only edge cases', () => {
  it('longitudinal with length=0 returns empty line sets', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 0,
    });
    const rep = buildThreadDrawingRep(f, LONG_X);
    expect(rep.solid).toHaveLength(0);
    expect(rep.dashed).toHaveLength(0);
    expect(rep.extensionLines).toHaveLength(0);
  });

  it('end-view with length=0 still emits geometry (zero-depth threads still have a profile)', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 0,
      threadKind: 'internal',
    });
    const rep = buildThreadDrawingRep(f, END_VIEW);
    expect(rep.solid.length + rep.dashed.length).toBeGreaterThan(0);
  });
});

describe('buildThreadDrawingRep — typical case sanity', () => {
  it('M8 × 20 internal in longitudinal view yields exactly 6 lines total', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    const rep = buildThreadDrawingRep(f, LONG_X);
    expect(rep.solid.length + rep.dashed.length + rep.extensionLines.length).toBe(6);
  });

  it('Φ8 (external M8 boss) in longitudinal view yields exactly 6 lines total', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      threadKind: 'external',
      class: '6g',
    });
    const rep = buildThreadDrawingRep(f, LONG_X);
    expect(rep.solid.length + rep.dashed.length + rep.extensionLines.length).toBe(6);
  });
});
