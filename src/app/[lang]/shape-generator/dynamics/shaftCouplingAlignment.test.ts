import { describe, it, expect } from 'vitest';
import {
  evaluate,
  fromDialReadings,
  summarize,
  type CouplingAlignmentInput,
} from './shaftCouplingAlignment';

const base: CouplingAlignmentInput = {
  parallelOffsetMm: 0.03,
  angularMisalignmentDeg: 0.02,
  speedRpm: 1800,
};

describe('evaluate', () => {
  it('small misalignment at moderate speed → good grade', () => {
    const r = evaluate(base);
    expect(['excellent', 'acceptable']).toContain(r.overallGrade);
  });

  it('large offset → worse grade', () => {
    const good = evaluate(base);
    const bad = evaluate({ ...base, parallelOffsetMm: 0.5 });
    const order = ['excellent', 'acceptable', 'rough', 'unacceptable'];
    expect(order.indexOf(bad.offsetGrade)).toBeGreaterThan(order.indexOf(good.offsetGrade));
  });

  it('higher speed tightens tolerance', () => {
    const slow = evaluate({ ...base, speedRpm: 900 });
    const fast = evaluate({ ...base, speedRpm: 3600 });
    expect(fast.offsetToleranceMm).toBeLessThan(slow.offsetToleranceMm);
  });

  it('overall = worst of offset/angular', () => {
    const r = evaluate({ ...base, parallelOffsetMm: 0.5, angularMisalignmentDeg: 0.001 });
    expect(r.overallGrade).toBe(r.offsetGrade);
  });

  it('reaction force = k_r × offset', () => {
    const r = evaluate({ ...base, radialStiffnessNmm: 200 });
    expect(r.reactionForceN).toBeCloseTo(200 * 0.03, 6);
  });

  it('reaction moment = k_θ × angular', () => {
    const r = evaluate({ ...base, angularStiffnessNmPerDeg: 50 });
    expect(r.reactionMomentNm).toBeCloseTo(50 * 0.02, 6);
  });

  it('no stiffness → null reactions', () => {
    const r = evaluate(base);
    expect(r.reactionForceN).toBeNull();
    expect(r.reactionMomentNm).toBeNull();
  });

  it('rigid coupling with misalignment → warning', () => {
    const r = evaluate({ ...base, parallelOffsetMm: 0.1, couplingType: 'rigid' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('unacceptable misalignment → warning', () => {
    const r = evaluate({ ...base, parallelOffsetMm: 5 });
    expect(r.warnings.some(w => w.toLowerCase().includes('unacceptable') || w.toLowerCase().includes('realign'))).toBe(true);
  });

  it('zero speed → warning', () => {
    const r = evaluate({ ...base, speedRpm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('fromDialReadings', () => {
  it('parallel offset = rim TIR / 2', () => {
    const m = fromDialReadings(0.2, 0.1, 100);
    expect(m.parallelOffsetMm).toBeCloseTo(0.1, 6);
  });

  it('angular from face TIR / diameter', () => {
    const m = fromDialReadings(0, 0.1, 100);
    expect(m.angularMisalignmentDeg).toBeCloseTo(Math.atan(0.1 / 100) * 180 / Math.PI, 5);
  });

  it('zero face diameter → zero angular', () => {
    expect(fromDialReadings(0.2, 0.1, 0).angularMisalignmentDeg).toBe(0);
  });
});

describe('summarize', () => {
  it('reports grade', () => {
    const r = evaluate(base);
    const s = summarize(r);
    expect(s.overallGrade).toBe(r.overallGrade);
  });
});
