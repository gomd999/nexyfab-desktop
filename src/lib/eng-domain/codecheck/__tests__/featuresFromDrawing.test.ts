/**
 * codecheck/featuresFromDrawing.test.ts — the deterministic drawing→feature suggester.
 *
 * Proves the HONESTY contract:
 *  - unambiguous labelled dimensions WITH declared units auto-fill the right semantic slot (metres);
 *  - ambiguous / unlabelled values stay CANDIDATES (never auto-assigned → no false PASS/FAIL);
 *  - undeclared units → meters null AND no metre-based auto-fill (never guesses mm);
 *  - the seed path (no units field) never auto-fills; every value is a user-confirmed candidate.
 */
import { describe, it, expect } from 'vitest';
import { suggestFeaturesFromIr2d, suggestFeaturesFromSeed } from '../featuresFromDrawing';
import { runCodeCheck } from '../runCodeCheck';

describe('suggestFeaturesFromIr2d — auto-fill only unambiguous, unit-safe labels', () => {
  it('mm drawing with a labelled 주차 폭 dimension auto-fills parkingStallWidth_m in metres', () => {
    const s = suggestFeaturesFromIr2d({
      units: 'mm',
      extents: { w: 30000, h: 15000 },
      dimensions: [{ value: 2500, text: '주차 W=2500' }],
      circles: [],
    });
    expect(s.units).toBe('mm');
    expect(s.autoFilled.parkingStallWidth_m).toBe(2.5);
    // provenance records the backing token + value
    const prov = s.autoFilledProvenance.find((p) => p.key === 'parkingStallWidth_m');
    expect(prov).toBeTruthy();
    expect(prov!.value).toBe(2.5);
    expect(prov!.label).toBe('주차 W=2500');
    // the same value is still surfaced as an (editable) candidate marked auto-filled
    const cand = s.candidates.find((c) => c.label === '주차 W=2500');
    expect(cand?.autoFilled).toBe(true);
    expect(cand?.guessedKey).toBe('parkingStallWidth_m');
  });

  it('장애인 주차 폭 is auto-filled to the DISABLED slot, not the general one', () => {
    const s = suggestFeaturesFromIr2d({
      units: 'mm',
      dimensions: [{ value: 3300, text: '장애인주차구역 폭' }],
    });
    expect(s.autoFilled.parkingDisabledStallWidth_m).toBe(3.3);
    expect(s.autoFilled.parkingStallWidth_m).toBeUndefined();
  });

  it('extents are NEVER auto-filled — only surfaced as candidates (ambiguous: site vs building vs room)', () => {
    const s = suggestFeaturesFromIr2d({ units: 'mm', extents: { w: 30000, h: 15000 } });
    expect(Object.keys(s.autoFilled)).toHaveLength(0);
    const w = s.candidates.find((c) => c.label === 'extent.w');
    const h = s.candidates.find((c) => c.label === 'extent.h');
    expect(w?.source).toBe('extent');
    expect(w?.meters).toBe(30);
    expect(h?.meters).toBe(15);
    expect(w?.autoFilled).toBeUndefined();
  });

  it('an UNLABELLED dimension stays a bare candidate (no guessedKey, no auto-fill)', () => {
    const s = suggestFeaturesFromIr2d({ units: 'mm', dimensions: [{ value: 1200 }] });
    expect(Object.keys(s.autoFilled)).toHaveLength(0);
    const cand = s.candidates.find((c) => c.value === 1200 && c.source === 'dimension');
    expect(cand).toBeTruthy();
    expect(cand!.guessedKey).toBeUndefined();
    expect(cand!.meters).toBe(1.2); // metres computed (units known) but NOT assigned to a slot
  });

  it('category-only label (no width/length role) is a weak candidate suggestion, NOT an auto-fill', () => {
    const s = suggestFeaturesFromIr2d({ units: 'mm', dimensions: [{ value: 1500, text: '복도' }] });
    expect(Object.keys(s.autoFilled)).toHaveLength(0);
    const cand = s.candidates.find((c) => c.label === '복도');
    expect(cand?.guessedKey).toBe('corridorWidth_m'); // suggested for the user to confirm
    expect(cand?.autoFilled).toBeUndefined();
  });

  it('undeclared units → meters null AND no metre-based auto-fill even when the label is unambiguous', () => {
    const s = suggestFeaturesFromIr2d({
      units: null,
      dimensions: [{ value: 2500, text: '주차 폭' }],
    });
    expect(s.units).toBeNull();
    expect(Object.keys(s.autoFilled)).toHaveLength(0); // cannot assign a metre value we had to guess
    const cand = s.candidates.find((c) => c.label === '주차 폭');
    expect(cand?.meters).toBeNull();
    expect(cand?.unit).toBeNull();
    expect(cand?.guessedKey).toBe('parkingStallWidth_m'); // still suggested for manual confirm
    // an explanatory note is emitted about the withheld auto-fill
    expect(s.notes.some((n) => n.includes('단위 미선언'))).toBe(true);
  });

  it('inch drawing converts to metres for auto-fill (40 in door = 1.016 m)', () => {
    const s = suggestFeaturesFromIr2d({ units: 'in', dimensions: [{ value: 40, text: 'DOOR width' }] });
    // 40 in = 1.016 m
    expect(s.autoFilled.doorEffectiveWidth_m).toBe(1.016);
  });

  it('circles become diameter candidates (never a code-check slot — no matching rule)', () => {
    const s = suggestFeaturesFromIr2d({ units: 'mm', circles: [{ r: 250 }] });
    const cand = s.candidates.find((c) => c.source === 'circle');
    expect(cand?.value).toBe(500); // diameter
    expect(cand?.meters).toBe(0.5);
    expect(cand?.guessedKey).toBeUndefined();
    expect(Object.keys(s.autoFilled)).toHaveLength(0);
  });
});

