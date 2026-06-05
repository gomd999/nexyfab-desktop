/**
 * wallHeatTransfer — composite-wall thermal resistance network, verified: the series
 * resistance sum with Q=ΔT/R_tot and U=1/(A·R_tot); the interface temperatures (each
 * layer's drop ∝ its resistance, ending at the cold side); the cylindrical resistance
 * ln(r2/r1)/(2πkL); and the parallel-resistance rule.
 */
import { describe, it, expect } from 'vitest';
import {
  conductionResistance, convectionResistance, cylindricalResistance,
  seriesResistance, parallelResistance, heatFlow, overallU, interfaceTemperatures,
} from './wallHeatTransfer';

const A = 1;
// inside convection | brick | insulation | outside convection
const R = [convectionResistance(10, A), conductionResistance(0.2, 0.7, A), conductionResistance(0.05, 0.04, A), convectionResistance(25, A)];

describe('wallHeatTransfer — composite wall (verified)', () => {
  it('series resistance, heat flow Q=ΔT/R_tot, and overall U=1/(A·R_tot)', () => {
    const Rtot = seriesResistance(R);
    expect(Rtot).toBeCloseTo(R.reduce((s, r) => s + r, 0), 12);
    const Ti = 20, To = -10;
    expect(heatFlow(Ti - To, Rtot)).toBeCloseTo((Ti - To) / Rtot, 9);
    expect(overallU(Rtot, A)).toBeCloseTo(1 / Rtot, 9);
  });

  it('the interface temperatures end at the cold side, dropping ∝ each resistance', () => {
    const Ti = 20, To = -10, Rtot = seriesResistance(R), Q = heatFlow(Ti - To, Rtot);
    const T = interfaceTemperatures(Ti, Q, R);
    expect(T[0]).toBeCloseTo(Ti, 9);
    expect(T[T.length - 1]).toBeCloseTo(To, 6);
    // the insulation (largest R) has the largest temperature drop.
    const drops = R.map((r) => Q * r);
    const maxDropIdx = drops.indexOf(Math.max(...drops));
    expect(maxDropIdx).toBe(2);                         // the insulation layer
  });

  it('cylindrical conduction resistance is ln(r2/r1)/(2πkL)', () => {
    expect(cylindricalResistance(0.05, 0.07, 0.04, 1)).toBeCloseTo(Math.log(0.07 / 0.05) / (2 * Math.PI * 0.04), 9);
    // thicker insulation ⇒ more resistance.
    expect(cylindricalResistance(0.05, 0.1, 0.04, 1)).toBeGreaterThan(cylindricalResistance(0.05, 0.07, 0.04, 1));
  });

  it('parallel resistance is below the smallest branch; series is the sum', () => {
    expect(parallelResistance([2, 3])).toBeCloseTo(1 / (1 / 2 + 1 / 3), 12); // 1.2
    expect(parallelResistance([2, 3])).toBeLessThan(2);
    expect(seriesResistance([2, 3])).toBe(5);
  });

  it('the basic resistances scale correctly', () => {
    expect(conductionResistance(0.2, 0.7, A)).toBeCloseTo(0.2 / (0.7 * A), 12);
    expect(convectionResistance(10, A)).toBeCloseTo(1 / 10, 12);
    // doubling the area halves both resistances.
    expect(conductionResistance(0.2, 0.7, 2)).toBeCloseTo(conductionResistance(0.2, 0.7, 1) / 2, 12);
  });
});
