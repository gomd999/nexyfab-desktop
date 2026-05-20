import { describe, it, expect } from 'vitest';
import {
  predict,
  suggestFixes,
  summarize,
  type SinkMarkInput,
} from './sinkMarkPredictor';

const base: SinkMarkInput = {
  wallThicknessMm: 2,
  featureThicknessMm: 1, // ratio 0.5
  polymer: 'ABS',
};

describe('predict', () => {
  it('thickness ratio = feature / wall', () => {
    const r = predict(base);
    expect(r.thicknessRatio).toBeCloseTo(0.5, 6);
  });

  it('within guideline → no risk', () => {
    const r = predict(base);
    expect(r.risk).toBe('none');
    expect(r.withinGuideline).toBe(true);
  });

  it('thick rib → high risk', () => {
    const r = predict({ ...base, featureThicknessMm: 3 }); // ratio 1.5
    expect(r.risk).toBe('high');
    expect(r.withinGuideline).toBe(false);
  });

  it('estimated sink depth positive when over guideline', () => {
    const r = predict({ ...base, featureThicknessMm: 2.5 });
    expect(r.estimatedSinkDepthMm).toBeGreaterThan(0);
  });

  it('textured surface reduces sink depth', () => {
    const plain = predict({ ...base, featureThicknessMm: 2.5 });
    const textured = predict({ ...base, featureThicknessMm: 2.5, surfaceTextured: true });
    expect(textured.estimatedSinkDepthMm).toBeLessThan(plain.estimatedSinkDepthMm);
  });

  it('high gloss increases sink depth', () => {
    const plain = predict({ ...base, featureThicknessMm: 2.5 });
    const glossy = predict({ ...base, featureThicknessMm: 2.5, highGloss: true });
    expect(glossy.estimatedSinkDepthMm).toBeGreaterThan(plain.estimatedSinkDepthMm);
  });

  it('PA shrinks more than ABS (higher sink for same ratio)', () => {
    const abs = predict({ wallThicknessMm: 2, featureThicknessMm: 2.5, polymer: 'ABS' });
    const pa = predict({ wallThicknessMm: 2, featureThicknessMm: 2.5, polymer: 'PA' });
    expect(pa.estimatedSinkDepthMm).toBeGreaterThan(abs.estimatedSinkDepthMm);
  });

  it('suggested feature thickness hits guideline', () => {
    const r = predict({ ...base, featureThicknessMm: 3 });
    expect(r.suggestedFeatureThicknessMm).toBeCloseTo(0.5 * 2, 6);
  });

  it('unknown polymer → warning', () => {
    const r = predict({ ...base, polymer: 'XYZ' as never });
    expect(r.warnings.some(w => w.includes('Unknown'))).toBe(true);
  });

  it('zero wall → warning', () => {
    const r = predict({ ...base, wallThicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('suggestFixes', () => {
  it('no risk → no fixes', () => {
    expect(suggestFixes(predict(base))).toEqual([]);
  });

  it('high risk → multiple fixes incl texture', () => {
    const r = predict({ ...base, featureThicknessMm: 3 });
    const fixes = suggestFixes(r);
    expect(fixes.length).toBeGreaterThan(1);
    expect(fixes.some(f => f.toLowerCase().includes('texture'))).toBe(true);
  });
});

describe('summarize', () => {
  it('reports risk + ratio', () => {
    const r = predict({ ...base, featureThicknessMm: 3 });
    const s = summarize(r);
    expect(s.risk).toBe(r.risk);
    expect(s.thicknessRatio).toBe(r.thicknessRatio);
  });
});