describe('suggestFeaturesFromSeed — no units field → never auto-fills (honesty invariant)', () => {
  it('a labelled 주차 폭 dim in a seed stays a candidate (units undeclared → no metre auto-fill)', () => {
    const s = suggestFeaturesFromSeed({
      dims: [{ value: 2500, kind: 'linearH', text: '주차 W=2500' }],
      measurements: [2500, 5000],
      circles: [{ r: 250 }],
      extents: { w: 30000, h: 15000 },
    });
    expect(s.units).toBeNull();
    expect(Object.keys(s.autoFilled)).toHaveLength(0);
    const cand = s.candidates.find((c) => c.label === '주차 W=2500');
    expect(cand?.guessedKey).toBe('parkingStallWidth_m'); // suggestion only
    expect(cand?.meters).toBeNull();
  });

  it('measurements without matching dim text become unlabelled candidates (no double-count)', () => {
    const s = suggestFeaturesFromSeed({
      dims: [{ value: 2500, text: '주차 W' }],
      measurements: [2500, 5000], // 2500 already covered by the dim; 5000 is new
    });
    const labelled = s.candidates.filter((c) => c.value === 2500 && c.source === 'dimension');
    expect(labelled).toHaveLength(1); // not duplicated
    const bare = s.candidates.find((c) => c.value === 5000);
    expect(bare?.guessedKey).toBeUndefined();
  });
});

describe('featuresFromDrawing → runCodeCheck end-to-end (auto-fill feeds the 41-rule check)', () => {
  it('auto-filled features run through the deterministic rules (compliant width PASSes, narrow FAILs)', () => {
    const ok = suggestFeaturesFromIr2d({ units: 'mm', dimensions: [{ value: 3500, text: '장애인주차 폭' }] });
    const okReport = runCodeCheck(ok.autoFilled);
    const okWidth = okReport.results.find((r) => r.id === 'parking-disabled-stall-width');
    expect(okWidth?.status).toBe('pass');

    const bad = suggestFeaturesFromIr2d({ units: 'mm', dimensions: [{ value: 3000, text: '장애인주차 폭' }] });
    const badReport = runCodeCheck(bad.autoFilled);
    const badWidth = badReport.results.find((r) => r.id === 'parking-disabled-stall-width');
    expect(badWidth?.status).toBe('fail');
    expect(badWidth?.actual).toBe(3.0);
  });

  it('an empty drawing yields no auto-fill → every rule is NA (never a fabricated pass)', () => {
    const s = suggestFeaturesFromIr2d({ units: 'mm', dimensions: [], circles: [], extents: null });
    const report = runCodeCheck(s.autoFilled);
    expect(report.passCount).toBe(0);
    expect(report.failCount).toBe(0);
    expect(report.naCount).toBe(report.results.length);
  });
});
