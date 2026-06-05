/**
 * fatigue — rainflow counting + Basquin S-N + Miner damage, verified against the
 * hand-countable example, the documented ASTM E1049 reference sequence, the Basquin
 * life law, Miner summation (failure at D=1), and the Goodman mean-stress correction.
 */
import { describe, it, expect } from 'vitest';
import { rainflowCount, binCycles, basquinLife, minerDamage } from './fatigue';

describe('fatigue — rainflow cycle counting', () => {
  it('matches the hand-countable example [0,2,1,3,0] → one range-1 + one range-3 cycle', () => {
    const b = binCycles(rainflowCount([0, 2, 1, 3, 0]));
    expect(b.get(1)).toBeCloseTo(1, 6);
    expect(b.get(3)).toBeCloseTo(1, 6);
    expect([...b.values()].reduce((a, c) => a + c, 0)).toBeCloseTo(2, 6);
  });

  it('reproduces the ASTM E1049 reference sequence [-2,1,-3,5,-1,3,-4,4,-2]', () => {
    const b = binCycles(rainflowCount([-2, 1, -3, 5, -1, 3, -4, 4, -2]));
    // documented result: range 3 (½), 4 (1½), 6 (½), 8 (1), 9 (½).
    expect(b.get(3)).toBeCloseTo(0.5, 6);
    expect(b.get(4)).toBeCloseTo(1.5, 6);
    expect(b.get(6)).toBeCloseTo(0.5, 6);
    expect(b.get(8)).toBeCloseTo(1.0, 6);
    expect(b.get(9)).toBeCloseTo(0.5, 6);
    expect([...b.values()].reduce((a, c) => a + c, 0)).toBeCloseTo(4, 6); // 8 half-cycles
  });

  it('the largest cycle spans the global stress range', () => {
    const series = [-2, 1, -3, 5, -1, 3, -4, 4, -2];
    const maxRange = Math.max(...rainflowCount(series).map((c) => c.range));
    expect(maxRange).toBe(Math.max(...series) - Math.min(...series)); // 5 − (−4) = 9
  });
});

describe('fatigue — Basquin S-N + Miner damage', () => {
  const sn = { C: 1e12, m: 3 }; // N·σ³ = 1e12

  it('Basquin life follows N·σᵐ = C and scales as σ⁻ᵐ', () => {
    expect(basquinLife(100, sn)).toBeCloseTo(1e6, -1);
    expect(basquinLife(200, sn) / basquinLife(100, sn)).toBeCloseTo(1 / 8, 6); // ×2 stress ⇒ /2³
  });

  it('respects an endurance limit (infinite life below it)', () => {
    expect(basquinLife(50, { ...sn, enduranceLimit: 60 })).toBe(Infinity);
    expect(basquinLife(80, { ...sn, enduranceLimit: 60 })).toBeLessThan(Infinity);
  });

  it("Miner damage of n constant-amplitude cycles equals n/N_f, failure at D=1", () => {
    const history = [0]; for (let i = 0; i < 10; i++) history.push(200, 0); // 10 cycles, amp 100
    const d = minerDamage(history, sn);
    expect(d.damage).toBeCloseTo(10 / basquinLife(100, sn), 10);
    expect(d.blocksToFailure).toBeCloseTo(basquinLife(100, sn) / 10, 0); // repeats of the block
  });

  it('the Goodman mean-stress correction increases damage for a tensile mean', () => {
    // same range, one zero-mean and one with a +100 mean.
    const zeroMean = [-100, 100, -100, 100, -100];   // mean 0, amp 100
    const tensileMean = [0, 200, 0, 200, 0];         // mean 100, amp 100
    const dZero = minerDamage(zeroMean, sn, 400).damage;
    const dTens = minerDamage(tensileMean, sn, 400).damage;
    expect(dTens).toBeGreaterThan(dZero);            // tensile mean is more damaging
    // Goodman: σ_ar = 100/(1−100/400) = 133.3 ⇒ damage ratio = (133.3/100)³.
    expect(dTens / dZero).toBeCloseTo((1 / 0.75) ** 3, 2);
  });
});
