import { describe, it, expect } from 'vitest';
import {
  size,
  reheatLoadKW,
  summarize,
  type VavBoxInput,
} from './vavBoxSizing';

const base: VavBoxInput = {
  maxFlowM3PerS: 0.3,
  minFlowM3PerS: 0.09,
};

describe('size', () => {
  it('selects an inlet', () => {
    const r = size(base);
    expect(r.selectedInletMm).not.toBeNull();
  });

  it('max velocity ≤ limit', () => {
    const r = size({ ...base, maxInletVelocityMS: 5 });
    expect(r.maxVelocityMS).toBeLessThanOrEqual(5 + 1e-6);
  });

  it('larger flow → larger inlet', () => {
    const small = size({ maxFlowM3PerS: 0.1, minFlowM3PerS: 0.03 });
    const big = size({ maxFlowM3PerS: 0.6, minFlowM3PerS: 0.18 });
    expect(big.selectedInletMm!).toBeGreaterThan(small.selectedInletMm!);
  });

  it('velocity pressure = ½ρV²', () => {
    const r = size(base);
    expect(r.maxVelocityPressurePa).toBeCloseTo(0.5 * 1.2 * r.maxVelocityMS * r.maxVelocityMS, 5);
  });

  it('controllable when min velocity adequate', () => {
    const r = size({ maxFlowM3PerS: 0.3, minFlowM3PerS: 0.15 });
    expect(r.controllableAtMin).toBe(true);
  });

  it('uncontrollable tiny min flow → warning', () => {
    const r = size({ maxFlowM3PerS: 0.3, minFlowM3PerS: 0.005 });
    expect(r.controllableAtMin).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero min flow → controllable (shutoff)', () => {
    const r = size({ maxFlowM3PerS: 0.3, minFlowM3PerS: 0 });
    expect(r.controllableAtMin).toBe(true);
  });

  it('turndown ratio = max/min', () => {
    const r = size(base);
    expect(r.turndownRatio).toBeCloseTo(0.3 / 0.09, 4);
  });

  it('min > max → warning', () => {
    const r = size({ maxFlowM3PerS: 0.1, minFlowM3PerS: 0.2 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('huge flow exceeds largest inlet → warning', () => {
    const r = size({ maxFlowM3PerS: 5, minFlowM3PerS: 1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('reheatLoadKW', () => {
  it('positive when room warmer than supply', () => {
    expect(reheatLoadKW(0.09, 13, 22)).toBeGreaterThan(0);
  });

  it('scales with flow', () => {
    const low = reheatLoadKW(0.05, 13, 22);
    const high = reheatLoadKW(0.15, 13, 22);
    expect(high).toBeGreaterThan(low);
  });
});

describe('summarize', () => {
  it('reports inlet + velocity + controllable', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.selectedInletMm).toBe(r.selectedInletMm);
    expect(s.controllableAtMin).toBe(r.controllableAtMin);
  });
});
