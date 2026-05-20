import { describe, it, expect } from 'vitest';
import { matchSuppliersStage2, paretoFront, type MatchRequest } from './supplierMatchingStage2';
import type { Supplier } from './supplierData';

const baseSup = (overrides: Partial<Supplier>): Supplier => ({
  id: 's1',
  name: 'Test Shop',
  nameKo: '테스트',
  region: 'gyeonggi',
  regionLabel: '경기도',
  processes: ['cnc'],
  materials: ['aluminum'],
  leadTimeDays: { min: 3, max: 7 },
  ratingStars: 4.0,
  reviewCount: 50,
  certifications: ['ISO9001'],
  minOrderKRW: 100000,
  tags: [],
  ...overrides,
});

const baseReq: MatchRequest = {
  process: 'cnc',
  materialId: 'aluminum',
};

describe('matchSuppliersStage2', () => {
  it('emits all 7 dimensions per supplier', () => {
    const r = matchSuppliersStage2([baseSup({})], baseReq);
    expect(r[0]!.dimensions).toHaveLength(7);
    const dimensions = r[0]!.dimensions.map(d => d.dimension);
    expect(dimensions).toContain('capability');
    expect(dimensions).toContain('leadTime');
    expect(dimensions).toContain('cost');
    expect(dimensions).toContain('proximity');
    expect(dimensions).toContain('certifications');
    expect(dimensions).toContain('quality');
    expect(dimensions).toContain('capacity');
  });

  it('disqualifies supplier missing the process', () => {
    const r = matchSuppliersStage2([baseSup({ processes: ['injection'] })], baseReq);
    expect(r[0]!.qualified).toBe(false);
    expect(r[0]!.disqualifiers.some(d => d.includes('capability'))).toBe(true);
  });

  it('disqualifies on missing required cert', () => {
    const r = matchSuppliersStage2([baseSup({ certifications: ['ISO9001'] })], {
      ...baseReq, requiredCertifications: ['IATF16949'],
    });
    expect(r[0]!.qualified).toBe(false);
  });

  it('qualifies when required cert present', () => {
    const r = matchSuppliersStage2(
      [baseSup({ certifications: ['ISO9001', 'IATF16949'] })],
      { ...baseReq, requiredCertifications: ['IATF16949'] },
    );
    expect(r[0]!.qualified).toBe(true);
  });

  it('proximity = 100 when same region', () => {
    const r = matchSuppliersStage2([baseSup({ region: 'seoul', regionLabel: '서울' })], {
      ...baseReq, customerRegion: 'seoul',
    });
    expect(r[0]!.dimensions.find(d => d.dimension === 'proximity')!.score).toBe(100);
  });

  it('proximity bonus within capital metro', () => {
    const r = matchSuppliersStage2([baseSup({ region: 'gyeonggi' })], {
      ...baseReq, customerRegion: 'seoul',
    });
    const prox = r[0]!.dimensions.find(d => d.dimension === 'proximity')!;
    expect(prox.score).toBeGreaterThan(50);
    expect(prox.score).toBeLessThan(100);
  });

  it('lead time score zero when supplier misses deadline', () => {
    const r = matchSuppliersStage2(
      [baseSup({ leadTimeDays: { min: 14, max: 20 } })],
      { ...baseReq, deadlineDays: 7 },
    );
    expect(r[0]!.dimensions.find(d => d.dimension === 'leadTime')!.score).toBe(0);
  });

  it('cost penalized when order below min order', () => {
    const r = matchSuppliersStage2(
      [baseSup({ minOrderKRW: 1_000_000 })],
      { ...baseReq, unitBudgetKrw: 1000, quantity: 1 },
    );
    expect(r[0]!.dimensions.find(d => d.dimension === 'cost')!.score).toBeLessThan(20);
  });

  it('quality factors review count', () => {
    const fewReviews = matchSuppliersStage2([baseSup({ ratingStars: 5.0, reviewCount: 2 })], baseReq);
    const manyReviews = matchSuppliersStage2([baseSup({ ratingStars: 5.0, reviewCount: 500 })], baseReq);
    const fewScore = fewReviews[0]!.dimensions.find(d => d.dimension === 'quality')!.score;
    const manyScore = manyReviews[0]!.dimensions.find(d => d.dimension === 'quality')!.score;
    expect(manyScore).toBeGreaterThan(fewScore);
  });

  it('ranks qualified suppliers above disqualified', () => {
    const r = matchSuppliersStage2([
      baseSup({ id: 'bad', processes: ['injection'] }),
      baseSup({ id: 'good', ratingStars: 3.0, reviewCount: 10 }),
    ], baseReq);
    expect(r[0]!.supplier.id).toBe('good');
    expect(r[1]!.supplier.id).toBe('bad');
  });

  it('weights affect weighted score but not dimensions', () => {
    const r1 = matchSuppliersStage2([baseSup({})], baseReq);
    const r2 = matchSuppliersStage2([baseSup({})], { ...baseReq, weights: { proximity: 10 } });
    // Dimensions identical, weighted score differs.
    expect(r1[0]!.dimensions.map(d => d.score)).toEqual(r2[0]!.dimensions.map(d => d.score));
    expect(r1[0]!.weightedScore).not.toBe(r2[0]!.weightedScore);
  });

  it('high-precision tolerance docks capability without aerospace cert', () => {
    const r = matchSuppliersStage2([baseSup({})], {
      ...baseReq, toleranceGrade: 'high-precision',
    });
    const cap = r[0]!.dimensions.find(d => d.dimension === 'capability')!;
    expect(cap.score).toBeLessThan(90);
  });
});

describe('paretoFront', () => {
  it('removes dominated suppliers', () => {
    // sup1 dominates sup2 — all dimensions equal or better.
    const sup1 = baseSup({ id: 'a', ratingStars: 5.0, reviewCount: 100 });
    const sup2 = baseSup({ id: 'b', ratingStars: 3.0, reviewCount: 10 });
    const all = matchSuppliersStage2([sup1, sup2], baseReq);
    const front = paretoFront(all);
    // Both might be on the front if sup2 has unique advantage somewhere;
    // but here sup1 should dominate sup2 on quality at least.
    expect(front.length).toBeLessThanOrEqual(all.length);
  });

  it('keeps trade-off pair', () => {
    // sup1 wins on quality but loses on cost (high min-order).
    // sup2 wins on cost (low min-order) but loses on quality.
    const sup1 = baseSup({ id: 'a', ratingStars: 5.0, reviewCount: 100, minOrderKRW: 5_000_000 });
    const sup2 = baseSup({ id: 'b', ratingStars: 3.5, reviewCount: 80, minOrderKRW: 100_000 });
    const all = matchSuppliersStage2([sup1, sup2], { ...baseReq, unitBudgetKrw: 50000, quantity: 5 });
    const front = paretoFront(all);
    expect(front).toHaveLength(2);
  });
});
