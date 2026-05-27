import { describe, it, expect } from 'vitest';
import {
  layoutVents,
  totalVentArea,
  checkFlashRisk,
  summarize,
  type PerimeterPoint,
} from './ventingLayout';

function perimeter(n: number, spacing = 30): PerimeterPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    position: { x: i * spacing, y: 0 },
    fillTimeMs: i * 10, // later points fill later
  }));
}

describe('layoutVents', () => {
  it('empty perimeter → warning', () => {
    const r = layoutVents({ polymer: 'PP', perimeter: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('PP vent depth = 0.025 mm', () => {
    const r = layoutVents({ polymer: 'PP', perimeter: perimeter(5) });
    expect(r.ventDepthMm).toBeCloseTo(0.025, 6);
  });

  it('PC vent depth shallower than ABS', () => {
    const pc = layoutVents({ polymer: 'PC', perimeter: perimeter(5) });
    const abs = layoutVents({ polymer: 'ABS', perimeter: perimeter(5) });
    expect(pc.ventDepthMm).toBeLessThan(abs.ventDepthMm);
  });

  it('last-to-fill ranked first', () => {
    const r = layoutVents({ polymer: 'PP', perimeter: perimeter(5, 50), targetPitchMm: 10 });
    // highest fillTime is p4 → rank 1
    expect(r.vents[0]!.atPointId).toBe('p4');
  });

  it('respects target pitch (skips too-close points)', () => {
    const r = layoutVents({ polymer: 'PP', perimeter: perimeter(10, 5), targetPitchMm: 25 });
    // points are 5mm apart; pitch 25 → roughly every 5th point
    expect(r.totalVentCount).toBeLessThan(10);
  });

  it('wide pitch → fewer vents', () => {
    const tight = layoutVents({ polymer: 'PP', perimeter: perimeter(10, 10), targetPitchMm: 15 });
    const wide = layoutVents({ polymer: 'PP', perimeter: perimeter(10, 10), targetPitchMm: 50 });
    expect(wide.totalVentCount).toBeLessThan(tight.totalVentCount);
  });

  it('unknown polymer → warning + default depth', () => {
    const r = layoutVents({ polymer: 'XYZ' as never, perimeter: perimeter(5) });
    expect(r.warnings.some(w => w.includes('Unknown'))).toBe(true);
    expect(r.ventDepthMm).toBeCloseTo(0.025, 6);
  });
});

describe('totalVentArea', () => {
  it('area = depth × width × count', () => {
    const r = layoutVents({ polymer: 'PP', perimeter: perimeter(3, 50), targetPitchMm: 10, ventWidthMm: 6 });
    expect(totalVentArea(r)).toBeCloseTo(r.totalVentCount * 0.025 * 6, 6);
  });
});

describe('checkFlashRisk', () => {
  it('depth within threshold → safe', () => {
    expect(checkFlashRisk(0.02, 'PP').safe).toBe(true);
  });

  it('depth above threshold → unsafe', () => {
    expect(checkFlashRisk(0.05, 'PC').safe).toBe(false);
  });
});

describe('summarize', () => {
  it('reports vent count + depth + area', () => {
    const r = layoutVents({ polymer: 'ABS', perimeter: perimeter(4, 50), targetPitchMm: 10 });
    const s = summarize(r);
    expect(s.totalVentCount).toBe(r.totalVentCount);
    expect(s.ventDepthMm).toBe(r.ventDepthMm);
  });
});
