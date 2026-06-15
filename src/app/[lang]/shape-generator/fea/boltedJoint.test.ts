/**
 * boltedJoint — preloaded bolted-joint mechanics, verified: the preload from torque
 * Fi=T/(Kd); the stiffness ratio C=kb/(kb+km); the load split (Fb−Fm=P with the bolt
 * carrying only C·P, the rest unloading the members); and the separation load
 * P_sep=Fi/(1−C) where the member load reaches zero.
 */
import { describe, it, expect } from 'vitest';
import { preloadFromTorque, axialStiffness, stiffnessRatio, boltLoad, memberLoad, separationLoad } from './boltedJoint';

const Fi = preloadFromTorque(20, 0.2, 0.01); // 10 000 N
const C = stiffnessRatio(1e8, 3e8);          // 0.25

describe('boltedJoint — preloaded fastener (verified)', () => {
  it('the preload from torque is Fi = T/(K·d)', () => {
    expect(Fi).toBeCloseTo(20 / (0.2 * 0.01), 6);
    expect(stiffnessRatio(1e8, 3e8)).toBeCloseTo(0.25, 9);
    expect(axialStiffness(78e-6, 200e9, 0.05)).toBeCloseTo((78e-6 * 200e9) / 0.05, 3);
  });

  it('the external load splits between bolt and members (Fb − Fm = P)', () => {
    const P = 4000;
    const Fb = boltLoad(Fi, C, P), Fm = memberLoad(Fi, C, P);
    expect(Fb).toBeCloseTo(Fi + C * P, 9);             // bolt gains C·P
    expect(Fm).toBeCloseTo(Fi - (1 - C) * P, 9);       // members lose (1−C)·P
    expect(Fb - Fm).toBeCloseTo(P, 6);                 // the split sums to the external load
    expect(Fb - Fi).toBeCloseTo(C * P, 9);             // bolt sees only the fraction C
  });

  it('the joint separates at P_sep = Fi/(1−C) (member load zero)', () => {
    const Psep = separationLoad(Fi, C);
    expect(Psep).toBeCloseTo(Fi / (1 - C), 6);
    expect(memberLoad(Fi, C, Psep)).toBeCloseTo(0, 6);
  });

  it('the member (clamp) load decreases with the external load', () => {
    expect(memberLoad(Fi, C, 0)).toBeCloseTo(Fi, 9);   // full clamp at no external load
    expect(memberLoad(Fi, C, 8000)).toBeLessThan(memberLoad(Fi, C, 4000));
  });

  it('a stiffer bolt (higher C) makes it carry more of the external load', () => {
    const Cstiff = stiffnessRatio(3e8, 1e8);           // 0.75
    expect(boltLoad(Fi, Cstiff, 4000) - Fi).toBeGreaterThan(boltLoad(Fi, C, 4000) - Fi);
  });
});
