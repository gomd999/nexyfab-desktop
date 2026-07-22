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
