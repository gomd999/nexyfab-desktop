/**
 * codecheck/rules.test.ts — the deterministic 코드체크 룰셋.
 *
 * Proves: compliant designs PASS, non-compliant FAIL with exact actual-vs-required,
 * absent features → NA (never assumed compliant), and every rule's cited clause is
 * present in its result (traceability — no rule without a source).
 */
import { describe, it, expect } from 'vitest';
import {
  CODECHECK_RULES,
  CODECHECK_RULES_BY_ID,
  CODECHECK_DISCLAIMER,
  sanitizeCodeCheckFeatures,
  type CodeCheckFeatures,
} from '../rules';
import { runCodeCheck, collectMeasurementsFromIr2d } from '../runCodeCheck';

const byId = (features: CodeCheckFeatures, id: string) => CODECHECK_RULES_BY_ID[id].check(features);

describe('codecheck rules — parking (장애인전용 주차구역)', () => {
  it('compliant stall 3.5×5.0 passes width & length', () => {
    const f: CodeCheckFeatures = { parkingDisabledStallWidth_m: 3.5, parkingDisabledStallLength_m: 5.0 };
    const w = byId(f, 'parking-disabled-stall-width');
    const l = byId(f, 'parking-disabled-stall-length');
    expect(w.status).toBe('pass');
    expect(w.actual).toBe(3.5);
    expect(l.status).toBe('pass');
  });

  it('exactly-at-limit 3.3×5.0 passes (≥ boundary inclusive)', () => {
    expect(byId({ parkingDisabledStallWidth_m: 3.3 }, 'parking-disabled-stall-width').status).toBe('pass');
    expect(byId({ parkingDisabledStallLength_m: 5.0 }, 'parking-disabled-stall-length').status).toBe('pass');
  });

  it('narrow stall 3.0×5.0 FAILS width, citing the parking clause with actual 3.0 vs required 3.3', () => {
    const r = byId({ parkingDisabledStallWidth_m: 3.0 }, 'parking-disabled-stall-width');
    expect(r.status).toBe('fail');
    expect(r.actual).toBe(3.0);
    expect(r.required).toContain('3.3');
    expect(r.message).toContain('3.3');
    expect(r.message).toContain('3'); // actual present
    expect(r.clause).toContain('장애인');
    expect(r.source).toContain('law.go.kr');
  });

  it('floor slope 1/50 passes, 1/30 fails', () => {
    expect(byId({ parkingDisabledStallSlope: 1 / 50 }, 'parking-disabled-stall-slope').status).toBe('pass');
    const r = byId({ parkingDisabledStallSlope: 1 / 30 }, 'parking-disabled-stall-slope');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('1:50');
  });
});

describe('codecheck rules — ramp (경사로)', () => {
  it('ramp at 1:12 passes, ramp at 1:10 FAILS the 1:12 rule', () => {
    expect(byId({ rampSlope: 1 / 12 }, 'ramp-slope').status).toBe('pass');
    const r = byId({ rampSlope: 1 / 10 }, 'ramp-slope');
    expect(r.status).toBe('fail');
    expect(r.required).toContain('1:12');
    expect(r.message).toContain('1:10'); // actual slope reported
  });

  it('effective width 1.2 passes, 1.0 fails', () => {
    expect(byId({ rampEffectiveWidth_m: 1.2 }, 'ramp-effective-width').status).toBe('pass');
    expect(byId({ rampEffectiveWidth_m: 1.0 }, 'ramp-effective-width').status).toBe('fail');
  });

  it('side slope 1:10 passes, 1:8 fails', () => {
    expect(byId({ rampSideSlope: 1 / 10 }, 'ramp-side-slope').status).toBe('pass');
    expect(byId({ rampSideSlope: 1 / 8 }, 'ramp-side-slope').status).toBe('fail');
  });
});

