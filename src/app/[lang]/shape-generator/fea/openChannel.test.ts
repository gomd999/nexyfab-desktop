/**
 * openChannel — Manning open-channel flow, verified: the critical depth yc=(q²/g)^{1/3}
 * (Fr=1 there), the normal-depth inversion (recovers the discharge), the sub/super-
 * critical classification (yn vs yc), and the specific-energy minimum at critical flow
 * (Emin = 1.5·yc for a rectangular channel).
 */
import { describe, it, expect } from 'vitest';
import { G, manningFlow, rectangularSection, froudeNumber, criticalDepthRectangular, specificEnergy, normalDepthRectangular } from './openChannel';

const b = 3, n = 0.013, S = 0.001, Q = 5;

describe('openChannel — Manning flow (verified)', () => {
  it('the critical depth is yc=(q²/g)^{1/3} and Fr=1 there', () => {
    const yc = criticalDepthRectangular(Q, b);
    expect(yc).toBeCloseTo(Math.cbrt((Q / b) ** 2 / G), 9);
    const sec = rectangularSection(b, yc);
    expect(froudeNumber(Q / sec.A, sec.A, sec.T)).toBeCloseTo(1, 4); // critical
  });

  it('the normal depth recovers the discharge through Manning', () => {
    const yn = normalDepthRectangular(Q, b, n, S);
    const sec = rectangularSection(b, yn);
    expect(manningFlow(n, sec.A, sec.R, S)).toBeCloseTo(Q, 4);
  });

  it('a mild slope gives subcritical flow (yn > yc, Fr < 1)', () => {
    const yc = criticalDepthRectangular(Q, b);
    const yn = normalDepthRectangular(Q, b, n, S);
    expect(yn).toBeGreaterThan(yc);
    const sec = rectangularSection(b, yn);
    expect(froudeNumber(Q / sec.A, sec.A, sec.T)).toBeLessThan(1);
  });

  it('the specific energy is minimised at the critical depth (Emin = 1.5·yc)', () => {
    const yc = criticalDepthRectangular(Q, b);
    const E = (y: number) => { const s = rectangularSection(b, y); return specificEnergy(y, Q / s.A); };
    expect(E(yc)).toBeCloseTo(1.5 * yc, 4);            // rectangular critical energy
    expect(E(yc)).toBeLessThan(E(0.7 * yc));           // less than supercritical branch
    expect(E(yc)).toBeLessThan(E(1.4 * yc));           // less than subcritical branch
  });

  it('Manning discharge increases with slope and depth', () => {
    const sec = rectangularSection(b, 1);
    expect(manningFlow(n, sec.A, sec.R, 0.004)).toBeGreaterThan(manningFlow(n, sec.A, sec.R, 0.001));
    const deep = rectangularSection(b, 2);
    expect(manningFlow(n, deep.A, deep.R, S)).toBeGreaterThan(manningFlow(n, sec.A, sec.R, S));
  });
});
