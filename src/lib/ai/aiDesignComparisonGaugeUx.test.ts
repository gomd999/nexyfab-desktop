import { describe, expect, it } from 'vitest';
import { createDesignCandidateComparison, type DesignCandidate } from './designCandidateComparison';
import { createGaugeViewModel } from './gaugeViewModel';
import { DIRECT_MANIPULATION_INTENT_SCHEMA, type DirectManipulationIntent } from './directManipulation';
import { adjustGaugeByStep, applyPartialCandidateForUx, createComparisonMatrix, createGaugeUxViewModel, selectPrimaryGauge } from './aiDesignComparisonGaugeUx';
import type { SelectionContext } from './selectionContext';

const candidate = (id: string, status: 'verified' | 'unknown' = 'verified'): DesignCandidate => ({
  candidateId: id, revision: `${id}:r1`, baseRevision: 'rev-1', title: id, summary: id,
  metrics: [
    { metricId: 'requirement-fit', label: 'Requirement fit', value: id === 'a' ? 'yes' : 'maybe', status },
    { metricId: 'width', label: 'Width', value: id === 'a' ? 10 : 12, unit: 'mm', status },
    { metricId: 'manufacturing', label: 'Manufacturing', value: 'CNC', status },
    { metricId: 'cost-estimate', label: 'Estimated cost', value: 100, unit: 'USD', status },
  ], evidence: [{ evidenceId: 'e', label: 'evidence', status }], featureIds: ['body', 'hole'],
});
const selection: SelectionContext = { version: 1, projectRevision: 'rev-1', assemblyPath: ['main'], partInstanceId: 'part', topology: [], sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' };
const intent = (id: string, start = 10): DirectManipulationIntent => ({
  schema: DIRECT_MANIPULATION_INTENT_SCHEMA, version: 1, intentId: id, gestureId: 'g', sessionId: 's', sequence: 1, idempotencyKey: id,
  phase: 'preview', createdAt: '2026-08-24T00:00:00Z', projectId: 'p', baseRevision: 'rev-1', coordinateFrame: 'world', viewportRevision: 'v',
  device: { platform: 'mobile', pointer: 'touch', pointerCount: 1 }, origin: 'user_gauge', userCommand: 'edit', selection,
  binding: { kind: 'feature_parameter', partId: 'part', featureId: 'f', parameter: 'width', unit: 'mm' }, measurement: { semantics: 'absolute', startValue: start, targetValue: start, delta: 0, unit: 'mm' },
});

describe('AI Design comparison and gauge UX', () => {
  it('builds four-category matrix and does not turn unknown/estimated into PASS', () => {
    const matrix = createComparisonMatrix(createDesignCandidateComparison('rev-1', [candidate('a'), candidate('b', 'unknown')]));
    expect(matrix.rows.map(row => row.category)).toEqual(['requirements', 'dimensions', 'manufacturing', 'cost']);
    expect(matrix.rows.find(row => row.metricId === 'width')!.cells[1]!.change).toBe('unknown');
    expect(matrix.rows.find(row => row.metricId === 'cost-estimate')!.cells[0]!.displayValue).toContain('estimated');
    expect(matrix.rows.find(row => row.metricId === 'requirement-fit')!.cells[1]!.evidenceStatus).toBe('unknown');
  });

  it('fails closed when a verified metric points to failed evidence', () => {
    const value = candidate('a');
    const conflicted = { ...value, evidence: [{ ...value.evidence[0]!, status: 'failed' as const }], metrics: [{ ...value.metrics[0]!, evidenceId: 'e' }] };
    const cell = createComparisonMatrix(createDesignCandidateComparison('rev-1', [conflicted])).rows[0]!.cells[0]!;
    expect(cell).toMatchObject({ metricStatus: 'verified', sourceEvidenceStatus: 'failed', evidenceStatus: 'failed', change: 'unknown' });
  });

  it('blocks partial apply for stale scope and incomplete verification', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a', 'unknown')]);
    expect(applyPartialCandidateForUx(model, 'a', ['hole'])).toMatchObject({ ok: false, blockedReasons: ['verification_incomplete'] });
    expect(applyPartialCandidateForUx(model, 'a', ['missing'])).toMatchObject({ ok: false, blockedReasons: expect.arrayContaining(['verification_incomplete']) });
    expect(applyPartialCandidateForUx(model, 'a', ['hole'], 'rev-2').blockedReasons).toContain('stale_workspace_revision');
  });

  it('selects primary deterministically and supports fine range adjustment', () => {
    const base = createGaugeViewModel(intent('i'), { min: 0, max: 11, snapIncrement: 0.5 });
    const a = createGaugeUxViewModel({ ...base, gaugeId: 'z' }, { editable: true, selectionRelevance: 1, mobile: true });
    const b = createGaugeUxViewModel({ ...base, gaugeId: 'a' }, { editable: true, selectionRelevance: 1 });
    expect(selectPrimaryGauge([a, b])!.gaugeId).toBe('a');
    expect(a.touchTargetPx).toBe(44);
    expect(adjustGaugeByStep(a, 'fine', 1)).toMatchObject({ ok: true, gauge: { targetValue: 10.5 } });
    expect(adjustGaugeByStep(a, 'coarse', 1)).toMatchObject({ ok: false });
  });
});