describe('codecheck rules — parking entry ramp (주차장법)', () => {
  it('straight 17% passes, 20% fails; curved 14% passes, 16% fails', () => {
    expect(byId({ parkingRampSlopeStraight: 0.17 }, 'parking-ramp-slope-straight').status).toBe('pass');
    const s = byId({ parkingRampSlopeStraight: 0.2 }, 'parking-ramp-slope-straight');
    expect(s.status).toBe('fail');
    expect(s.source).toContain('주차장법');
    expect(byId({ parkingRampSlopeCurved: 0.14 }, 'parking-ramp-slope-curved').status).toBe('pass');
    expect(byId({ parkingRampSlopeCurved: 0.16 }, 'parking-ramp-slope-curved').status).toBe('fail');
  });
});

describe('codecheck rules — stairs (제15조, 용도별)', () => {
  it('elementary: width 1.5 pass, riser 0.16 pass / 0.18 fail, tread 0.26 pass', () => {
    const cat = 'elementary' as const;
    expect(byId({ stairCategory: cat, stairEffectiveWidth_m: 1.5 }, 'stair-effective-width').status).toBe('pass');
    expect(byId({ stairCategory: cat, stairRiser_m: 0.16 }, 'stair-riser-height').status).toBe('pass');
    const bad = byId({ stairCategory: cat, stairRiser_m: 0.18 }, 'stair-riser-height');
    expect(bad.status).toBe('fail');
    expect(bad.required).toContain('0.16');
    expect(byId({ stairCategory: cat, stairTread_m: 0.26 }, 'stair-tread-depth').status).toBe('pass');
  });

  it('secondary riser limit 0.18 (0.18 pass, 0.19 fail)', () => {
    expect(byId({ stairCategory: 'secondary', stairRiser_m: 0.18 }, 'stair-riser-height').status).toBe('pass');
    expect(byId({ stairCategory: 'secondary', stairRiser_m: 0.19 }, 'stair-riser-height').status).toBe('fail');
  });

  it('other/assembly: no statutory riser/tread limit → NA even when a value is provided', () => {
    const riser = byId({ stairCategory: 'other', stairRiser_m: 0.25 }, 'stair-riser-height');
    expect(riser.status).toBe('na');
    expect(riser.message).toContain('고정 상한');
    const tread = byId({ stairCategory: 'assembly', stairTread_m: 0.1 }, 'stair-tread-depth');
    expect(tread.status).toBe('na');
  });

  it('other stair width min 0.6 (0.6 pass, 0.5 fail); assembly min 1.2', () => {
    expect(byId({ stairCategory: 'other', stairEffectiveWidth_m: 0.6 }, 'stair-effective-width').status).toBe('pass');
    expect(byId({ stairCategory: 'other', stairEffectiveWidth_m: 0.5 }, 'stair-effective-width').status).toBe('fail');
    expect(byId({ stairCategory: 'assembly', stairEffectiveWidth_m: 1.2 }, 'stair-effective-width').status).toBe('pass');
    expect(byId({ stairCategory: 'assembly', stairEffectiveWidth_m: 1.1 }, 'stair-effective-width').status).toBe('fail');
  });
});

