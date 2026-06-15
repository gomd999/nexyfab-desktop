/**
 * nusselt — internal-flow convection correlations, verified: the Reynolds/Prandtl
 * definitions (water Pr≈7); the Dittus–Boelter value for a textbook case; the
 * heating>cooling Nusselt ordering for Pr>1; the laminar Nu=3.66; and the h=Nu·k/D
 * conversion.
 */
import { describe, it, expect } from 'vitest';
import { reynoldsPipe, prandtl, dittusBoelter, laminarPipeNusselt, heatTransferCoefficient } from './nusselt';

describe('nusselt — convection correlations (verified)', () => {
  const rho = 1000, v = 2, D = 0.05, mu = 1e-3, cp = 4180, k = 0.6; // water
  const Re = reynoldsPipe(rho, v, D, mu);
  const Pr = prandtl(mu, cp, k);

  it('computes Reynolds and Prandtl (water Pr≈7)', () => {
    expect(Re).toBeCloseTo((rho * v * D) / mu, 6); // 1e5
    expect(Pr).toBeCloseTo((mu * cp) / k, 9);      // ~6.97
    expect(Pr).toBeGreaterThan(6);
  });

  it('gives the Dittus–Boelter Nusselt for the textbook case', () => {
    expect(dittusBoelter(Re, Pr, true)).toBeCloseTo(0.023 * Re ** 0.8 * Pr ** 0.4, 6); // ~500
  });

  it('orders heating > cooling Nusselt for Pr>1', () => {
    expect(dittusBoelter(Re, Pr, true)).toBeGreaterThan(dittusBoelter(Re, Pr, false)); // n=0.4 vs 0.3
    expect(laminarPipeNusselt()).toBeCloseTo(3.66, 9);   // far below the turbulent value
  });

  it('converts to a heat-transfer coefficient h = Nu·k/D', () => {
    const Nu = dittusBoelter(Re, Pr, true);
    expect(heatTransferCoefficient(Nu, k, D)).toBeCloseTo((Nu * k) / D, 6);
    // a smaller pipe gives a higher h at the same Nu
    expect(heatTransferCoefficient(Nu, k, D / 2)).toBeCloseTo(2 * heatTransferCoefficient(Nu, k, D), 6);
  });
});
