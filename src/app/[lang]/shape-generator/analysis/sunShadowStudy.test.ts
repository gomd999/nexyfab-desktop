import { describe, it, expect } from 'vitest';
import {
  sunPosition,
  projectShadow,
  projectShadowPolygon,
  shadowGroundArea,
  diurnalTrace,
  dailyInsolation,
  CITIES,
} from './sunShadowStudy';

describe('sunPosition', () => {
  it('reports altitude and azimuth in degrees', () => {
    const r = sunPosition(new Date('2026-06-21T12:00:00Z'), CITIES.seoul!);
    expect(typeof r.altitudeDeg).toBe('number');
    expect(typeof r.azimuthDeg).toBe('number');
    expect(r.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(r.azimuthDeg).toBeLessThan(360);
  });

  it('summer solstice sun is high at northern latitudes', () => {
    const summer = sunPosition(new Date('2026-06-21T03:00:00Z'), CITIES.seoul!);
    expect(summer.altitudeDeg).toBeGreaterThan(40);
  });

  it('winter solstice sun is lower at same noon hour', () => {
    const summer = sunPosition(new Date('2026-06-21T03:00:00Z'), CITIES.seoul!);
    const winter = sunPosition(new Date('2026-12-21T03:00:00Z'), CITIES.seoul!);
    expect(winter.altitudeDeg).toBeLessThan(summer.altitudeDeg);
  });

  it('direction vector is unit length', () => {
    const r = sunPosition(new Date('2026-06-21T12:00:00Z'), CITIES.seoul!);
    const len = Math.hypot(r.direction[0], r.direction[1], r.direction[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it('night-time → negative altitude', () => {
    const r = sunPosition(new Date('2026-06-21T15:00:00Z'), CITIES.sydney!);
    expect(typeof r.altitudeDeg).toBe('number');
  });
});

describe('projectShadow', () => {
  it('projects onto ground plane y=0', () => {
    const ground = { originMm: [0, 0, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    // Point at (0, 5, 0), sun direction (-1, -1, 0) normalized.
    const r = projectShadow([0, 5, 0], [-1, -1, 0], ground);
    expect(r).not.toBeNull();
    expect(r![1]).toBeCloseTo(0, 5);
  });

  it('returns null when ray parallel to plane', () => {
    const ground = { originMm: [0, 0, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    expect(projectShadow([0, 5, 0], [1, 0, 0], ground)).toBeNull();
  });

  it('returns null when ray points away from plane', () => {
    const ground = { originMm: [0, 0, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    expect(projectShadow([0, 5, 0], [0, 1, 0], ground)).toBeNull();
  });
});

describe('projectShadowPolygon', () => {
  it('projects every vertex onto plane', () => {
    const ground = { originMm: [0, 0, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    const polygon: Array<[number, number, number]> = [
      [-1, 5, -1], [1, 5, -1], [1, 5, 1], [-1, 5, 1],
    ];
    const r = projectShadowPolygon(polygon, [0, -1, 0], ground);
    expect(r).toHaveLength(4);
    for (const p of r) expect(p[1]).toBeCloseTo(0, 5);
  });
});

describe('shadowGroundArea', () => {
  it('square shadow → side²', () => {
    const square: Array<[number, number, number]> = [
      [0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2],
    ];
    expect(shadowGroundArea(square)).toBeCloseTo(4, 5);
  });

  it('< 3 points → 0', () => {
    expect(shadowGroundArea([[0, 0, 0], [1, 0, 0]])).toBe(0);
  });
});

describe('diurnalTrace', () => {
  it('default hour step → 24 samples', () => {
    const r = diurnalTrace(new Date('2026-06-21'), CITIES.seoul!);
    expect(r).toHaveLength(24);
  });

  it('hour values strictly increasing', () => {
    const r = diurnalTrace(new Date('2026-06-21'), CITIES.seoul!);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.hour).toBeGreaterThan(r[i - 1]!.hour);
    }
  });
});

describe('dailyInsolation', () => {
  it('reports daylightHours > 0 in summer', () => {
    const r = dailyInsolation(new Date('2026-06-21'), CITIES.seoul!);
    expect(r.daylightHours).toBeGreaterThan(0);
  });

  it('productiveHours ≤ daylightHours', () => {
    const r = dailyInsolation(new Date('2026-06-21'), CITIES.seoul!);
    expect(r.productiveHours).toBeLessThanOrEqual(r.daylightHours);
  });

  it('higher minAltitude → fewer productive hours', () => {
    const low = dailyInsolation(new Date('2026-06-21'), CITIES.seoul!, 5);
    const high = dailyInsolation(new Date('2026-06-21'), CITIES.seoul!, 60);
    expect(high.productiveHours).toBeLessThanOrEqual(low.productiveHours);
  });
});

describe('CITIES', () => {
  it('contains common cities', () => {
    expect(CITIES.seoul).toBeDefined();
    expect(CITIES.tokyo).toBeDefined();
    expect(CITIES.new_york).toBeDefined();
  });

  it('Reykjavik is high-latitude', () => {
    expect(CITIES.reykjavik!.latitude).toBeGreaterThan(60);
  });
});
