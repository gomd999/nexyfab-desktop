/**
 * thermoCycle — Carnot cycle performance, verified: the refrigeration and heat-pump
 * COPs (T_C/(T_H−T_C), T_H/(T_H−T_C)); the COP_HP = COP_R + 1 and COP_HP = 1/η
 * identities; the energy balance Q_H = Q_C + W with COP = Q/W matching Carnot for a
 * reversible cycle; and the COP → ∞ limit as T_H → T_C.
 */
import { describe, it, expect } from 'vitest';
import { carnotEfficiency, carnotCOPRefrigeration, carnotCOPHeatPump, copRefrigeration, copHeatPump, heatRejected } from './thermoCycle';

const TH = 300, TC = 273;

describe('thermoCycle — Carnot cycle (verified)', () => {
  it('the Carnot COPs are T_C/(T_H−T_C) and T_H/(T_H−T_C)', () => {
    expect(carnotCOPRefrigeration(TH, TC)).toBeCloseTo(TC / (TH - TC), 9);
    expect(carnotCOPHeatPump(TH, TC)).toBeCloseTo(TH / (TH - TC), 9);
  });

  it('COP_HP = COP_R + 1 and COP_HP = 1/η', () => {
    expect(carnotCOPHeatPump(TH, TC) - carnotCOPRefrigeration(TH, TC)).toBeCloseTo(1, 9);
    expect(carnotCOPHeatPump(TH, TC) * carnotEfficiency(TH, TC)).toBeCloseTo(1, 9);
  });

  it('a reversible cycle obeys the energy balance and COP = Q/W', () => {
    const W = 100;
    const QC = carnotCOPRefrigeration(TH, TC) * W;
    const QH = heatRejected(QC, W);
    expect(QH).toBeCloseTo(QC + W, 9);
    expect(copRefrigeration(QC, W)).toBeCloseTo(carnotCOPRefrigeration(TH, TC), 9);
    expect(copHeatPump(QH, W)).toBeCloseTo(carnotCOPHeatPump(TH, TC), 9);
  });

  it('the COP diverges as T_H → T_C and shrinks as the lift grows', () => {
    expect(carnotCOPRefrigeration(274, 273)).toBeGreaterThan(200);  // tiny lift ⇒ huge COP
    expect(carnotCOPRefrigeration(400, 273)).toBeLessThan(carnotCOPRefrigeration(300, 273)); // bigger lift ⇒ lower COP
  });

  it('the heat-engine efficiency is 1 − T_C/T_H and below 1', () => {
    expect(carnotEfficiency(TH, TC)).toBeCloseTo(1 - TC / TH, 9);
    expect(carnotEfficiency(800, 300)).toBeGreaterThan(carnotEfficiency(400, 300)); // hotter source ⇒ more efficient
    expect(carnotEfficiency(TH, TC)).toBeLessThan(1);
  });
});
