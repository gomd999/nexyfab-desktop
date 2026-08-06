import { describe, expect, it } from 'vitest';
import { calculateIesIlluminance, calculateIesIlluminancePlanes, parseIesLm63, sampleIesCandela } from '../iesPhotometricCalculation';

const ies = `IESNA:LM-63-2002
[TEST] synthetic
TILT=NONE
1 1000 1 3 1 1 2 0 0 0
1 1 10
0 45 90
0
1000 500 0`;

describe('LM-63 point-by-point photometric calculation', () => {
  it('parses angle and candela tables and interpolates vertical intensity', () => {
    const profile = parseIesLm63('ies:test', ies);
    expect(profile.verticalAnglesDeg).toEqual([0, 45, 90]);
    expect(sampleIesCandela(profile, 22.5, 180)).toBe(750);
  });
  it('calculates horizontal-plane illuminance, minimum, and uniformity', () => {
    const profile = parseIesLm63('ies:test', ies), result = calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: 'ies:test' }], [[0, 0], [2000, 0]], 0, new Map([[profile.id, profile]]));
    expect(result.pointLux[0]!.lux).toBeCloseTo(250, 6);
    expect(result.pointLux[1]!.lux).toBeCloseTo(44.194, 3);
    expect(result.averageLux).toBeCloseTo(147.097, 3);
    expect(result.uniformityMinToAverage).toBeCloseTo(44.194 / 147.097, 3);
  });
  it('applies LM-63 quadrant symmetry before horizontal interpolation', () => {
    const quadrant = parseIesLm63('ies:quadrant', ies.replace('3 1 1 2', '3 2 1 2').replace('\n0\n1000 500 0', '\n0 90\n1000 500 0\n800 400 0'));
    expect(sampleIesCandela(quadrant, 0, 135)).toBe(900);
    expect(sampleIesCandela(quadrant, 0, 225)).toBe(900);
  });
  it('fails closed for tilted, incomplete, or missing photometric data', () => {
    expect(() => parseIesLm63('bad', ies.replace('TILT=NONE', 'TILT=INCLUDE'))).toThrow('TILT=NONE');
    const profile = parseIesLm63('ies:test', ies);
    expect(() => calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: 'missing' }], [[0, 0]], 0, new Map([[profile.id, profile]]))).toThrow('Missing');
  });
  it('supports fixture yaw and multiple explicitly identified workplanes', () => {
    const directional = parseIesLm63('ies:directional', ies.replace('3 1 1 2', '3 2 1 2').replace('\n0\n1000 500 0', '\n0 90\n1000 500 0\n500 250 0'));
    const profiles = new Map([[directional.id, directional]]), noYaw = calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: directional.id, yawDeg: 0 }], [[2000, 0]], 0, profiles), yaw = calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: directional.id, yawDeg: 90 }], [[2000, 0]], 0, profiles);
    expect(noYaw.averageLux).toBeGreaterThan(yaw.averageLux);
    const planes = calculateIesIlluminancePlanes([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: directional.id }], [{ id: 'floor', pointsMm: [[0, 0]], heightMm: 0 }, { id: 'desk', pointsMm: [[0, 0]], heightMm: 800 }], profiles);
    expect(Object.keys(planes)).toEqual(['floor', 'desk']); expect(planes.desk!.averageLux).toBeGreaterThan(planes.floor!.averageLux);
  });
  it('transforms a tilted fixture into its photometric coordinate system', () => {
    const profile = parseIesLm63('ies:test', ies), profiles = new Map([[profile.id, profile]]), downward = calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: profile.id }], [[0, 0]], 0, profiles);
    const half = Math.sqrt(0.5), tilted = calculateIesIlluminance([{ id: 'light', positionMm: [0, 0, 2000], iesProfileId: profile.id, worldToPhotometricQuaternion: { x: 0, y: half, z: 0, w: half } }], [[0, 0]], 0, profiles);
    expect(downward.averageLux).toBe(250); expect(tilted.averageLux).toBeCloseTo(0, 8);
  });
});
