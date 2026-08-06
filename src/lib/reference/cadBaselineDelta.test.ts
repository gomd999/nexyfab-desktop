import { describe, expect, it } from 'vitest';
import { compareCadCorpusBaselines } from './cadBaselineDelta';
import type { CadCorpusBatchSummary } from './cadCorpusBatchRunnerV2';
import type { CadEvidenceIrV2, EvidenceAssertionStatus } from './cadEvidenceIrV2';

function item(fixtureId: string, status: EvidenceAssertionStatus, assertionStatuses: Record<string, EvidenceAssertionStatus>) {
  const evidence: CadEvidenceIrV2 = {
    schemaVersion: 2, scenarioId: fixtureId,
    input: { sha256: fixtureId.padEnd(64, 'a'), extension: 'step', sizeBytes: 10 },
    producer: { adapter: 'test', version: '1' }, status,
    assertions: Object.entries(assertionStatuses).map(([id, assertionStatus]) => ({
      id, status: assertionStatus, method: 'test', criterion: { description: 'test' }, confidence: 1,
      reason: 'C:\\private\\source.step SECRET', artifactHashes: [fixtureId.padEnd(64, 'a')],
    })),
    artifacts: [], sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false, additional: [] },
  };
  return { fixtureId, status, resumed: false, evidence };
}

function run(signature: string, results: ReturnType<typeof item>[]): CadCorpusBatchSummary {
  const counts = { pass: 0, fail: 0, not_run: 0, error: 0 };
  for (const result of results) counts[result.status]++;
  return { schema: 'nexyfab.cad-corpus-run.v2', signature, selected: results.length, counts, results };
}

describe('CAD baseline deterministic delta', () => {
  it('reports fixture/assertion deltas and worsening transitions', () => {
    const baseline = run('old', [item('A01', 'pass', { valid: 'pass', curve: 'pass' }), item('A02', 'not_run', { valid: 'not_run' })]);
    const candidate = run('new', [item('A01', 'fail', { valid: 'pass', curve: 'fail' }), item('A02', 'pass', { valid: 'pass' })]);
    const report = compareCadCorpusBaselines(baseline, candidate);
    expect(report.fixtureStatusDelta).toEqual({ pass: 0, fail: 1, not_run: -1, error: 0 });
    expect(report.assertionStatusDelta).toEqual({ pass: 0, fail: 1, not_run: -1 });
    expect(report.regressions).toEqual([
      { kind: 'fixture_status', fixtureId: 'A01', from: 'pass', to: 'fail' },
      { kind: 'assertion_status', fixtureId: 'A01', assertionId: 'curve', from: 'pass', to: 'fail' },
    ]);
    expect(report.releaseBlocking).toBe(true);
  });

  it('blocks removed fixtures/assertions and newly added non-pass evidence', () => {
    const baseline = run('old', [item('A01', 'pass', { valid: 'pass', area: 'pass' }), item('A02', 'pass', { valid: 'pass' })]);
    const candidate = run('new', [item('A01', 'pass', { valid: 'pass' }), item('A03', 'not_run', { valid: 'not_run' })]);
    const report = compareCadCorpusBaselines(baseline, candidate);
    expect(report.regressions.map(item => item.kind)).toEqual(['assertion_removed', 'fixture_removed', 'assertion_removed']);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ fixtureId: 'A02', status: 'missing' }),
      expect.objectContaining({ fixtureId: 'A03', status: 'not_run' }),
    ]));
  });

  it('is deterministic, sorted, releasable, and cannot leak source/path fields', () => {
    const baseline = run('same-old', [item('A02', 'pass', { z: 'pass' }), item('A01', 'pass', { b: 'pass', a: 'pass' })]);
    const candidate = run('same-new', [item('A01', 'pass', { a: 'pass', b: 'pass' }), item('A02', 'pass', { z: 'pass' })]);
    const first = compareCadCorpusBaselines(baseline, candidate);
    const second = compareCadCorpusBaselines(baseline, candidate);
    expect(first).toEqual(second);
    expect(first.fixtureStatusTransitions.map(item => item.fixtureId)).toEqual(['A01', 'A02']);
    expect(first.assertionTransitions.map(item => `${item.fixtureId}/${item.assertionId}`)).toEqual(['A01/a', 'A01/b', 'A02/z']);
    expect(first.releaseBlocking).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/private|source\.step|SECRET|artifacts|reason/);
  });

  it('rejects duplicate fixture and assertion ids instead of comparing ambiguously', () => {
    const duplicateFixture = run('old', [item('A01', 'pass', {}), item('A01', 'pass', {})]);
    expect(() => compareCadCorpusBaselines(duplicateFixture, run('new', []))).toThrow(/unique/);
    const duplicateAssertions = run('old', [item('A01', 'pass', { valid: 'pass' })]);
    duplicateAssertions.results[0]!.evidence!.assertions.push({ ...duplicateAssertions.results[0]!.evidence!.assertions[0]! });
    expect(() => compareCadCorpusBaselines(duplicateAssertions, run('new', []))).toThrow(/Assertion ids/);
  });
});
