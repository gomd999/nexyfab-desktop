import { describe, expect, it } from 'vitest';
import { runServerMeshDfmScreening } from '../serverAdapters';

describe('server mesh DFM screening', () => {
  it('runs measurable FDM rules without promoting screening to release evidence', async () => {
    const result = await runServerMeshDfmScreening({
      bbox: { min: [0, 0, 0], max: [300, 20, 20] },
      minWallThicknessMm: 0.5,
      triangleCount: 12,
    }, ['fdm']);
    expect(result.issuesCount).toBe(2);
    expect(result.meta).toMatchObject({ serverStub: false, screeningAvailable: true, releaseEvidence: false });
    expect(result.meta.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FDM-02', severity: 'error' }),
      expect.objectContaining({ code: 'FDM-03', severity: 'error' }),
    ]));
    expect(result.summary).toContain('not manufacturing release evidence');
  });

  it('returns an explicit unavailable result when measurements are absent', async () => {
    const result = await runServerMeshDfmScreening({ triangleCount: 12 }, ['cnc_milling']);
    expect(result).toMatchObject({
      issuesCount: 0,
      meta: { screeningAvailable: false, releaseEvidence: false },
    });
    expect(result.summary).toContain('No pass is claimed');
  });
});