describe('codecheck rules — railing / corridor / door / toilet / curb', () => {
  it('railing 1.2 passes, 1.0 fails, cites 건축법 시행령 제40조', () => {
    expect(byId({ railingHeight_m: 1.2 }, 'railing-height').status).toBe('pass');
    const r = byId({ railingHeight_m: 1.0 }, 'railing-height');
    expect(r.status).toBe('fail');
    expect(r.clause).toContain('제40조');
  });

  it('corridor: school both-sides 2.4 pass / 2.0 fail; residential single-side min 1.2', () => {
    expect(
      byId({ corridorCategory: 'school', corridorBothSidesRooms: true, corridorWidth_m: 2.4 }, 'corridor-effective-width').status,
    ).toBe('pass');
    expect(
      byId({ corridorCategory: 'school', corridorBothSidesRooms: true, corridorWidth_m: 2.0 }, 'corridor-effective-width').status,
    ).toBe('fail');
    expect(
      byId({ corridorCategory: 'residential', corridorBothSidesRooms: false, corridorWidth_m: 1.2 }, 'corridor-effective-width').status,
    ).toBe('pass');
  });

  it('door 0.8 pass / 0.7 fail; toilet width 1.4 & depth 1.8 pass, 1.3/1.6 fail', () => {
    expect(byId({ doorEffectiveWidth_m: 0.8 }, 'door-effective-width').status).toBe('pass');
    expect(byId({ doorEffectiveWidth_m: 0.7 }, 'door-effective-width').status).toBe('fail');
    expect(byId({ disabledToiletActivityWidth_m: 1.4 }, 'disabled-toilet-activity-width').status).toBe('pass');
    expect(byId({ disabledToiletActivityWidth_m: 1.3 }, 'disabled-toilet-activity-width').status).toBe('fail');
    expect(byId({ disabledToiletActivityDepth_m: 1.8 }, 'disabled-toilet-activity-depth').status).toBe('pass');
    expect(byId({ disabledToiletActivityDepth_m: 1.6 }, 'disabled-toilet-activity-depth').status).toBe('fail');
  });

  it('curb boundary height in 0.10~0.15 passes; 0.20 fails (range)', () => {
    expect(byId({ curbBoundaryHeight_m: 0.12 }, 'curb-boundary-height').status).toBe('pass');
    expect(byId({ curbBoundaryHeight_m: 0.1 }, 'curb-boundary-height').status).toBe('pass');
    expect(byId({ curbBoundaryHeight_m: 0.15 }, 'curb-boundary-height').status).toBe('pass');
    expect(byId({ curbBoundaryHeight_m: 0.2 }, 'curb-boundary-height').status).toBe('fail');
    expect(byId({ curbBoundaryHeight_m: 0.05 }, 'curb-boundary-height').status).toBe('fail');
  });
});

describe('codecheck rules — parking stall & entry ramp (주차장법 제3조·제6조)', () => {
  it('general stall 2.5×5.0 pass; 2.4 width / 4.9 length FAIL citing 제3조', () => {
    expect(byId({ parkingStallType: 'general', parkingStallWidth_m: 2.5 }, 'parking-stall-width').status).toBe('pass');
    const w = byId({ parkingStallType: 'general', parkingStallWidth_m: 2.4 }, 'parking-stall-width');
    expect(w.status).toBe('fail');
    expect(w.actual).toBe(2.4);
    expect(w.required).toContain('2.5');
    expect(w.clause).toContain('제3조');
    expect(w.source).toContain('law.go.kr');
    expect(byId({ parkingStallType: 'general', parkingStallLength_m: 4.9 }, 'parking-stall-length').status).toBe('fail');
  });

  it('expanded 2.6×5.2 & compact 2.0×3.6 boundaries', () => {
    expect(byId({ parkingStallType: 'expanded', parkingStallWidth_m: 2.6 }, 'parking-stall-width').status).toBe('pass');
    expect(byId({ parkingStallType: 'expanded', parkingStallLength_m: 5.1 }, 'parking-stall-length').status).toBe('fail');
    expect(byId({ parkingStallType: 'compact', parkingStallWidth_m: 2.0 }, 'parking-stall-width').status).toBe('pass');
    expect(byId({ parkingStallType: 'compact', parkingStallLength_m: 3.5 }, 'parking-stall-length').status).toBe('fail');
  });

  it('entry ramp lane: straight 1-way 3.3 pass / 3.2 fail; curved 2-way 6.5 pass / 6.4 fail', () => {
    expect(byId({ parkingRampLaneWidth_m: 3.3 }, 'parking-ramp-lane-width').status).toBe('pass');
    expect(byId({ parkingRampLaneWidth_m: 3.2 }, 'parking-ramp-lane-width').status).toBe('fail');
    expect(byId({ parkingRampLaneWidth_m: 6.0, parkingRampTwoWay: true }, 'parking-ramp-lane-width').status).toBe('pass');
    expect(byId({ parkingRampLaneWidth_m: 3.6, parkingRampLaneCurved: true }, 'parking-ramp-lane-width').status).toBe('pass');
    const r = byId({ parkingRampLaneWidth_m: 6.4, parkingRampLaneCurved: true, parkingRampTwoWay: true }, 'parking-ramp-lane-width');
    expect(r.status).toBe('fail');
    expect(r.required).toContain('6.5');
  });

  it('missing stall feature → NA', () => {
    expect(byId({ parkingStallType: 'general' }, 'parking-stall-width').status).toBe('na');
  });
});

