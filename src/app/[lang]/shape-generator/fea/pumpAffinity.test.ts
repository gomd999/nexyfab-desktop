/**
 * pumpAffinity — turbomachine affinity laws, verified: the speed scalings (Q∝N, H∝N²,
 * P∝N³), the diameter scalings (Q∝D³, H∝D², P∝D⁵), their consistency (P∝Q·H), the
 * specific speed N√Q/H^{3/4}, and the hydraulic power ρgQH/η.
 */
import { describe, it, expect } from 'vitest';
import { scaleFlow, scaleHead, scalePower, specificSpeed, hydraulicPower, G } from './pumpAffinity';

const N1 = 1450, N2 = 2900, Q1 = 0.05, H1 = 30, P1 = 20000;

describe('pumpAffinity — affinity laws (verified)', () => {
  it('doubling the speed: Q×2, H×4, P×8', () => {
    expect(scaleFlow(Q1, N1, N2)).toBeCloseTo(2 * Q1, 9);
    expect(scaleHead(H1, N1, N2)).toBeCloseTo(4 * H1, 9);
    expect(scalePower(P1, N1, N2)).toBeCloseTo(8 * P1, 6);
  });

  it('diameter scaling: Q∝D³, H∝D², P∝D⁵', () => {
    expect(scaleFlow(Q1, N1, N1, 1, 1.2) / Q1).toBeCloseTo(1.2 ** 3, 9);
    expect(scaleHead(H1, N1, N1, 1, 1.2) / H1).toBeCloseTo(1.2 ** 2, 9);
    expect(scalePower(P1, N1, N1, 1, 1.2) / P1).toBeCloseTo(1.2 ** 5, 9);
  });

  it('the power scaling is consistent with P ∝ Q·H', () => {
    const pRatio = scalePower(P1, N1, N2) / P1;
    const qhRatio = (scaleFlow(Q1, N1, N2) / Q1) * (scaleHead(H1, N1, N2) / H1);
    expect(pRatio).toBeCloseTo(qhRatio, 6);            // both = 8
  });

  it('the specific speed is N·√Q/H^{3/4}', () => {
    expect(specificSpeed(1450, 0.05, 30)).toBeCloseTo((1450 * Math.sqrt(0.05)) / Math.pow(30, 0.75), 6);
    // it is invariant under the affinity scaling (a similarity number).
    const Ns1 = specificSpeed(N1, Q1, H1);
    const Ns2 = specificSpeed(N2, scaleFlow(Q1, N1, N2), scaleHead(H1, N1, N2));
    expect(Ns2).toBeCloseTo(Ns1, 6);
  });

  it('the hydraulic power is ρgQH/η', () => {
    expect(hydraulicPower(1000, 0.05, 30, 0.75)).toBeCloseTo((1000 * G * 0.05 * 30) / 0.75, 6);
    // a lower efficiency needs more shaft power for the same duty.
    expect(hydraulicPower(1000, 0.05, 30, 0.6)).toBeGreaterThan(hydraulicPower(1000, 0.05, 30, 0.75));
  });
});
