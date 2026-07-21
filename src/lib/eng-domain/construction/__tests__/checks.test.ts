import { describe, it, expect } from 'vitest';
import {
  checkConcreteVolumeTakeoff,
  concreteVolume_m3,
  checkRebarWeightTakeoff,
  rebarWeight_kg,
  barUnitMass_kgpm,
  STANDARD_BAR_UNIT_MASS_KGPM,
  checkFormworkAreaTakeoff,
  formworkAreaOfElement,
  checkScheduleFeasibility,
  scheduleForwardPass,
  checkCostRollup,
  checkEarthworkCutFillBalance,
  CONSTRUCTION_CHECKS,
} from '../checks';

describe('construction gate-material — contract', () => {
  it('registry has 6 checks and every result carries a basis + reason-iff-fail', () => {
    const results = [
      checkConcreteVolumeTakeoff({ elements: [{ b_m: 0.3, h_m: 0.6, L_m: 6 }], claimedVolume_m3: 1.08 }),
      checkRebarWeightTakeoff({ groups: [{ nominalDia_mm: 16, length_m: 10, count: 1 }], claimedWeight_kg: 15.783 }),
      checkFormworkAreaTakeoff({ elements: [{ type: 'beam', b_m: 0.3, h_m: 0.6, L_m: 6 }], claimedArea_m2: 9.0 }),
      checkScheduleFeasibility({ activities: [{ id: 'A', duration_days: 5 }] }),
      checkCostRollup({ lineItems: [{ quantity: 10, unitRate: 100 }], budget: 2000 }),
      checkEarthworkCutFillBalance({ cutBank_m3: 100, fillCompacted_m3: 90 }),
    ];
    for (const r of results) {
      expect(r.basis).toBeTruthy();
      expect(typeof r.basis).toBe('string');
      if (r.pass) expect(r.reason).toBeUndefined();
      else expect(r.reason).toBeTruthy();
    }
    expect(Object.keys(CONSTRUCTION_CHECKS)).toHaveLength(6);
  });

  it('bad params throw (caller bug), distinct from pass:false verdict', () => {
    expect(() => concreteVolume_m3([{ b_m: -1, h_m: 0.6, L_m: 6 }])).toThrow();
    expect(() => concreteVolume_m3([])).toThrow();
    expect(() => barUnitMass_kgpm(0)).toThrow();
    // unknown predecessor reference is a caller bug → throw
    expect(() =>
      scheduleForwardPass([{ id: 'A', duration_days: 1, predecessors: ['ghost'] }]),
    ).toThrow();
  });
});

describe('1) concrete volume takeoff (Σ b·h·L)', () => {
  // HAND-CALC: a beam 0.3 × 0.6 × 6 m = 1.08 m³
  it('hand-calc cross-check: 0.3×0.6×6 = 1.08 m³', () => {
    expect(concreteVolume_m3([{ b_m: 0.3, h_m: 0.6, L_m: 6 }])).toBeCloseTo(1.08, 10);
  });
  it('PASS: computed 1.08 within tolerance of claimed 1.08', () => {
    const r = checkConcreteVolumeTakeoff({ elements: [{ b_m: 0.3, h_m: 0.6, L_m: 6 }], claimedVolume_m3: 1.08 });
    expect(r.pass).toBe(true);
    expect(r.metrics.computedVolume_m3).toBeCloseTo(1.08, 6);
  });
  it('FAIL: claimed 1.5 differs from computed 1.08 beyond tolerance', () => {
    const r = checkConcreteVolumeTakeoff({ elements: [{ b_m: 0.3, h_m: 0.6, L_m: 6 }], claimedVolume_m3: 1.5 });
    expect(r.pass).toBe(false);
    expect(r.metrics.differenceVolume_m3).toBeCloseTo(0.42, 6);
    expect(r.reason).toBeTruthy();
  });
  it('WASTE MODE PASS/FAIL: required = computed·(1+waste)', () => {
    // 2 elements × 1.08 = 2.16 m³; +5% waste → 2.268 required
    const els = [{ count: 2, b_m: 0.3, h_m: 0.6, L_m: 6 }];
    const ok = checkConcreteVolumeTakeoff({ elements: els, claimedVolume_m3: 2.3, wasteFactor: 0.05 });
    expect(ok.pass).toBe(true);
    expect(ok.metrics.requiredVolume_m3).toBeCloseTo(2.268, 6);
    const bad = checkConcreteVolumeTakeoff({ elements: els, claimedVolume_m3: 2.2, wasteFactor: 0.05 });
    expect(bad.pass).toBe(false);
    expect(bad.reason).toBeTruthy();
  });
});

