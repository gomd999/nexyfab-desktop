/**
 * eng-domain/interior — PURE building-code compliance check functions (gate material).
 *
 * Scope: life-safety / space-planning code checks that a later interior DomainModule
 * (Batch 2) will wire into an interior design driver. These are PURE, deterministic,
 * Node/browser-agnostic functions. No I/O, no design-driver imports.
 *
 * Every check REAL-computes its metrics and refuses (pass:false + reason) when the
 * code limit is violated. Each result carries a `basis` citing the code clause / formula.
 *
 * Code references (representative — stated explicitly, values are approximations of
 * the published tables and MUST be verified against the authority having jurisdiction):
 *   - IBC 2018 (International Building Code) — occupant load, egress, corridor, plumbing.
 *   - KBC / 건축법 시행령 · 건축물의 피난·방화구조 등의 기준에 관한 규칙 — Korean equivalents.
 *
 * Unit convention: lengths in mm unless the field name says otherwise; areas in m².
 * Conversions used: 1 ft = 304.8 mm, 1 ft² = 0.092903 m², 1 in = 25.4 mm.
 */

export interface InteriorCheckResult {
  /** stable check id, e.g. 'egress-travel-distance' */
  id: string;
  /** true iff the measured metrics satisfy the code limit */
  pass: boolean;
  /** measured values backing the verdict (real-computed, never fabricated) */
  metrics: Record<string, number>;
  /** present iff !pass — human-readable reason the limit was violated */
  reason?: string;
  /** the code clause / formula basis (근사/대표값 명시) — REQUIRED */
  basis: string;
}

/** Occupancy use-group keys shared across checks. */
export type UseGroup =
  | 'assembly-concentrated' // chairs only, non-fixed
  | 'assembly-unconcentrated' // tables and chairs
  | 'assembly-standing'
  | 'business'
  | 'educational'
  | 'mercantile'
  | 'residential'
  | 'industrial'
  | 'storage';

const FT2_TO_M2 = 0.092903;
const IN_TO_MM = 25.4;

/**
 * IBC 2018 Table 1004.5 maximum floor area allowances per occupant, converted to m²/person.
 * "net"/"gross" per the table; documented for traceability. Representative values.
 */
export const OCCUPANT_LOAD_FACTOR_M2: Record<UseGroup, number> = {
  'assembly-concentrated': 7 * FT2_TO_M2, // 0.650  (7 net ft²)
  'assembly-unconcentrated': 15 * FT2_TO_M2, // 1.394 (15 net ft²)
  'assembly-standing': 5 * FT2_TO_M2, // 0.465  (5 net ft²)
  business: 150 * FT2_TO_M2, // 13.935 (150 gross ft²)
  educational: 20 * FT2_TO_M2, // 1.858  (20 net ft², classroom)
  mercantile: 60 * FT2_TO_M2, // 5.574  (60 gross ft²)
  residential: 200 * FT2_TO_M2, // 18.581 (200 gross ft²)
  industrial: 100 * FT2_TO_M2, // 9.290  (100 gross ft²)
  storage: 300 * FT2_TO_M2, // 27.871 (300 gross ft²)
};

/**
 * IBC 2018 Table 1017.2 exit access travel distance limits, {nonSprinklered, sprinklered} in meters.
 * Converted from ft (200/250/300 ft). Representative — some subgroups differ; verify AHJ.
 * KBC alternative (건축법 시행령 §34, 보행거리): 30 m general / 50 m when 주요구조부 내화구조·불연재.
 */
export const TRAVEL_DISTANCE_LIMIT_M: Record<
  UseGroup,
  { nonSprinklered: number; sprinklered: number }
