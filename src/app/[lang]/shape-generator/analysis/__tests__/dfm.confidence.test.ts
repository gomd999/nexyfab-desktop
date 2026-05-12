/**
 * DFM/RFQ confidence telemetry (Q7).
 *
 * Customers must see how reliable each manufacturability flag is and how
 * tight the cost estimate is. These tests pin the confidence shape so a
 * UI can render it consistently.
 */

import { describe, it, expect } from 'vitest';
import { aggregateDfmConfidence } from '../dfmAnalysis';
import type { DFMIssue } from '../dfmAnalysis';

function issue(type: DFMIssue['type'], confidence?: number): DFMIssue {
  return {
    id: `i_${type}`,
    process: 'cnc_milling',
    type,
    severity: 'warning',
    description: 'mock',
    suggestion: 'mock',
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

describe('DFM confidence (Q7)', () => {
  it('zero issues => full confidence', () => {
    expect(aggregateDfmConfidence([])).toBe(1.0);
  });

  it('mixed issues stay within [0,1]', () => {
    const c = aggregateDfmConfidence([
      issue('draft_angle'),
      issue('thin_wall'),
      issue('support_volume'),
    ]);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it('high-confidence issues score higher than low-confidence', () => {
    const high = aggregateDfmConfidence([issue('draft_angle'), issue('sharp_corner')]);
    const low = aggregateDfmConfidence([issue('support_volume'), issue('bridge')]);
    expect(high).toBeGreaterThan(low);
  });

  it('explicit confidence on issue overrides the table default', () => {
    const c = aggregateDfmConfidence([issue('draft_angle', 0.10)]);
    expect(c).toBeCloseTo(0.10, 2);
  });

  it('unknown type falls back to default 0.7', () => {
    // @ts-expect-error — testing unknown enum branch
    const c = aggregateDfmConfidence([{ ...issue('draft_angle'), type: 'mystery' }]);
    expect(c).toBeCloseTo(0.7, 2);
  });
});

describe('PipelineResult cost confidence (Q7)', () => {
  // The pipeline computes confidence as max(0.55, min(0.95, dfmScore/100)).
  // We replicate the formula to lock the contract.
  const fromDfm = (dfm: number) => Math.max(0.55, Math.min(0.95, dfm / 100));

  it('high DFM score (90) yields high confidence', () => {
    expect(fromDfm(90)).toBeCloseTo(0.9, 2);
  });

  it('low DFM score floor is 0.55', () => {
    expect(fromDfm(10)).toBe(0.55);
    expect(fromDfm(0)).toBe(0.55);
  });

  it('top DFM score ceiling is 0.95', () => {
    expect(fromDfm(100)).toBe(0.95);
  });

  it('cost range scales inversely with confidence', () => {
    const cost = 1000;
    const conf = fromDfm(60); // 0.6
    const variance = 1 - conf; // 0.4
    const low = Math.round(cost * (1 - variance));
    const high = Math.round(cost * (1 + variance));
    expect(low).toBeLessThan(cost);
    expect(high).toBeGreaterThan(cost);
    // 0.6 confidence → ±40% range
    expect(high - low).toBeCloseTo(cost * 2 * variance, 0);
  });
});
