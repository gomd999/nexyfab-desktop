import { describe, expect, it } from 'vitest';
import { calculateSolarPosition, calculateWindowSunAccess, gateDaylightRelease } from '../solarDaylight';

describe('solar position and direct window sun access', () => {
  const instants = [new Date('2026-03-20T11:00:00Z'), new Date('2026-03-20T12:00:00Z'), new Date('2026-03-20T13:00:00Z')];
  it('computes a near-overhead equatorial equinox sun', () => { const sun = calculateSolarPosition(0, 0, instants[1]!); expect(sun.elevationDeg).toBeGreaterThan(85); expect(Math.hypot(...sun.directionEnu)).toBeCloseTo(1, 9); });
  it('measures unobstructed and obstructed direct sun without claiming annual daylight', () => {
    const window = [{ id: 'skylight', centerMm: [0, 0, 0] as [number, number, number], outwardNormalEnu: [0, 0, 1] as [number, number, number], glazingAreaMm2: 2_000_000, visibleTransmittance: 0.7 }];
    expect(calculateWindowSunAccess(0, 0, instants, window, [])[0]!.directSunHours).toBe(2);
    const obstructed = calculateWindowSunAccess(0, 0, instants, window, [{ id: 'shade', minMm: [-1000, -1000, 100], maxMm: [1000, 1000, 500] }]); expect(obstructed[0]!.samples.every(sample => !sample.directSun)).toBe(true);
    expect(gateDaylightRelease().status).toBe('not_run');
  });
  it('requires governed criteria and evaluates complete annual simulation evidence', () => { const evidence = { ran: true, engine: 'Radiance', weatherFileHash: 'sha256:test', sensorCount: 100, spatialDaylightAutonomyPercent: 62, annualSunlightExposurePercent: 8 }; expect(gateDaylightRelease(evidence).status).toBe('not_run'); expect(gateDaylightRelease(evidence, { minimumSpatialDaylightAutonomyPercent: 55, maximumAnnualSunlightExposurePercent: 10 }).status).toBe('passed'); });
});
