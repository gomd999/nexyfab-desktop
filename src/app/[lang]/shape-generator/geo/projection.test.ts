import { describe, it, expect } from 'vitest';
import {
  toWebMercator,
  fromWebMercator,
  toUtm,
  utmZoneFor,
  toEcef,
  fromEcef,
  buildEnuFromOrigin,
  toEnu,
  fromEnu,
  haversineDistance,
  initialBearing,
} from './projection';

const seoul = { latitude: 37.5665, longitude: 126.9780 };
const tokyo = { latitude: 35.6762, longitude: 139.6503 };

describe('Web Mercator', () => {
  it('round-trips Seoul within 1m precision', () => {
    const m = toWebMercator(seoul);
    const back = fromWebMercator(m);
    expect(back.latitude).toBeCloseTo(seoul.latitude, 5);
    expect(back.longitude).toBeCloseTo(seoul.longitude, 5);
  });

  it('equator longitude scales linearly', () => {
    const a = toWebMercator({ latitude: 0, longitude: 0 });
    const b = toWebMercator({ latitude: 0, longitude: 90 });
    expect(a.x).toBeCloseTo(0, 5);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('y is 0 at equator', () => {
    expect(toWebMercator({ latitude: 0, longitude: 100 }).y).toBeCloseTo(0, 5);
  });
});

describe('UTM', () => {
  it('Seoul falls in zone 52', () => {
    expect(utmZoneFor(126.978)).toBe(52);
  });

  it('Tokyo falls in zone 54', () => {
    expect(utmZoneFor(139.65)).toBe(54);
  });

  it('produces N hemisphere for positive latitudes', () => {
    const u = toUtm(seoul);
    expect(u.hemisphere).toBe('N');
  });

  it('easting near 500000 at central meridian', () => {
    const u = toUtm({ latitude: 0, longitude: 129 }); // zone 52 center.
    expect(u.easting).toBeGreaterThan(490000);
    expect(u.easting).toBeLessThan(510000);
  });
});

describe('ECEF', () => {
  it('round-trips Seoul within 1m', () => {
    const e = toEcef({ ...seoul, altitude: 0 });
    const back = fromEcef(e);
    expect(back.latitude).toBeCloseTo(seoul.latitude, 4);
    expect(back.longitude).toBeCloseTo(seoul.longitude, 4);
  });

  it('north pole is on the +Z axis', () => {
    const e = toEcef({ latitude: 90, longitude: 0 });
    expect(Math.abs(e.x)).toBeLessThan(1);
    expect(Math.abs(e.y)).toBeLessThan(1);
    expect(e.z).toBeGreaterThan(6356000);
  });

  it('altitude shifts ECEF radially', () => {
    const low = toEcef({ latitude: 0, longitude: 0, altitude: 0 });
    const high = toEcef({ latitude: 0, longitude: 0, altitude: 1000 });
    expect(Math.hypot(high.x, high.y, high.z)).toBeGreaterThan(Math.hypot(low.x, low.y, low.z));
  });
});

describe('ENU local tangent plane', () => {
  it('origin → (0, 0, 0)', () => {
    const tf = buildEnuFromOrigin(seoul);
    const enu = toEnu(seoul, tf);
    expect(enu.x).toBeCloseTo(0, 2);
    expect(enu.y).toBeCloseTo(0, 2);
  });

  it('point 1 km east of origin → +x ≈ 1000', () => {
    const tf = buildEnuFromOrigin(seoul);
    const east = { latitude: seoul.latitude, longitude: seoul.longitude + 1 / 88.96 };
    const enu = toEnu(east, tf);
    expect(enu.x).toBeGreaterThan(900);
    expect(enu.x).toBeLessThan(1100);
  });

  it('round-trips ENU → LatLng', () => {
    const tf = buildEnuFromOrigin(seoul);
    const original = { x: 500, y: 300, z: 0 };
    const ll = fromEnu(original, tf);
    const enu = toEnu(ll, tf);
    expect(enu.x).toBeCloseTo(500, 2);
    expect(enu.y).toBeCloseTo(300, 2);
  });
});

describe('haversineDistance', () => {
  it('Seoul → Tokyo ≈ 1160 km', () => {
    const d = haversineDistance(seoul, tokyo);
    expect(d / 1000).toBeGreaterThan(1100);
    expect(d / 1000).toBeLessThan(1200);
  });

  it('same point → 0', () => {
    expect(haversineDistance(seoul, seoul)).toBeCloseTo(0, 5);
  });
});

describe('initialBearing', () => {
  it('Seoul → Tokyo ≈ east-southeast (90°-130°)', () => {
    const b = initialBearing(seoul, tokyo);
    expect(b).toBeGreaterThan(80);
    expect(b).toBeLessThan(140);
  });

  it('bearing returns value in [0, 360)', () => {
    const b = initialBearing(seoul, tokyo);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});
