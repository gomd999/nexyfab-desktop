/**
 * projection.ts — GIS coordinate projections.
 *
 * For architectural / urban-furniture products NexyFab sometimes
 * receives GPS-anchored site data ("place this product at 37.5665°N,
 * 126.9780°E") and must convert to a local engineering frame in mm.
 *
 * Three standard projections covered:
 *
 *   - **Web Mercator (EPSG:3857)** — Google Maps / Leaflet. Fast,
 *     locally accurate, distorts at high latitudes.
 *   - **UTM (Universal Transverse Mercator)** — 60 zones, each
 *     accurate within its 6°-wide strip. Standard for engineering
 *     site plans worldwide.
 *   - **ECEF (Earth-Centered, Earth-Fixed)** — geocentric (X, Y, Z).
 *     Used as a step in many other transforms; lossless globally.
 *
 * Plus a **local tangent plane** (ENU = east-north-up) so site
 * coordinates can be expressed relative to a project origin.
 *
 * Constants follow the WGS84 ellipsoid.
 */

// WGS84 constants.
export const WGS84_A = 6378137.0;             // semi-major axis (m)
export const WGS84_F = 1 / 298.257223563;     // flattening
export const WGS84_B = WGS84_A * (1 - WGS84_F); // semi-minor axis
export const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // first eccentricity²

export interface LatLng {
  latitude: number;
  longitude: number;
  /** Altitude above ellipsoid (m). */
  altitude?: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

// ── Web Mercator (EPSG:3857) ───────────────────────────────────

export function toWebMercator(p: LatLng): XY {
  const lonRad = (p.longitude * Math.PI) / 180;
  const latRad = (p.latitude * Math.PI) / 180;
  const x = WGS84_A * lonRad;
  const y = WGS84_A * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { x, y };
}

export function fromWebMercator(p: XY): LatLng {
  return {
    longitude: (p.x / WGS84_A) * (180 / Math.PI),
    latitude: ((2 * Math.atan(Math.exp(p.y / WGS84_A)) - Math.PI / 2) * 180) / Math.PI,
  };
}

// ── UTM ────────────────────────────────────────────────────────

export interface UtmCoord {
  zone: number;
  /** Hemisphere. */
  hemisphere: 'N' | 'S';
  /** Easting (m). */
  easting: number;
  /** Northing (m). */
  northing: number;
}

/** Pick UTM zone from longitude. */
export function utmZoneFor(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1;
}

export function toUtm(p: LatLng, zoneOverride?: number): UtmCoord {
  const zone = zoneOverride ?? utmZoneFor(p.longitude);
  const lonCenter = (zone - 1) * 6 - 180 + 3;
  const latRad = (p.latitude * Math.PI) / 180;
  const lonRad = (p.longitude * Math.PI) / 180;
  const lonCenterRad = (lonCenter * Math.PI) / 180;

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = (WGS84_E2 / (1 - WGS84_E2)) * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonCenterRad);

  const M = WGS84_A * (
    (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256) * latRad -
    (3 * WGS84_E2 / 8 + 3 * WGS84_E2 ** 2 / 32 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(2 * latRad) +
    (15 * WGS84_E2 ** 2 / 256 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(4 * latRad) -
    (35 * WGS84_E2 ** 3 / 3072) * Math.sin(6 * latRad)
  );

  const k0 = 0.9996;
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * WGS84_E2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(latRad) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * WGS84_E2) * A ** 6 / 720));
  if (p.latitude < 0) northing += 10000000;

  return {
    zone,
    hemisphere: p.latitude >= 0 ? 'N' : 'S',
    easting,
    northing,
  };
}

// ── ECEF (geocentric) ──────────────────────────────────────────

export function toEcef(p: LatLng): XYZ {
  const latRad = (p.latitude * Math.PI) / 180;
  const lonRad = (p.longitude * Math.PI) / 180;
  const alt = p.altitude ?? 0;
  const sinLat = Math.sin(latRad);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + alt) * Math.cos(latRad) * Math.cos(lonRad),
    y: (N + alt) * Math.cos(latRad) * Math.sin(lonRad),
    z: (N * (1 - WGS84_E2) + alt) * sinLat,
  };
}

export function fromEcef(p: XYZ): LatLng {
  const lon = Math.atan2(p.y, p.x);
  const r = Math.hypot(p.x, p.y);
  // Bowring iteration.
  let lat = Math.atan2(p.z, r * (1 - WGS84_E2));
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(p.z + WGS84_E2 * N * sinLat, r);
  }
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const altitude = r / Math.cos(lat) - N;
  return {
    latitude: (lat * 180) / Math.PI,
    longitude: (lon * 180) / Math.PI,
    altitude,
  };
}

// ── Local ENU (east-north-up) tangent plane ────────────────────

export interface EnuTransform {
  /** Origin of local frame in LatLng. */
  origin: LatLng;
  /** Origin in ECEF for reuse. */
  originEcef: XYZ;
  /** Rotation matrix (3×3 row-major) from ECEF to ENU. */
  ecefToEnuRotation: number[];
}

export function buildEnuFromOrigin(origin: LatLng): EnuTransform {
  const originEcef = toEcef(origin);
  const lat = (origin.latitude * Math.PI) / 180;
  const lon = (origin.longitude * Math.PI) / 180;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);
  return {
    origin,
    originEcef,
    ecefToEnuRotation: [
      -sLon, cLon, 0,
      -sLat * cLon, -sLat * sLon, cLat,
      cLat * cLon, cLat * sLon, sLat,
    ],
  };
}

export function toEnu(p: LatLng, transform: EnuTransform): XYZ {
  const ecef = toEcef(p);
  const dx = ecef.x - transform.originEcef.x;
  const dy = ecef.y - transform.originEcef.y;
  const dz = ecef.z - transform.originEcef.z;
  const r = transform.ecefToEnuRotation;
  return {
    x: r[0]! * dx + r[1]! * dy + r[2]! * dz,
    y: r[3]! * dx + r[4]! * dy + r[5]! * dz,
    z: r[6]! * dx + r[7]! * dy + r[8]! * dz,
  };
}

export function fromEnu(enu: XYZ, transform: EnuTransform): LatLng {
  const r = transform.ecefToEnuRotation;
  // Transpose of rotation = inverse.
  const dx = r[0]! * enu.x + r[3]! * enu.y + r[6]! * enu.z;
  const dy = r[1]! * enu.x + r[4]! * enu.y + r[7]! * enu.z;
  const dz = r[2]! * enu.x + r[5]! * enu.y + r[8]! * enu.z;
  return fromEcef({
    x: transform.originEcef.x + dx,
    y: transform.originEcef.y + dy,
    z: transform.originEcef.z + dz,
  });
}

// ── Distance helpers ───────────────────────────────────────────

/** Great-circle distance via haversine. Returns metres. */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return WGS84_A * c;
}

/** Initial bearing in degrees from a to b. */
export function initialBearing(a: LatLng, b: LatLng): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