describe('codecheck rules — egress/fire (피난·방화)', () => {
  it('stair landing interval ≤3.0 (3.0 pass, 3.2 fail) & width ≥1.2 (1.2 pass, 1.1 fail)', () => {
    expect(byId({ stairLandingRiseInterval_m: 3.0 }, 'stair-landing-rise-interval').status).toBe('pass');
    const i = byId({ stairLandingRiseInterval_m: 3.2 }, 'stair-landing-rise-interval');
    expect(i.status).toBe('fail');
    expect(i.clause).toContain('제15조');
    expect(byId({ stairLandingWidth_m: 1.2 }, 'stair-landing-width').status).toBe('pass');
    expect(byId({ stairLandingWidth_m: 1.1 }, 'stair-landing-width').status).toBe('fail');
  });

  it('outdoor escape stair width 0.9 pass / 0.8 fail (제9조)', () => {
    expect(byId({ outdoorEscapeStairWidth_m: 0.9 }, 'outdoor-escape-stair-width').status).toBe('pass');
    const r = byId({ outdoorEscapeStairWidth_m: 0.8 }, 'outdoor-escape-stair-width');
    expect(r.status).toBe('fail');
    expect(r.clause).toContain('제9조');
  });

  it('travel distance: general ≤30 (30 pass, 35 fail); fire-resistant ≤50 (45 pass) citing 제34조', () => {
    expect(byId({ travelDistanceToStair_m: 30 }, 'travel-distance-to-stair').status).toBe('pass');
    const bad = byId({ travelDistanceToStair_m: 35 }, 'travel-distance-to-stair');
    expect(bad.status).toBe('fail');
    expect(bad.actual).toBe(35);
    expect(bad.required).toContain('30');
    expect(bad.clause).toContain('제34조');
    expect(byId({ travelDistanceToStair_m: 45, mainStructureFireResistant: true }, 'travel-distance-to-stair').status).toBe('pass');
    expect(byId({ travelDistanceToStair_m: 55, mainStructureFireResistant: true }, 'travel-distance-to-stair').status).toBe('fail');
  });

  it('fire compartment: 10층↓ ≤1000 (900 pass, 1200 fail); sprinkler ≤3000; 11층↑ ≤200', () => {
    expect(byId({ fireCompartmentArea_m2: 900 }, 'fire-compartment-area').status).toBe('pass');
    const bad = byId({ fireCompartmentArea_m2: 1200 }, 'fire-compartment-area');
    expect(bad.status).toBe('fail');
    expect(bad.required).toContain('1000');
    expect(byId({ fireCompartmentArea_m2: 2500, fireCompartmentSprinklered: true }, 'fire-compartment-area').status).toBe('pass');
    expect(byId({ fireCompartmentArea_m2: 250, fireCompartmentFloorAbove11: true }, 'fire-compartment-area').status).toBe('fail');
    expect(byId({ fireCompartmentArea_m2: 550, fireCompartmentFloorAbove11: true, fireCompartmentSprinklered: true }, 'fire-compartment-area').status).toBe('pass');
  });

  it('indoor hydrant horizontal distance 25 pass / 30 fail (NFTC 102)', () => {
    expect(byId({ hydrantHorizontalDistance_m: 25 }, 'indoor-hydrant-distance').status).toBe('pass');
    const r = byId({ hydrantHorizontalDistance_m: 30 }, 'indoor-hydrant-distance');
    expect(r.status).toBe('fail');
    expect(r.source).toContain('NFTC 102');
  });
});

