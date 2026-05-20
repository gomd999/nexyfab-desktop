import { describe, it, expect } from 'vitest';
import {
  pickStack,
  washerForBolt,
  clampLength,
  recommendBoltLength,
  summarize,
  type BoltSpec,
} from './washerPatternPicker';

const m6: BoltSpec = { threadDiameterMm: 6, headDiameterMm: 10 };

describe('washerForBolt', () => {
  it('flat washer inner = 1.05 × thread', () => {
    const w = washerForBolt('plain-flat', m6);
    expect(w.innerDiameterMm).toBeCloseTo(6.3, 3);
  });

  it('fender has larger OD', () => {
    const flat = washerForBolt('plain-flat', m6);
    const fender = washerForBolt('fender', m6);
    expect(fender.outerDiameterMm).toBeGreaterThan(flat.outerDiameterMm);
  });

  it('tooth washer is thinner', () => {
    expect(washerForBolt('tooth-internal', m6).thicknessMm).toBeLessThan(washerForBolt('plain-flat', m6).thicknessMm);
  });
});

describe('pickStack', () => {
  it('standard purpose → plain flat top, empty bottom', () => {
    const r = pickStack(m6, { purpose: 'standard', includeLockWasher: false });
    expect(r.topSide.some(w => w.kind === 'plain-flat')).toBe(true);
    expect(r.bottomSide).toEqual([]);
  });

  it('anti-vibration adds Nord-Lock', () => {
    const r = pickStack(m6, { purpose: 'anti-vibration', includeLockWasher: false });
    expect(r.topSide.some(w => w.kind === 'nord-lock')).toBe(true);
  });

  it('soft-material both adds fenders both sides', () => {
    const r = pickStack({ ...m6, softSide: 'both' }, { purpose: 'soft-material', includeLockWasher: false });
    expect(r.topSide.some(w => w.kind === 'fender')).toBe(true);
    expect(r.bottomSide.some(w => w.kind === 'fender')).toBe(true);
  });

  it('seal purpose → bonded-seal bottom', () => {
    const r = pickStack(m6, { purpose: 'seal', includeLockWasher: false });
    expect(r.bottomSide.some(w => w.kind === 'bonded-seal')).toBe(true);
  });

  it('electrical-insulation → insulating both sides', () => {
    const r = pickStack(m6, { purpose: 'electrical-insulation', includeLockWasher: false });
    expect(r.topSide.some(w => w.kind === 'insulating')).toBe(true);
    expect(r.bottomSide.some(w => w.kind === 'insulating')).toBe(true);
  });

  it('includeLockWasher adds split washer', () => {
    const r = pickStack(m6, { purpose: 'standard', includeLockWasher: true });
    expect(r.topSide.some(w => w.kind === 'spring-split')).toBe(true);
  });

  it('total thickness positive', () => {
    const r = pickStack(m6);
    expect(r.totalThicknessMm).toBeGreaterThan(0);
  });
});

describe('clampLength', () => {
  it('total = stack + plate', () => {
    const stack = pickStack(m6);
    expect(clampLength(stack, 20)).toBeCloseTo(stack.totalThicknessMm + 20, 3);
  });
});

describe('recommendBoltLength', () => {
  it('positive length with rationale', () => {
    const stack = pickStack(m6);
    const r = recommendBoltLength(stack, 20, 6);
    expect(r.recommendedLengthMm).toBeGreaterThan(20);
    expect(r.rationale.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports washer counts', () => {
    const stack = pickStack(m6, { purpose: 'standard', includeLockWasher: true });
    const s = summarize(stack, 'standard');
    expect(s.topCount).toBeGreaterThan(0);
    expect(s.totalThicknessMm).toBeGreaterThan(0);
  });
});