describe('2) rebar weight takeoff (ρ·A unit mass)', () => {
  // HAND-CALC: D16 unit mass = 7850 · (π/4)·0.016² = 1.5783 kg/m
  it('hand-calc cross-check: D16 = 1.578 kg/m', () => {
    expect(barUnitMass_kgpm(16)).toBeCloseTo(1.5783, 3);
    expect(STANDARD_BAR_UNIT_MASS_KGPM[16]).toBeCloseTo(1.5783, 3);
    expect(barUnitMass_kgpm(25)).toBeCloseTo(3.8534, 3);
  });
  it('PASS: 10 m of D16 ≈ 15.783 kg reconciles with claimed 15.78', () => {
    // 1 bar × 10 m × 1.5783 = 15.783 kg
    expect(rebarWeight_kg([{ nominalDia_mm: 16, length_m: 10 }])).toBeCloseTo(15.783, 3);
    const r = checkRebarWeightTakeoff({
      groups: [{ nominalDia_mm: 16, length_m: 10 }],
      claimedWeight_kg: 15.78,
      toleranceKg: 0.5,
    });
    expect(r.pass).toBe(true);
  });
  it('FAIL: claimed 20 kg far from computed 15.783 kg', () => {
    const r = checkRebarWeightTakeoff({
      groups: [{ nominalDia_mm: 16, length_m: 10 }],
      claimedWeight_kg: 20,
      toleranceKg: 0.5,
    });
    expect(r.pass).toBe(false);
    expect(r.metrics.computedWeight_kg).toBeCloseTo(15.783, 2);
    expect(r.reason).toBeTruthy();
  });
});

describe('3) formwork area takeoff (contact surface)', () => {
  // HAND-CALC: beam 0.3×0.6×6 → (2·0.6 + 0.3)·6 = 1.5·6 = 9.0 m²
  it('hand-calc cross-check: beam (2h+b)·L = 9.0 m²', () => {
    expect(formworkAreaOfElement({ type: 'beam', b_m: 0.3, h_m: 0.6, L_m: 6 })).toBeCloseTo(9.0, 10);
    // column 2(b+h)·L: 2(0.4+0.4)·3 = 4.8 m²
    expect(formworkAreaOfElement({ type: 'column', b_m: 0.4, h_m: 0.4, L_m: 3 })).toBeCloseTo(4.8, 10);
    // wall 2 sides ·L·h: 2·5·3 = 30 m²
    expect(formworkAreaOfElement({ type: 'wall', L_m: 5, h_m: 3 })).toBeCloseTo(30, 10);
  });
  it('PASS: computed 9.0 m² matches claimed 9.0 m²', () => {
    const r = checkFormworkAreaTakeoff({
      elements: [{ type: 'beam', b_m: 0.3, h_m: 0.6, L_m: 6 }],
      claimedArea_m2: 9.0,
    });
    expect(r.pass).toBe(true);
    expect(r.metrics.computedArea_m2).toBeCloseTo(9.0, 4);
  });
  it('FAIL: claimed 7.0 m² below computed 9.0 m² beyond tolerance', () => {
    const r = checkFormworkAreaTakeoff({
      elements: [{ type: 'beam', b_m: 0.3, h_m: 0.6, L_m: 6 }],
      claimedArea_m2: 7.0,
    });
    expect(r.pass).toBe(false);
    expect(r.metrics.differenceArea_m2).toBeCloseTo(2.0, 4);
    expect(r.reason).toBeTruthy();
  });
});

