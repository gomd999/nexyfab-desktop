import { describe, it, expect } from 'vitest';
import {
  suggestWeldSymbols,
  estimateBeadVolumeMm3PerM,
  summarize,
  type JointGeometry,
} from './weldSymbolSuggester';

describe('suggestWeldSymbols', () => {
  it('T-joint → fillet primary', () => {
    const j: JointGeometry = { jointType: 'tee', plateAThicknessMm: 5, plateBThicknessMm: 5 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.symbol).toBe('fillet');
  });

  it('thin butt → square-butt', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 2, plateBThicknessMm: 2 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.symbol).toBe('square-butt');
  });

  it('medium butt → V-groove', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 10, plateBThicknessMm: 10 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.symbol).toBe('v-groove');
  });

  it('thick butt → U-groove primary', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 30, plateBThicknessMm: 30 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.symbol).toBe('u-groove');
  });

  it('single-sided thick butt → J-groove option present', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 30, plateBThicknessMm: 30, singleSidedAccess: true };
    const r = suggestWeldSymbols(j);
    expect(r.some(s => s.symbol === 'j-groove')).toBe(true);
  });

  it('corner joint suggests fillet + sometimes v-groove', () => {
    const j: JointGeometry = { jointType: 'corner', plateAThicknessMm: 10, plateBThicknessMm: 10 };
    const r = suggestWeldSymbols(j);
    expect(r.some(s => s.symbol === 'fillet')).toBe(true);
    expect(r.some(s => s.symbol === 'v-groove')).toBe(true);
  });

  it('lap with thin sheets includes spot + seam', () => {
    const j: JointGeometry = { jointType: 'lap', plateAThicknessMm: 0.8, plateBThicknessMm: 0.8 };
    const r = suggestWeldSymbols(j);
    expect(r.some(s => s.symbol === 'spot')).toBe(true);
    expect(r.some(s => s.symbol === 'seam')).toBe(true);
  });

  it('edge joint → edge weld', () => {
    const j: JointGeometry = { jointType: 'edge', plateAThicknessMm: 2, plateBThicknessMm: 2 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.symbol).toBe('edge');
  });

  it('fillet leg uses smaller plate thickness', () => {
    const j: JointGeometry = { jointType: 'tee', plateAThicknessMm: 8, plateBThicknessMm: 4 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.filletLegMm).toBe(4);
  });

  it('V-groove records 60° default', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 10, plateBThicknessMm: 10 };
    const r = suggestWeldSymbols(j);
    expect(r[0]!.grooveAngleDeg).toBe(60);
  });

  it('sorted by confidence desc', () => {
    const j: JointGeometry = { jointType: 'corner', plateAThicknessMm: 10, plateBThicknessMm: 10 };
    const r = suggestWeldSymbols(j);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.confidence).toBeLessThanOrEqual(r[i - 1]!.confidence);
    }
  });
});

describe('estimateBeadVolumeMm3PerM', () => {
  it('fillet leg = 5mm → 12500 mm³/m', () => {
    const v = estimateBeadVolumeMm3PerM({ symbol: 'fillet', confidence: 1, filletLegMm: 5, reasoning: '' });
    expect(v).toBeCloseTo(12500, 0);
  });

  it('spot weld much smaller volume', () => {
    const spot = estimateBeadVolumeMm3PerM({ symbol: 'spot', confidence: 1, reasoning: '' });
    const fillet = estimateBeadVolumeMm3PerM({ symbol: 'fillet', confidence: 1, filletLegMm: 5, reasoning: '' });
    expect(spot).toBeLessThan(fillet);
  });

  it('larger fillet leg → larger volume', () => {
    const small = estimateBeadVolumeMm3PerM({ symbol: 'fillet', confidence: 1, filletLegMm: 3, reasoning: '' });
    const big = estimateBeadVolumeMm3PerM({ symbol: 'fillet', confidence: 1, filletLegMm: 8, reasoning: '' });
    expect(big).toBeGreaterThan(small);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.primarySymbol).toBeNull();
  });

  it('reports primary symbol', () => {
    const j: JointGeometry = { jointType: 'tee', plateAThicknessMm: 5, plateBThicknessMm: 5 };
    const s = summarize(suggestWeldSymbols(j));
    expect(s.primarySymbol).toBe('fillet');
  });

  it('detects groove option', () => {
    const j: JointGeometry = { jointType: 'butt', plateAThicknessMm: 10, plateBThicknessMm: 10 };
    const s = summarize(suggestWeldSymbols(j));
    expect(s.hasGrooveOption).toBe(true);
  });
});