describe('codecheck rules — building (반자·채광·환기·건폐율·용적률)', () => {
  it('ceiling height 2.1 pass / 2.0 fail (제16조)', () => {
    expect(byId({ ceilingHeight_m: 2.1 }, 'ceiling-height').status).toBe('pass');
    const r = byId({ ceilingHeight_m: 2.0 }, 'ceiling-height');
    expect(r.status).toBe('fail');
    expect(r.clause).toContain('제16조');
  });

  it('daylight window ratio ≥1/10 (0.1 pass, 0.08 fail) & ventilation ≥1/20 (0.05 pass, 0.04 fail)', () => {
    expect(byId({ roomFloorArea_m2: 100, daylightWindowArea_m2: 10 }, 'daylight-window-ratio').status).toBe('pass');
    const d = byId({ roomFloorArea_m2: 100, daylightWindowArea_m2: 8 }, 'daylight-window-ratio');
    expect(d.status).toBe('fail');
    expect(d.message).toContain('10.0%'); // required ratio surfaced
    expect(byId({ roomFloorArea_m2: 100, ventilationWindowArea_m2: 5 }, 'ventilation-window-ratio').status).toBe('pass');
    expect(byId({ roomFloorArea_m2: 100, ventilationWindowArea_m2: 4 }, 'ventilation-window-ratio').status).toBe('fail');
  });

  it('daylight ratio missing either area → NA (never assumes compliance)', () => {
    expect(byId({ daylightWindowArea_m2: 10 }, 'daylight-window-ratio').status).toBe('na');
    expect(byId({ roomFloorArea_m2: 100 }, 'daylight-window-ratio').status).toBe('na');
  });

  it('coverage ratio ≤ limit (50% under 60 pass, 70% over 60 fail) citing 제55조', () => {
    const ok = byId({ buildingArea_m2: 300, siteArea_m2: 600, coverageRatioLimit_pct: 60 }, 'building-coverage-ratio');
    expect(ok.status).toBe('pass');
    expect(ok.actual).toBe(50);
    const bad = byId({ buildingArea_m2: 420, siteArea_m2: 600, coverageRatioLimit_pct: 60 }, 'building-coverage-ratio');
    expect(bad.status).toBe('fail');
    expect(bad.actual).toBe(70);
    expect(bad.clause).toContain('제55조');
  });

  it('floor area ratio ≤ limit (200% under 250 pass, 300% over 250 fail) citing 제56조', () => {
    expect(byId({ totalFloorArea_m2: 1200, siteArea_m2: 600, floorAreaRatioLimit_pct: 250 }, 'floor-area-ratio').status).toBe('pass');
    const bad = byId({ totalFloorArea_m2: 1800, siteArea_m2: 600, floorAreaRatioLimit_pct: 250 }, 'floor-area-ratio');
    expect(bad.status).toBe('fail');
    expect(bad.actual).toBe(300);
    expect(bad.clause).toContain('제56조');
  });

  it('coverage/FAR missing limit or area → NA', () => {
    expect(byId({ buildingArea_m2: 300, siteArea_m2: 600 }, 'building-coverage-ratio').status).toBe('na');
    expect(byId({ totalFloorArea_m2: 1200, floorAreaRatioLimit_pct: 250 }, 'floor-area-ratio').status).toBe('na');
  });
});

