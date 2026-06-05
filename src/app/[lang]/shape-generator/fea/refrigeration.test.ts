/**
 * refrigeration — refrigerator/heat-pump performance, verified: the energy balance
 * Q_h=Q_c+W; the COP_HP=COP_R+1 identity; the Carnot temperature limits; and COP→∞ as
 * T_h→T_c.
 */
import { describe, it, expect } from 'vitest';
import { carnotCOPRefrigerator, carnotCOPHeatPump, copRefrigerator, copHeatPump, workInput } from './refrigeration';

describe('refrigeration — COP (verified)', () => {
  const Tc = 273, Th = 303; // kelvin

  it('gives the Carnot limits with COP_HP = COP_R + 1', () => {
    expect(carnotCOPRefrigerator(Tc, Th)).toBeCloseTo(Tc / (Th - Tc), 9);  // 9.1
    expect(carnotCOPHeatPump(Tc, Th)).toBeCloseTo(Th / (Th - Tc), 9);      // 10.1
    expect(carnotCOPHeatPump(Tc, Th)).toBeCloseTo(carnotCOPRefrigerator(Tc, Th) + 1, 9);
  });

  it('balances energy Q_h = Q_c + W with COP_HP = COP_R + 1', () => {
    const Qc = 2000, W = 500, Qh = Qc + W;
    expect(workInput(Qc, Qh)).toBeCloseTo(W, 9);
    expect(copRefrigerator(Qc, W)).toBeCloseTo(4, 9);
    expect(copHeatPump(Qh, W)).toBeCloseTo(5, 9);
    expect(copHeatPump(Qh, W)).toBeCloseTo(copRefrigerator(Qc, W) + 1, 9);
  });

  it('diverges as the temperature lift vanishes (T_h→T_c)', () => {
    expect(carnotCOPRefrigerator(273, 273.1)).toBeGreaterThan(1000);
    // a smaller lift gives a higher COP
    expect(carnotCOPRefrigerator(Tc, 290)).toBeGreaterThan(carnotCOPRefrigerator(Tc, Th));
  });
});