describe('4) schedule feasibility (CPM forward pass)', () => {
  // HAND-CALC: A(5) → B(3) → D(2) and A(5) → C(4) → D(2).
  //   critical path = A+C+D = 5+4+2 = 11 days (longer than A+B+D=10)
  const acyclic = [
    { id: 'A', duration_days: 5 },
    { id: 'B', duration_days: 3, predecessors: ['A'] },
    { id: 'C', duration_days: 4, predecessors: ['A'] },
    { id: 'D', duration_days: 2, predecessors: ['B', 'C'] },
  ];
  it('hand-calc cross-check: critical path = 11 days', () => {
    const fp = scheduleForwardPass(acyclic);
    expect(fp.hasCycle).toBe(false);
    expect(fp.criticalPathDays).toBe(11);
  });
  it('PASS: critical path 11 ≤ deadline 12', () => {
    const r = checkScheduleFeasibility({ activities: acyclic, deadline_days: 12 });
    expect(r.pass).toBe(true);
    expect(r.metrics.criticalPathDays).toBe(11);
  });
  it('FAIL (deadline): critical path 11 > deadline 10', () => {
    const r = checkScheduleFeasibility({ activities: acyclic, deadline_days: 10 });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('마감');
  });
  it('FAIL (cycle): A→B→A is not acyclic', () => {
    const r = checkScheduleFeasibility({
      activities: [
        { id: 'A', duration_days: 5, predecessors: ['B'] },
        { id: 'B', duration_days: 3, predecessors: ['A'] },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.metrics.hasCycle).toBe(1);
    expect(r.reason).toContain('순환');
  });
  it('FAIL (negative lag): a negative lag is refused', () => {
    const r = checkScheduleFeasibility({
      activities: [
        { id: 'A', duration_days: 5 },
        { id: 'B', duration_days: 3, predecessors: [{ id: 'A', lag_days: -2 }] },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.metrics.negativeLag).toBe(1);
  });
  it('lag adds to earliest start', () => {
    const fp = scheduleForwardPass([
      { id: 'A', duration_days: 5 },
      { id: 'B', duration_days: 3, predecessors: [{ id: 'A', lag_days: 2 }] },
    ]);
    expect(fp.criticalPathDays).toBe(10); // 5 + 2 lag + 3
  });
});

describe('5) cost rollup (Σ qty·rate ≤ budget)', () => {
  // HAND-CALC: 10×100 + 5×200 = 1000 + 1000 = 2000
  const items = [
    { description: 'concrete m³', quantity: 10, unitRate: 100 },
    { description: 'rebar ton', quantity: 5, unitRate: 200 },
  ];
  it('PASS: total 2000 ≤ budget 2500', () => {
    const r = checkCostRollup({ lineItems: items, budget: 2500 });
    expect(r.pass).toBe(true);
    expect(r.metrics.directCost).toBe(2000);
    expect(r.metrics.margin).toBe(500);
  });
  it('FAIL: total 2000 with 10% contingency = 2200 > budget 2100', () => {
    const r = checkCostRollup({ lineItems: items, budget: 2100, contingencyFactor: 0.1 });
    expect(r.pass).toBe(false);
    expect(r.metrics.totalCost).toBeCloseTo(2200, 6);
    expect(r.reason).toBeTruthy();
  });
});

describe('6) earthwork cut-fill balance', () => {
  // HAND-CALC: fill 90 compacted, C=0.9 → required bank = 90/0.9 = 100 m³
  it('PASS: cut 100 ≥ required bank 100 (C=0.9)', () => {
    const r = checkEarthworkCutFillBalance({ cutBank_m3: 100, fillCompacted_m3: 90, compactionFactor: 0.9 });
    expect(r.metrics.requiredBank_m3).toBeCloseTo(100, 6);
    expect(r.pass).toBe(true);
    expect(r.metrics.netImport_m3).toBeCloseTo(0, 6);
  });
  it('FAIL: cut 80 < required bank 100 → import needed', () => {
    const r = checkEarthworkCutFillBalance({ cutBank_m3: 80, fillCompacted_m3: 90, compactionFactor: 0.9 });
    expect(r.pass).toBe(false);
    expect(r.metrics.netImport_m3).toBeCloseTo(20, 6);
    expect(r.reason).toContain('반입');
  });
});