describe('codecheck rules — accessibility 별표1 extras (접근로·경사로·승강기)', () => {
  it('approach path width 1.2 pass / 1.1 fail; slope 1/18 pass / 1/12 fail', () => {
    expect(byId({ approachPathWidth_m: 1.2 }, 'approach-path-width').status).toBe('pass');
    expect(byId({ approachPathWidth_m: 1.1 }, 'approach-path-width').status).toBe('fail');
    expect(byId({ approachPathSlope: 1 / 18 }, 'approach-path-slope').status).toBe('pass');
    const s = byId({ approachPathSlope: 1 / 12 }, 'approach-path-slope');
    expect(s.status).toBe('fail');
    expect(s.required).toContain('1:18');
  });

  it('ramp landing interval ≤0.75 (0.75 pass, 0.9 fail); handrail 0.8~0.9 (0.85 pass, 0.95 fail)', () => {
    expect(byId({ rampLandingRiseInterval_m: 0.75 }, 'ramp-landing-rise-interval').status).toBe('pass');
    expect(byId({ rampLandingRiseInterval_m: 0.9 }, 'ramp-landing-rise-interval').status).toBe('fail');
    expect(byId({ handrailHeight_m: 0.85 }, 'handrail-height').status).toBe('pass');
    expect(byId({ handrailHeight_m: 0.8 }, 'handrail-height').status).toBe('pass');
    expect(byId({ handrailHeight_m: 0.95 }, 'handrail-height').status).toBe('fail');
    expect(byId({ handrailHeight_m: 0.7 }, 'handrail-height').status).toBe('fail');
  });

  it('elevator internal width 1.1 / depth 1.35 / door 0.8 boundaries, cite 별표1', () => {
    expect(byId({ elevatorInternalWidth_m: 1.1 }, 'elevator-internal-width').status).toBe('pass');
    expect(byId({ elevatorInternalWidth_m: 1.0 }, 'elevator-internal-width').status).toBe('fail');
    expect(byId({ elevatorInternalDepth_m: 1.35 }, 'elevator-internal-depth').status).toBe('pass');
    expect(byId({ elevatorInternalDepth_m: 1.3 }, 'elevator-internal-depth').status).toBe('fail');
    const d = byId({ elevatorDoorWidth_m: 0.7 }, 'elevator-door-width');
    expect(d.status).toBe('fail');
    expect(d.clause).toContain('[별표1]');
  });
});

describe('codecheck rules — interior 다중이용업소 비상구 (별표2)', () => {
  it('exit width 0.75 pass / 0.7 fail; height 1.5 pass / 1.4 fail; count ≥1', () => {
    expect(byId({ emergencyExitWidth_m: 0.75 }, 'emergency-exit-width').status).toBe('pass');
    const w = byId({ emergencyExitWidth_m: 0.7 }, 'emergency-exit-width');
    expect(w.status).toBe('fail');
    expect(w.clause).toContain('다중이용업소');
    expect(w.required).toContain('0.75');
    expect(byId({ emergencyExitHeight_m: 1.5 }, 'emergency-exit-height').status).toBe('pass');
    expect(byId({ emergencyExitHeight_m: 1.4 }, 'emergency-exit-height').status).toBe('fail');
    expect(byId({ emergencyExitCount: 1 }, 'emergency-exit-count').status).toBe('pass');
    expect(byId({ emergencyExitCount: 0 }, 'emergency-exit-count').status).toBe('fail');
  });
});