> = {
  'assembly-concentrated': { nonSprinklered: 60.96, sprinklered: 76.2 }, // 200/250 ft
  'assembly-unconcentrated': { nonSprinklered: 60.96, sprinklered: 76.2 },
  'assembly-standing': { nonSprinklered: 60.96, sprinklered: 76.2 },
  business: { nonSprinklered: 60.96, sprinklered: 91.44 }, // 200/300 ft
  educational: { nonSprinklered: 60.96, sprinklered: 76.2 }, // 200/250 ft
  mercantile: { nonSprinklered: 60.96, sprinklered: 76.2 }, // 200/250 ft
  residential: { nonSprinklered: 60.96, sprinklered: 76.2 }, // 200/250 ft
  industrial: { nonSprinklered: 60.96, sprinklered: 76.2 }, // F-1/S-1 200/250 ft
  storage: { nonSprinklered: 60.96, sprinklered: 76.2 },
};

/**
 * IBC 2018 Table 2902.1 — approximate occupants-served-per-water-closet by use group.
 * The real table uses tiered ratios (e.g. Business 1:25 first 50, then 1:50). We use a
 * single conservative "persons per fixture" figure per group as a representative gate value.
 */
export const PERSONS_PER_WATER_CLOSET: Record<UseGroup, number> = {
  'assembly-concentrated': 75, // A: 1 per 75 (male basis, representative)
  'assembly-unconcentrated': 75,
  'assembly-standing': 75,
  business: 25, // B: 1 per 25 (first 50)
  educational: 50, // E: 1 per 50
  mercantile: 500, // M: 1 per 500
  residential: 10, // R: dwelling basis (representative)
  industrial: 100, // F: 1 per 100
  storage: 100, // S: 1 per 100
};

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * 1) EGRESS TRAVEL DISTANCE — measured max travel distance vs code limit.
 * pass iff measuredTravelM ≤ limit(useGroup, sprinklered). Optional limitOverrideM wins.
 * Basis: IBC 2018 §1017 / Table 1017.2.
 */
export function checkEgressTravelDistance(input: {
  measuredTravelM: number;
  useGroup: UseGroup;
  sprinklered: boolean;
  limitOverrideM?: number;
}): InteriorCheckResult {
  const { measuredTravelM, useGroup, sprinklered } = input;
  const table = TRAVEL_DISTANCE_LIMIT_M[useGroup];
  const limitM =
    input.limitOverrideM ??
    (sprinklered ? table.sprinklered : table.nonSprinklered);
  const marginM = round(limitM - measuredTravelM);
  const pass = measuredTravelM <= limitM;
  return {
    id: 'egress-travel-distance',
    pass,
    metrics: {
      measuredTravelM: round(measuredTravelM),
      limitM: round(limitM),
      marginM,
    },
    reason: pass
      ? undefined
      : `보행거리 ${round(measuredTravelM)} m 가 허용 ${round(limitM)} m 를 초과 (${useGroup}, ${
          sprinklered ? '스프링클러 유' : '스프링클러 무'
        }).`,
    basis:
      'IBC 2018 §1017 / Table 1017.2 exit access travel distance (대표값·근사; KBC 건축법 시행령 §34 대안 30/50 m).',
  };
}

/**
 * 2) EGRESS WIDTH — required width = occupantLoad × capacityFactor(mm/person).
 * pass iff providedWidthMm ≥ requiredWidthMm.
 * Basis: IBC 2018 §1005.3 — 0.2 in (5.08 mm)/occ level components, 0.3 in (7.62 mm)/occ stairways
 * (non-sprinklered). Sprinklered+alarm reduces (0.15/0.2 in) — pass factor via capacityFactorMmPerOcc.
 */
export function checkEgressWidth(input: {
  occupantLoad: number;
  providedWidthMm: number;
  /** default 5.08 mm/occ (level egress, 0.2 in). Stairways 7.62 mm/occ (0.3 in). */
  capacityFactorMmPerOcc?: number;
}): InteriorCheckResult {
  const { occupantLoad, providedWidthMm } = input;
  const factor = input.capacityFactorMmPerOcc ?? 0.2 * IN_TO_MM; // 5.08
  const requiredWidthMm = round(occupantLoad * factor, 2);
  const pass = providedWidthMm >= requiredWidthMm;
  return {
    id: 'egress-width',
    pass,
    metrics: {
      occupantLoad,
      capacityFactorMmPerOcc: round(factor, 3),
      requiredWidthMm,
      providedWidthMm: round(providedWidthMm, 2),
      marginMm: round(providedWidthMm - requiredWidthMm, 2),
    },
    reason: pass
      ? undefined
      : `확보 피난폭 ${round(providedWidthMm, 2)} mm < 필요 ${requiredWidthMm} mm (재실자 ${occupantLoad} × ${round(
          factor,
          3,
        )} mm/인).`,
    basis:
      'IBC 2018 §1005.3 egress capacity factor (level 0.2 in=5.08 mm/occ, stair 0.3 in=7.62 mm/occ; 근사).',
  };
}

