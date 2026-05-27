import { describe, it, expect } from 'vitest';
import {
  buildSequence,
  checkBalance,
  summarize,
  type BoltPosition,
} from './fastenerTorqueSequencer';

function circle(n: number, r = 10): BoltPosition[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i * 2 * Math.PI) / n;
    return { id: `b${i}`, position: { x: r * Math.cos(angle), y: r * Math.sin(angle) } };
  });
}

describe('buildSequence', () => {
  it('empty bolts → warning', () => {
    const r = buildSequence({ bolts: [], targetTorqueNm: 100, pattern: 'star-circular' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('star pattern visits all bolts exactly once', () => {
    const bolts = circle(8);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular' });
    const order = r.passes[0]!.order;
    expect(new Set(order).size).toBe(8);
  });

  it('default 3 passes + 1 final check = 4', () => {
    const bolts = circle(6);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular' });
    expect(r.passes).toHaveLength(3);
    expect(r.finalCheckPass.passIndex).toBe(4);
  });

  it('custom fractions applied', () => {
    const bolts = circle(4);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular', passFractions: [0.5, 1.0] });
    expect(r.passes).toHaveLength(2);
    expect(r.passes[0]!.torqueNm).toBe(50);
  });

  it('final pass at full torque', () => {
    const bolts = circle(4);
    const r = buildSequence({ bolts, targetTorqueNm: 200, pattern: 'star-circular' });
    expect(r.finalCheckPass.torqueNm).toBe(200);
  });

  it('linear pattern alternates outside-in', () => {
    const bolts: BoltPosition[] = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 10, y: 0 } },
      { id: 'c', position: { x: 20, y: 0 } },
      { id: 'd', position: { x: 30, y: 0 } },
    ];
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'outside-in-linear' });
    expect(r.passes[0]!.order).toEqual(['a', 'd', 'b', 'c']);
  });

  it('rectangular sorts outermost first', () => {
    const bolts: BoltPosition[] = [
      { id: 'a', position: { x: -10, y: -10 } },
      { id: 'b', position: { x: 10, y: -10 } },
      { id: 'c', position: { x: 10, y: 10 } },
      { id: 'd', position: { x: -10, y: 10 } },
    ];
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'diagonal-rectangular' });
    expect(r.passes[0]!.order).toHaveLength(4);
  });

  it('zero torque → warning', () => {
    const r = buildSequence({ bolts: circle(4), targetTorqueNm: 0, pattern: 'star-circular' });
    expect(r.warnings.some(w => w.includes('positive'))).toBe(true);
  });
});

describe('checkBalance', () => {
  it('star pattern on 8 bolts is balanced', () => {
    const bolts = circle(8);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular' });
    expect(checkBalance(r, bolts).balanced).toBe(true);
  });

  it('< 2 bolts → not balanced', () => {
    const bolts = circle(1);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular' });
    expect(checkBalance(r, bolts).balanced).toBe(false);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const bolts = circle(6);
    const r = buildSequence({ bolts, targetTorqueNm: 100, pattern: 'star-circular' });
    const s = summarize(r);
    expect(s.passes).toBe(4);
    expect(s.bolts).toBe(6);
    expect(s.pattern).toBe('star-circular');
  });
});