describe('codecheck — honesty & traceability contract', () => {
  it('missing feature → NA for every rule (empty features)', () => {
    for (const rule of CODECHECK_RULES) {
      const r = rule.check({});
      expect(r.status).toBe('na');
      expect(r.actual).toBeUndefined();
    }
  });

  it('every rule cites a clause + a law.go.kr / 공표기관 source (no rule without provenance)', () => {
    for (const rule of CODECHECK_RULES) {
      expect(rule.clause.length).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(0);
      expect(rule.requirement.length).toBeGreaterThan(0);
      // result must carry the same clause + source (traceability)
      const res = rule.check({});
      expect(res.clause).toBe(rule.clause);
      expect(res.source).toBe(rule.source);
    }
  });

  it('cited-clause strings are the real 법령 names (spot-check traceability)', () => {
    const clauses = CODECHECK_RULES.map((r) => r.clause).join(' | ');
    expect(clauses).toContain('장애인·노인·임산부등편의증진보장법 시행규칙 [별표1]');
    expect(clauses).toContain('주차장법 시행규칙 제6조');
    expect(clauses).toContain('건축물의 피난·방화구조 등의 기준에 관한 규칙 제15조');
    expect(clauses).toContain('제15조의2');
    expect(clauses).toContain('건축법 시행령 제40조');
    // newly added rule sets — every threshold traces to a cited public clause
    expect(clauses).toContain('주차장법 시행규칙 제3조');
    expect(clauses).toContain('주차장법 시행규칙 제6조 제1항 제5호');
    expect(clauses).toContain('건축법 시행령 제34조');
    expect(clauses).toContain('건축법 시행령 제46조');
    expect(clauses).toContain('제16조');
    expect(clauses).toContain('제17조');
    expect(clauses).toContain('건축법 제55조');
    expect(clauses).toContain('건축법 제56조');
    expect(clauses).toContain('NFTC 102');
    expect(clauses).toContain('다중이용업소의 안전관리에 관한 특별법 시행규칙 [별표2]');
  });

  it('newly added rules also carry a law.go.kr / 공표기관 source (provenance)', () => {
    const NEW_IDS = [
      'parking-stall-width', 'parking-stall-length', 'parking-ramp-lane-width',
      'stair-landing-rise-interval', 'stair-landing-width', 'outdoor-escape-stair-width',
      'travel-distance-to-stair', 'fire-compartment-area', 'indoor-hydrant-distance',
      'ceiling-height', 'daylight-window-ratio', 'ventilation-window-ratio',
      'building-coverage-ratio', 'floor-area-ratio', 'approach-path-width', 'approach-path-slope',
      'ramp-landing-rise-interval', 'handrail-height', 'elevator-internal-width',
      'elevator-internal-depth', 'elevator-door-width', 'emergency-exit-width',
      'emergency-exit-height', 'emergency-exit-count',
    ];
    for (const id of NEW_IDS) {
      const rule = CODECHECK_RULES_BY_ID[id];
      expect(rule, `rule ${id} must exist`).toBeTruthy();
      expect(rule.clause.length).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(0);
      // missing feature → NA (never assumed compliant)
      const res = rule.check({});
      expect(res.status).toBe('na');
      expect(res.clause).toBe(rule.clause);
      expect(res.source).toBe(rule.source);
    }
  });
});

describe('runCodeCheck — aggregate report', () => {
  it('tallies pass/fail/na and collects violations, always with the non-statutory disclaimer', () => {
    const report = runCodeCheck({
      parkingDisabledStallWidth_m: 3.0, // FAIL
      parkingDisabledStallLength_m: 5.0, // PASS
      railingHeight_m: 1.2, // PASS
      // everything else absent → NA
    });
    expect(report.failCount).toBe(1);
    expect(report.passCount).toBe(2);
    expect(report.naCount).toBe(CODECHECK_RULES.length - 3);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].id).toBe('parking-disabled-stall-width');
    expect(report.results).toHaveLength(CODECHECK_RULES.length);
    expect(report.disclaimer).toBe(CODECHECK_DISCLAIMER);
    expect(report.disclaimer).toContain('비법정');
  });

  it('all-absent features → 0 pass / 0 fail / all NA', () => {
    const report = runCodeCheck({});
    expect(report.passCount).toBe(0);
    expect(report.failCount).toBe(0);
    expect(report.naCount).toBe(CODECHECK_RULES.length);
    expect(report.violations).toHaveLength(0);
  });
});

describe('collectMeasurementsFromIr2d — reuse of DWG-2D IR measurements', () => {
  it('converts mm dims/extents/circles to metres and never auto-assigns a semantic slot', () => {
    const pool = collectMeasurementsFromIr2d({
      units: 'mm',
      extents: { w: 3300, h: 5000 },
      dimensions: [{ value: 1200, text: 'RAMP W' }],
      circles: [{ r: 500 }],
    });
    const meters = pool.map((p) => p.meters);
    expect(meters).toContain(3.3);
    expect(meters).toContain(5.0);
    expect(meters).toContain(1.2);
    expect(meters).toContain(1.0); // circle diameter 1000mm
  });

  it('undeclared units → meters null (never guesses mm)', () => {
    const pool = collectMeasurementsFromIr2d({ units: null, extents: { w: 3300, h: 5000 } });
    expect(pool.every((p) => p.meters === null)).toBe(true);
    expect(pool[0].rawUnit).toBe('unknown');
  });
});

