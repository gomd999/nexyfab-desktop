import { describe, expect, it } from 'vitest';
import { buildInteriorAccuracyReport, type InteriorBenchmarkCase, type InteriorBenchmarkRun } from '../interiorAccuracyBenchmark';
const cases = (track: InteriorBenchmarkCase['track']): InteriorBenchmarkCase[] => Array.from({ length: 20 }, (_, i) => ({ caseId: `${track}-${i}`, track, holdoutGroup: `${track}-product-${i}`, sourceHash: (i + 1).toString(16).padStart(64, '0'), split: 'holdout', approvalReviewerIds: [`${track}-reviewer-a`, `${track}-reviewer-b`] }));
const runs = (items: InteriorBenchmarkCase[]): InteriorBenchmarkRun[] => items.flatMap(item =>
  Array.from({ length: 3 }, (_, campaign) =>
    Array.from({ length: 5 }, (_, i) => ({
      caseId: item.caseId,
      campaign: campaign + 1,
      repeat: i + 1,
      usedForTuning: false as const,
      requiredGatesPassed: true,
      falseVerified: false,
      hierarchy: { passed: 1, total: 1 },
      placements: { passed: 1, total: 1 },
      elements: { passed: 1, total: 1 },
      roundtrip: { passed: 1, total: 1 },
      spaceBoundary: { passed: 1, total: 1 },
      egress: { passed: 1, total: 1 },
      doorSwing: { passed: 1, total: 1 },
      mep: { passed: 1, total: 1 },
    })),
  ).flat(),
);
describe('two-track interior accuracy benchmark', () => {
  it('does not let building structure evidence qualify interior spatial accuracy', () => { const building = cases('building_structure'); const report = buildInteriorAccuracyReport(building, runs(building)); expect(report.find(x => x.track === 'building_structure')?.eligible).toBe(true); expect(report.find(x => x.track === 'interior_spatial')?.eligible).toBe(false); });
  it('requires space, egress, door and MEP accuracy independently', () => { const spatial = cases('interior_spatial'), measured = runs(spatial); measured.forEach(run => { run.egress = { passed: 94, total: 100 }; }); const report = buildInteriorAccuracyReport(spatial, measured).find(x => x.track === 'interior_spatial')!; expect(report.eligible).toBe(false); expect(report.blockers.some(x => x.startsWith('egress accuracy'))).toBe(true); });
  it('rejects five-repeat legacy evidence without three campaigns', () => { const spatial = cases('interior_spatial'), measured = runs(spatial).filter(run => run.campaign === 1); const report = buildInteriorAccuracyReport(spatial, measured).find(x => x.track === 'interior_spatial')!; expect(report).toMatchObject({ eligible: false, campaigns: 1, minimumRepeats: 5, minimumRepeatsPerCampaign: 0 }); });
  it('rejects cases without dual independent approval', () => { const spatial = cases('interior_spatial'); spatial[0] = { ...spatial[0]!, approvalReviewerIds: ['one'] }; expect(() => buildInteriorAccuracyReport(spatial, [])).toThrow('two independent approvals'); });
});