/**
 * 3) OCCUPANCY LOAD — occupants = ceil(floorAreaM2 / loadFactor(useGroup)).
 * Returns the computed count for downstream checks to consume. When postedOccupantLimit
 * is supplied, pass iff computedOccupants ≤ postedOccupantLimit (posted room capacity);
 * without it the check is informational (pass:true) but always reports occupantLoad.
 * Basis: IBC 2018 §1004.5 / Table 1004.5 maximum floor area allowances per occupant.
 */
export function checkOccupancyLoad(input: {
  floorAreaM2: number;
  useGroup: UseGroup;
  /** optional explicit factor (m²/person) overriding the table */
  loadFactorM2Override?: number;
  /** optional posted maximum occupant capacity to gate against */
  postedOccupantLimit?: number;
}): InteriorCheckResult {
  const { floorAreaM2, useGroup } = input;
  const factor = input.loadFactorM2Override ?? OCCUPANT_LOAD_FACTOR_M2[useGroup];
  const occupantLoad = Math.ceil(floorAreaM2 / factor);
  const hasLimit = typeof input.postedOccupantLimit === 'number';
  const pass = hasLimit ? occupantLoad <= (input.postedOccupantLimit as number) : true;
  return {
    id: 'occupancy-load',
    pass,
    metrics: {
      floorAreaM2: round(floorAreaM2, 3),
      loadFactorM2: round(factor, 3),
      occupantLoad,
      ...(hasLimit ? { postedOccupantLimit: input.postedOccupantLimit as number } : {}),
    },
    reason:
      pass || !hasLimit
        ? undefined
        : `산정 재실자 ${occupantLoad} 명 > 게시 수용한도 ${input.postedOccupantLimit} 명 (${useGroup}, 밀도 ${round(
            factor,
            3,
          )} m²/인).`,
    basis:
      'IBC 2018 §1004.5 / Table 1004.5 occupant load factor (대표값·근사; net/gross per table).',
  };
}

/**
 * 4) CORRIDOR / CLEARANCE WIDTH — measured clear width vs minimum.
 * Minimum defaults per IBC 2018 §1020.2: 1118 mm (44 in) general; 915 mm (36 in) when
 * served occupant load < 50. Accessible route minimum continuous clear width 915 mm
 * (ADA/KDS). Optional minWidthMmOverride wins. pass iff measuredClearWidthMm ≥ min.
 */
export function checkCorridorClearWidth(input: {
  measuredClearWidthMm: number;
  /** occupant load served by the corridor (selects 44 in vs 36 in floor) */
  occupantLoadServed?: number;
  minWidthMmOverride?: number;
}): InteriorCheckResult {
  const { measuredClearWidthMm } = input;
  const served = input.occupantLoadServed ?? 50;
  const codeMinMm = served < 50 ? 36 * IN_TO_MM : 44 * IN_TO_MM; // 914.4 / 1117.6
  const minWidthMm = input.minWidthMmOverride ?? codeMinMm;
  const pass = measuredClearWidthMm >= minWidthMm;
  return {
    id: 'corridor-clear-width',
    pass,
    metrics: {
      measuredClearWidthMm: round(measuredClearWidthMm, 2),
      minWidthMm: round(minWidthMm, 2),
      occupantLoadServed: served,
      marginMm: round(measuredClearWidthMm - minWidthMm, 2),
    },
    reason: pass
      ? undefined
      : `복도 유효폭 ${round(measuredClearWidthMm, 2)} mm < 최소 ${round(
          minWidthMm,
          2,
        )} mm (재실자 ${served} 기준).`,
    basis:
      'IBC 2018 §1020.2 corridor width (44 in=1117.6 mm; <50 occ 36 in=914.4 mm; ADA/KDS 접근로 근사).',
  };
}