describe('sanitizeCodeCheckFeatures — garbage input never fabricates a FAIL', () => {
  it('a non-numeric string on a numeric field is DROPPED → rule reads NA, not NaN-FAIL', () => {
    const clean = sanitizeCodeCheckFeatures({ ceilingHeight_m: 'abc' });
    expect('ceilingHeight_m' in clean).toBe(false);
    const rep = runCodeCheck(clean);
    const ceil = rep.results.find((r) => r.id === 'ceiling-height');
    expect(ceil?.status).toBe('na');
    // and it must NOT appear as a violation
    expect(rep.violations.some((v) => v.id === 'ceiling-height')).toBe(false);
  });

  it('a numeric-looking string is coerced to a number', () => {
    const clean = sanitizeCodeCheckFeatures({ ceilingHeight_m: '2.4' });
    expect(clean.ceilingHeight_m).toBe(2.4);
  });

  it('a valid enum string passes through; a bogus enum string still passes (rule validates it)', () => {
    const clean = sanitizeCodeCheckFeatures({ stairCategory: 'elementary', corridorCategory: 'school' });
    expect(clean.stairCategory).toBe('elementary');
    expect(clean.corridorCategory).toBe('school');
  });

  it('drops non-finite numbers (NaN/Infinity) and keeps finite ones + booleans', () => {
    const clean = sanitizeCodeCheckFeatures({
      railingHeight_m: Number.NaN,
      corridorWidth_m: 1.5,
      corridorBothSidesRooms: true,
    }) as Record<string, unknown>;
    expect('railingHeight_m' in clean).toBe(false);
    expect(clean.corridorWidth_m).toBe(1.5);
    expect(clean.corridorBothSidesRooms).toBe(true);
  });
});

describe('sanitizeCodeCheckFeatures — implausible _m values never fabricate a PASS', () => {
  it('an mm value typed into an _m field (1200 = a 1200-metre-wide ramp) is dropped -> NA', () => {
    const clean = sanitizeCodeCheckFeatures({ rampEffectiveWidth_m: 1200 });
    expect('rampEffectiveWidth_m' in clean).toBe(false);
    const rep = runCodeCheck(clean);
    const r = rep.results.find((x) => x.id === 'ramp-effective-width');
    expect(r?.status).toBe('na');
    expect(rep.violations.some((v) => v.id === 'ramp-effective-width')).toBe(false);
  });

  it('the same mm/m typo via a numeric STRING is also dropped', () => {
    const clean = sanitizeCodeCheckFeatures({ corridorWidth_m: '1500' });
    expect('corridorWidth_m' in clean).toBe(false);
  });

  it('an implausible height (15m railing) is dropped, a normal one (1.2m) is not', () => {
    expect('railingHeight_m' in sanitizeCodeCheckFeatures({ railingHeight_m: 15 })).toBe(false);
    expect(sanitizeCodeCheckFeatures({ railingHeight_m: 1.2 }).railingHeight_m).toBe(1.2);
  });

  it('legitimately long code-permitted distances (75m travel distance) still pass', () => {
    expect(sanitizeCodeCheckFeatures({ travelDistanceToStair_m: 75 }).travelDistanceToStair_m).toBe(75);
  });

  it('area fields (_m2) have no length ceiling — a large legitimate floor area passes', () => {
    expect(sanitizeCodeCheckFeatures({ totalFloorArea_m2: 50000 }).totalFloorArea_m2).toBe(50000);
  });

  it('ordinary in-range widths/lengths across categories all pass unaffected', () => {
    const clean = sanitizeCodeCheckFeatures({
      parkingDisabledStallWidth_m: 3.5,
      doorEffectiveWidth_m: 0.9,
      stairEffectiveWidth_m: 1.5,
      elevatorInternalWidth_m: 1.1,
    }) as Record<string, unknown>;
    expect(clean.parkingDisabledStallWidth_m).toBe(3.5);
    expect(clean.doorEffectiveWidth_m).toBe(0.9);
    expect(clean.stairEffectiveWidth_m).toBe(1.5);
    expect(clean.elevatorInternalWidth_m).toBe(1.1);
  });
});
