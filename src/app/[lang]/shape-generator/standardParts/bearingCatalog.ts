/**
 * bearingCatalog.ts — Rolling-element bearing catalog.
 *
 * The catalog covers the three families that account for ~95% of
 * mechanical-engineering bearings in NexyFab's target manufacturing
 * cases: deep groove, angular contact, and thrust. Each entry is
 * keyed by **bore × OD × width** in mm — the universal "shopping"
 * signature.
 *
 * We ship only the *common* sizes (the ones any Korean partner
 * holds in stock). Exotic sizes can be added via overrides.
 *
 * Data source: SKF / NSK / FAG public catalogs — all measurements
 * round to standard ISO 15 / ISO 355 dimensions.
 */

export type BearingFamily = 'deep-groove' | 'angular-contact' | 'thrust';

export interface BearingDimensions {
  /** Inner diameter / bore (mm). */
  boreMm: number;
  /** Outer diameter (mm). */
  odMm: number;
  /** Width (mm) — face-to-face for radial; height for thrust. */
  widthMm: number;
}

export interface BearingSpec extends BearingDimensions {
  family: BearingFamily;
  /** Industry designation (e.g. "6202", "7202B", "51102"). */
  designation: string;
  /** Dynamic load rating (kN) — used by FEA preview for sizing. */
  dynamicLoadRatingKn?: number;
  /** Limiting speed (RPM). */
  limitingRpm?: number;
}

/** Deep groove radial — ISO 15 dimension series 02 (most common). */
const DEEP_GROOVE: BearingSpec[] = [
  { family: 'deep-groove', designation: '608',  boreMm: 8,  odMm: 22, widthMm: 7,  dynamicLoadRatingKn: 3.45,  limitingRpm: 32000 },
  { family: 'deep-groove', designation: '609',  boreMm: 9,  odMm: 24, widthMm: 7,  dynamicLoadRatingKn: 3.71,  limitingRpm: 30000 },
  { family: 'deep-groove', designation: '6000', boreMm: 10, odMm: 26, widthMm: 8,  dynamicLoadRatingKn: 4.55,  limitingRpm: 30000 },
  { family: 'deep-groove', designation: '6001', boreMm: 12, odMm: 28, widthMm: 8,  dynamicLoadRatingKn: 5.10,  limitingRpm: 28000 },
  { family: 'deep-groove', designation: '6002', boreMm: 15, odMm: 32, widthMm: 9,  dynamicLoadRatingKn: 5.85,  limitingRpm: 26000 },
  { family: 'deep-groove', designation: '6003', boreMm: 17, odMm: 35, widthMm: 10, dynamicLoadRatingKn: 6.05,  limitingRpm: 24000 },
  { family: 'deep-groove', designation: '6004', boreMm: 20, odMm: 42, widthMm: 12, dynamicLoadRatingKn: 9.36,  limitingRpm: 20000 },
  { family: 'deep-groove', designation: '6005', boreMm: 25, odMm: 47, widthMm: 12, dynamicLoadRatingKn: 11.20, limitingRpm: 18000 },
  { family: 'deep-groove', designation: '6006', boreMm: 30, odMm: 55, widthMm: 13, dynamicLoadRatingKn: 13.80, limitingRpm: 15000 },
  { family: 'deep-groove', designation: '6007', boreMm: 35, odMm: 62, widthMm: 14, dynamicLoadRatingKn: 16.80, limitingRpm: 13000 },
  { family: 'deep-groove', designation: '6008', boreMm: 40, odMm: 68, widthMm: 15, dynamicLoadRatingKn: 17.80, limitingRpm: 12000 },
];

const ANGULAR_CONTACT: BearingSpec[] = [
  { family: 'angular-contact', designation: '7000B', boreMm: 10, odMm: 26, widthMm: 8,  dynamicLoadRatingKn: 5.10 },
  { family: 'angular-contact', designation: '7001B', boreMm: 12, odMm: 28, widthMm: 8,  dynamicLoadRatingKn: 5.50 },
  { family: 'angular-contact', designation: '7002B', boreMm: 15, odMm: 32, widthMm: 9,  dynamicLoadRatingKn: 6.50 },
  { family: 'angular-contact', designation: '7003B', boreMm: 17, odMm: 35, widthMm: 10, dynamicLoadRatingKn: 7.00 },
  { family: 'angular-contact', designation: '7004B', boreMm: 20, odMm: 42, widthMm: 12, dynamicLoadRatingKn: 10.20 },
  { family: 'angular-contact', designation: '7005B', boreMm: 25, odMm: 47, widthMm: 12, dynamicLoadRatingKn: 11.20 },
  { family: 'angular-contact', designation: '7006B', boreMm: 30, odMm: 55, widthMm: 13, dynamicLoadRatingKn: 14.30 },
];

const THRUST: BearingSpec[] = [
  { family: 'thrust', designation: '51100', boreMm: 10, odMm: 24, widthMm: 9 },
  { family: 'thrust', designation: '51101', boreMm: 12, odMm: 26, widthMm: 9 },
  { family: 'thrust', designation: '51102', boreMm: 15, odMm: 28, widthMm: 9 },
  { family: 'thrust', designation: '51103', boreMm: 17, odMm: 30, widthMm: 9 },
  { family: 'thrust', designation: '51104', boreMm: 20, odMm: 35, widthMm: 10 },
];

const ALL_BEARINGS = [...DEEP_GROOVE, ...ANGULAR_CONTACT, ...THRUST];

export function listBearings(family?: BearingFamily): BearingSpec[] {
  return family ? ALL_BEARINGS.filter(b => b.family === family) : ALL_BEARINGS.slice();
}

export function findByDesignation(designation: string): BearingSpec | null {
  return ALL_BEARINGS.find(b => b.designation === designation) ?? null;
}

/** Find bearings matching a given bore. Sorted by OD ascending. */
export function findByBore(boreMm: number, family?: BearingFamily): BearingSpec[] {
  return listBearings(family)
    .filter(b => b.boreMm === boreMm)
    .sort((a, b) => a.odMm - b.odMm);
}

/** Find the smallest bearing that fits the load + speed constraints. */
export interface BearingPickQuery {
  family?: BearingFamily;
  minBoreMm?: number;
  maxOdMm?: number;
  loadKn?: number;
  /** RPM the shaft will run at. */
  rpm?: number;
}

export function pickBearing(q: BearingPickQuery): BearingSpec | null {
  const candidates = listBearings(q.family).filter(b => {
    if (q.minBoreMm != null && b.boreMm < q.minBoreMm) return false;
    if (q.maxOdMm != null && b.odMm > q.maxOdMm) return false;
    // Bearings without published load ratings (e.g. thrust catalog
    // entries) are excluded from load-filtered picks — we'd rather
    // return null than recommend a bearing with unknown capacity.
    if (q.loadKn != null) {
      if (b.dynamicLoadRatingKn == null) return false;
      if (b.dynamicLoadRatingKn < q.loadKn) return false;
    }
    if (q.rpm != null && b.limitingRpm != null && b.limitingRpm < q.rpm) return false;
    return true;
  });
  candidates.sort((a, b) => a.odMm - b.odMm);
  return candidates[0] ?? null;
}
