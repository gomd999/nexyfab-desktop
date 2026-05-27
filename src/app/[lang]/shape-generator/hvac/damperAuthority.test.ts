import { describe, it, expect } from 'vitest';
import {
  analyze,
  requiredDamperDropPa,
  summarize,
  type DamperAuthorityInput,
} from './damperAuthority';

const good: DamperAuthorityInput = {
  damperOpenDropPa: 100,
  seriesDropPa: 100,
  characteristic: 'linear',
};

describe('analyze', () => {
  it('authority = damper / total', () => {
    const r = analyze(good);
    expect(r.authority).toBeCloseTo(0.5, 6);
  });

  it('β ≥ 0.5 → good grade', () => {
    expect(analyze(good).grade).toBe('good');
  });

  it('low authority → poor + warning', () => {
    const r = analyze({ damperOpenDropPa: 10, seriesDropPa: 90, characteristic: 'linear' });
    expect(r.grade).toBe('poor');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('acceptable band 0.3-0.5', () => {
    const r = analyze({ damperOpenDropPa: 40, seriesDropPa: 60, characteristic: 'linear' });
    expect(r.grade).toBe('acceptable');
  });

  it('installed curve spans stroke 0..1', () => {
    const r = analyze(good, 10);
    expect(r.installedCurve[0]!.stroke).toBe(0);
    expect(r.installedCurve[r.installedCurve.length - 1]!.stroke).toBe(1);
  });

  it('full authority (β=1) → installed ≈ inherent for linear', () => {
    const r = analyze({ damperOpenDropPa: 100, seriesDropPa: 0, characteristic: 'linear' }, 10);
    const mid = r.installedCurve.find(p => p.stroke === 0.5)!;
    expect(mid.installedFlow).toBeCloseTo(0.5, 2);
  });

  it('low authority distorts linear curve (higher linearity error)', () => {
    const hi = analyze({ damperOpenDropPa: 90, seriesDropPa: 10, characteristic: 'linear' });
    const lo = analyze({ damperOpenDropPa: 20, seriesDropPa: 80, characteristic: 'linear' });
    expect(lo.linearityError).toBeGreaterThan(hi.linearityError);
  });

  it('equal-percentage characteristic supported', () => {
    const r = analyze({ damperOpenDropPa: 100, seriesDropPa: 100, characteristic: 'equal-percentage', rangeability: 50 });
    expect(r.installedCurve.length).toBeGreaterThan(0);
  });

  it('zero total → warning', () => {
    const r = analyze({ damperOpenDropPa: 0, seriesDropPa: 0, characteristic: 'linear' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('requiredDamperDropPa', () => {
  it('β=0.5 → damper drop = series drop', () => {
    expect(requiredDamperDropPa(100, 0.5)).toBeCloseTo(100, 4);
  });

  it('higher target authority → more damper drop', () => {
    expect(requiredDamperDropPa(100, 0.7)).toBeGreaterThan(requiredDamperDropPa(100, 0.5));
  });

  it('invalid target → Infinity', () => {
    expect(requiredDamperDropPa(100, 1)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports authority + grade', () => {
    const r = analyze(good);
    const s = summarize(r);
    expect(s.authority).toBe(r.authority);
    expect(s.grade).toBe('good');
  });
});
