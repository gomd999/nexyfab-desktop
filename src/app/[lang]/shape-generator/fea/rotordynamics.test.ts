/**
 * rotordynamics — gyroscopic whirl of a spinning rotor, verified: at rest the whirl
 * is a degenerate pair at √(k/It); the gyroscopic coupling splits it into a rising
 * forward and a falling backward branch (the Campbell diagram); the synchronous
 * critical speeds are √(k/(It∓Ip)), where the whirl branch meets the 1× line.
 */
import { describe, it, expect } from 'vitest';
import { whirlFrequencies, criticalSpeeds, campbellDiagram, characteristicResidual } from './rotordynamics';

const It = 2, Ip = 1, k = 100;
const wn = Math.sqrt(k / It);

describe('rotordynamics — gyroscopic whirl (verified)', () => {
  it('the whirl is a degenerate pair at √(k/It) when not spinning', () => {
    const w = whirlFrequencies(It, Ip, k, 0);
    expect(w.forward).toBeCloseTo(wn, 10);
    expect(w.backward).toBeCloseTo(wn, 10);
  });

  it('spinning splits the whirl: forward rises, backward falls (monotone)', () => {
    const cam = campbellDiagram(It, Ip, k, [0, 2, 4, 6, 8]);
    for (let i = 1; i < cam.length; i++) {
      expect(cam[i].forward).toBeGreaterThan(cam[i - 1].forward);   // forward ↑
      expect(cam[i].backward).toBeLessThan(cam[i - 1].backward);    // backward ↓
    }
    expect(cam[2].forward).toBeGreaterThan(wn);
    expect(cam[2].backward).toBeLessThan(wn);
  });

  it('the synchronous critical speeds are √(k/(It∓Ip))', () => {
    const cs = criticalSpeeds(It, Ip, k);
    expect(cs.forward).toBeCloseTo(Math.sqrt(k / (It - Ip)), 10);   // 10
    expect(cs.backward).toBeCloseTo(Math.sqrt(k / (It + Ip)), 10);  // 5.774
  });

  it('at a critical speed the whirl frequency equals the spin speed (1× line)', () => {
    const cs = criticalSpeeds(It, Ip, k);
    expect(whirlFrequencies(It, Ip, k, cs.forward).forward).toBeCloseTo(cs.forward, 8);
    expect(whirlFrequencies(It, Ip, k, cs.backward).backward).toBeCloseTo(cs.backward, 8);
  });

  it('the whirl frequencies satisfy the gyroscopic characteristic equation', () => {
    const Omega = 4;
    const w = whirlFrequencies(It, Ip, k, Omega);
    expect(characteristicResidual(It, Ip, k, Omega, w.forward)).toBeCloseTo(0, 6);
    expect(characteristicResidual(It, Ip, k, Omega, -w.backward)).toBeCloseTo(0, 6); // backward = negative root
  });

  it('a disk-dominated rotor (It ≤ Ip) has no forward synchronous critical speed', () => {
    expect(criticalSpeeds(1, 2, k).forward).toBe(Infinity);
    expect(criticalSpeeds(1, 2, k).backward).toBeCloseTo(Math.sqrt(k / 3), 10);
  });
});