/**
 * 5) PLUMBING FIXTURE COUNT — required water closets = ceil(occupants / personsPerFixture).
 * pass iff providedFixtures ≥ requiredFixtures.
 * Basis: IBC 2018 §2902 / Table 2902.1 (대표 비율·근사; 실제 표는 tiered ratio).
 * KBC alt: 건축물의 설비기준 등에 관한 규칙 별표 위생기구 기준.
 */
export function checkPlumbingFixtureCount(input: {
  occupantLoad: number;
  providedFixtures: number;
  useGroup: UseGroup;
  personsPerFixtureOverride?: number;
}): InteriorCheckResult {
  const { occupantLoad, providedFixtures, useGroup } = input;
  const ratio = input.personsPerFixtureOverride ?? PERSONS_PER_WATER_CLOSET[useGroup];
  const requiredFixtures = Math.ceil(occupantLoad / ratio);
  const pass = providedFixtures >= requiredFixtures;
  return {
    id: 'plumbing-fixture-count',
    pass,
    metrics: {
      occupantLoad,
      personsPerFixture: ratio,
      requiredFixtures,
      providedFixtures,
      marginFixtures: providedFixtures - requiredFixtures,
    },
    reason: pass
      ? undefined
      : `위생기구 ${providedFixtures} 개 < 필요 ${requiredFixtures} 개 (재실자 ${occupantLoad} ÷ 1:${ratio}).`,
    basis:
      'IBC 2018 §2902 / Table 2902.1 water closet ratio (대표값·근사; KBC 설비기준규칙 별표 대안).',
  };
}

/**
 * 6) CEILING (반자) HEIGHT — measured habitable-room ceiling height vs minimum.
 * Default minimum 2100 mm per KBC (건축물의 피난·방화구조 등의 기준에 관한 규칙 §16, 거실 반자높이 2.1 m);
 * IBC 2018 §1208.2 habitable min 2134 mm (7 ft). pass iff measuredHeightMm ≥ min.
 */
export function checkCeilingHeight(input: {
  measuredHeightMm: number;
  minHeightMmOverride?: number;
}): InteriorCheckResult {
  const { measuredHeightMm } = input;
  const minHeightMm = input.minHeightMmOverride ?? 2100; // KBC 2.1 m
  const pass = measuredHeightMm >= minHeightMm;
  return {
    id: 'ceiling-height',
    pass,
    metrics: {
      measuredHeightMm: round(measuredHeightMm, 2),
      minHeightMm: round(minHeightMm, 2),
      marginMm: round(measuredHeightMm - minHeightMm, 2),
    },
    reason: pass
      ? undefined
      : `거실 반자높이 ${round(measuredHeightMm, 2)} mm < 최소 ${round(minHeightMm, 2)} mm.`,
    basis:
      'KBC 건축물의 피난·방화구조 규칙 §16 거실 반자높이 2.1 m (IBC 2018 §1208.2 7 ft=2134 mm 대안).',
  };
}

/**
 * INTERIOR_CHECKS — registry of pure gate-material check functions, keyed by check id.
 * Batch 2's DomainModule wires these into the interior design driver.
 */
export const INTERIOR_CHECKS = {
  'egress-travel-distance': checkEgressTravelDistance,
  'egress-width': checkEgressWidth,
  'occupancy-load': checkOccupancyLoad,
  'corridor-clear-width': checkCorridorClearWidth,
  'plumbing-fixture-count': checkPlumbingFixtureCount,
  'ceiling-height': checkCeilingHeight,
} as const;

export type InteriorCheckId = keyof typeof INTERIOR_CHECKS;
