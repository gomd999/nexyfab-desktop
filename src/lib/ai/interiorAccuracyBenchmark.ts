export type InteriorAccuracyTrack = 'building_structure' | 'interior_spatial';
export interface InteriorBenchmarkCase { caseId: string; track: InteriorAccuracyTrack; holdoutGroup: string; sourceHash: string; split: 'holdout'; }
export interface InteriorBenchmarkRun {
  caseId: string; repeat: number; usedForTuning: false; requiredGatesPassed: boolean; falseVerified: boolean;
  hierarchy: { passed: number; total: number }; placements: { passed: number; total: number }; elements: { passed: number; total: number }; roundtrip: { passed: number; total: number };
  spaceBoundary?: { passed: number; total: number }; egress?: { passed: number; total: number }; doorSwing?: { passed: number; total: number }; mep?: { passed: number; total: number };
}
export interface InteriorTrackReport { track: InteriorAccuracyTrack; cases: number; measuredCases: number; minimumRepeats: number; metrics: Record<string, number | null>; gatePassRate: number | null; falseVerified: number; eligible: boolean; blockers: string[] }
const TRACKS: InteriorAccuracyTrack[] = ['building_structure', 'interior_spatial'], SHA = /^[a-f0-9]{64}$/;
const ratio = (passed: number, total: number) => total > 0 ? passed / total : null;
export function buildInteriorAccuracyReport(cases: readonly InteriorBenchmarkCase[], runs: readonly InteriorBenchmarkRun[]): InteriorTrackReport[] {
  const ids = new Set<string>(); for (const item of cases) { if (!item.caseId.trim() || ids.has(item.caseId) || !SHA.test(item.sourceHash) || item.split !== 'holdout') throw new TypeError('Interior cases require unique ids, raw SHA-256, and holdout split.'); ids.add(item.caseId); }
  return TRACKS.map(track => {
    const trackCases = cases.filter(item => item.track === track), caseIds = new Set(trackCases.map(item => item.caseId));
    const valid = runs.filter(run => caseIds.has(run.caseId) && run.usedForTuning === false && Number.isSafeInteger(run.repeat) && run.repeat >= 1 && run.repeat <= 5);
    const byCase = new Map<string, InteriorBenchmarkRun[]>(); for (const run of valid) byCase.set(run.caseId, [...(byCase.get(run.caseId) ?? []), run]);
    const names = track === 'building_structure' ? ['hierarchy', 'placements', 'elements', 'roundtrip'] as const : ['hierarchy', 'placements', 'elements', 'roundtrip', 'spaceBoundary', 'egress', 'doorSwing', 'mep'] as const;
    const metrics: Record<string, number | null> = {};
    for (const name of names) { const values = valid.flatMap(run => run[name] ? [run[name]!] : []); metrics[name] = ratio(values.reduce((sum, item) => sum + item.passed, 0), values.reduce((sum, item) => sum + item.total, 0)); }
    const minimumRepeats = trackCases.length ? Math.min(...trackCases.map(item => new Set((byCase.get(item.caseId) ?? []).map(run => run.repeat)).size)) : 0;
    const gatePassRate = ratio(valid.filter(run => run.requiredGatesPassed).length, valid.length), falseVerified = valid.filter(run => run.falseVerified).length, blockers: string[] = [];
    if (trackCases.length < 20) blockers.push(`Need 20 independent ${track} holdouts; have ${trackCases.length}.`);
    if (byCase.size !== trackCases.length) blockers.push(`Every case must be measured; measured ${byCase.size}/${trackCases.length}.`);
    if (minimumRepeats < 5) blockers.push(`Every case needs five unique repeats; minimum is ${minimumRepeats}.`);
    if (gatePassRate !== 1) blockers.push(`Required gate pass rate must be 100%; current is ${gatePassRate === null ? 'not measured' : `${gatePassRate * 100}%`}.`);
    for (const [name, value] of Object.entries(metrics)) if (value === null || value < 0.95) blockers.push(`${name} accuracy must be at least 95%; current is ${value === null ? 'not measured' : `${value * 100}%`}.`);
    if (falseVerified) blockers.push(`False verified must be zero; current is ${falseVerified}.`);
    return { track, cases: trackCases.length, measuredCases: byCase.size, minimumRepeats, metrics, gatePassRate, falseVerified, eligible: blockers.length === 0, blockers };
  });
}
