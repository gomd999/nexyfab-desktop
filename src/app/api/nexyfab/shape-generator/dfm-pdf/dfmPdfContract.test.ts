import { describe, expect, it } from 'vitest';
import { validateDfmPdfBody } from './dfmPdfContract';

const valid = () => ({
  lang: 'ko-KR', projectName: 'Bracket', generatedAt: '2026-08-26T10:00:00.000Z',
  geometry: { volume_cm3: 12.5, surface_area_cm2: 40, bbox: { w: 10, h: 20, d: 30 }, triangleCount: 800 },
  results: [{ process: 'cnc', score: 88, feasible: true, estimatedDifficulty: 'moderate', issues: [] }],
});

describe('DFM PDF request contract', () => {
  it('accepts a bounded locale-aware report', () => expect(validateDfmPdfBody(valid())).toBe(true));

  it.each([
    { results: [] },
    { results: [{ process: 'cnc', score: Number.NaN, feasible: true, estimatedDifficulty: 'low', issues: [] }] },
    { results: [{ process: 'cnc', score: 101, feasible: true, estimatedDifficulty: 'low', issues: [] }] },
    { results: [{ process: 'cnc', score: 50, feasible: 'yes', estimatedDifficulty: 'low', issues: [] }] },
    { results: [{ process: 'cnc', score: 50, feasible: true, estimatedDifficulty: 'low', issues: [{ process: 'cnc', type: 'wall', severity: 'fatal', description: 'x', suggestion: 'y' }] }] },
    { generatedAt: 'not-a-date' },
    { geometry: { bbox: { w: 0, h: 2, d: 3 } } },
  ])('rejects malformed or unbounded input %#', patch => {
    expect(validateDfmPdfBody({ ...valid(), ...patch })).toBe(false);
  });
});
