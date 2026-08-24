import { describe, expect, it } from 'vitest';
import { DIRECT_MANIPULATION_INTENT_SCHEMA, type DirectManipulationIntent } from '../directManipulation';
import { createGaugeViewModel, tryUpdateGaugeTarget, updateGaugeTarget } from '../gaugeViewModel';
import type { SelectionContext } from '../selectionContext';

const selection: SelectionContext = {
  version: 1, projectRevision: 'rev-1', assemblyPath: ['main'], partInstanceId: 'part-1',
  topology: [{ kind: 'edge', persistentRef: 'edge-1', referenceQuality: 'persistent', geometrySignature: 'edge' }],
  sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm',
};
const intent = (binding: DirectManipulationIntent['binding'], unit: 'mm' | 'deg' = 'mm'): DirectManipulationIntent => ({
  schema: DIRECT_MANIPULATION_INTENT_SCHEMA, version: 1, intentId: `i-${binding.kind}`, gestureId: 'g', sessionId: 's', sequence: 1,
  idempotencyKey: 'g:rev-1', phase: 'preview', createdAt: '2026-08-24T00:00:00Z', projectId: 'p', baseRevision: 'rev-1', coordinateFrame: 'world', viewportRevision: 'v',
  device: { platform: 'desktop', pointer: 'mouse', pointerCount: 1 }, origin: 'user_gauge', userCommand: 'edit', selection,
  binding, measurement: { semantics: binding.kind.startsWith('occurrence_') ? 'delta' : 'absolute', startValue: 10, targetValue: 15, delta: 5, unit },
});

describe('GaugeViewModelV1', () => {
  it('maps binding kinds into user-facing gauge types and values', () => {
    expect(createGaugeViewModel(intent({ kind: 'edge_fillet', partId: 'part-1', edgeRefs: ['edge-1'] })).type).toBe('fillet');
    expect(createGaugeViewModel(intent({ kind: 'edge_chamfer', partId: 'part-1', edgeRefs: ['edge-1'] })).type).toBe('chamfer');
    expect(createGaugeViewModel(intent({ kind: 'occurrence_translate', partId: 'part-1', axis: [1, 0, 0] })).type).toBe('translation');
    const gauge = createGaugeViewModel(intent({ kind: 'feature_parameter', partId: 'part-1', featureId: 'f', parameter: 'diameter', unit: 'mm' }));
    expect(gauge).toMatchObject({ type: 'diameter', currentValue: 10, targetValue: 15, delta: 5, unit: 'mm', baseRevision: 'rev-1', visible: true, primary: true });
  });

  it('exposes axis/frame and invalidates all downstream verification after a target edit', () => {
    const gauge = createGaugeViewModel(intent({ kind: 'occurrence_translate', partId: 'part-1', axis: [1, 0, 0] }));
    expect(gauge.axisFrame).toEqual({ axis: [1, 0, 0], coordinateFrame: 'world' });
    const changed = updateGaugeTarget(gauge, 22);
    expect(changed.delta).toBe(12);
    expect(changed.invalidatedVerification).toEqual({ geometry: 'invalidated', topology: 'invalidated', manufacturing: 'invalidated' });
  });

  it('maps degree sketch dimensions to angle and rejects targets outside range', () => {
    const angle = createGaugeViewModel(intent({ kind: 'sketch_dimension', partId: 'part-1', sketchId: 'sketch-1', entityIds: ['line-1'], unit: 'deg' }, 'deg'));
    expect(angle.type).toBe('angle');
    const radius = createGaugeViewModel(intent({ kind: 'feature_parameter', partId: 'part-1', featureId: 'f', parameter: 'radius', unit: 'mm' }), { snapIncrement: 0.5 });
    expect(updateGaugeTarget(radius, -1)).toBe(radius);
    expect(updateGaugeTarget(radius, 10.26).targetValue).toBe(10.5);
    expect(tryUpdateGaugeTarget(radius, -1)).toEqual({ ok: false, issues: ['target_out_of_range_or_invalid_snap'] });
    expect(tryUpdateGaugeTarget(radius, Number.NaN)).toEqual({ ok: false, issues: ['target_not_finite'] });
  });

  it('requires confirmation for derived selection and AI assumptions', () => {
    const derived = { ...selection, topology: [{ ...selection.topology[0]!, referenceQuality: 'derived' as const }] };
    const gauge = createGaugeViewModel({ ...intent({ kind: 'face_offset', partId: 'part-1', faceRefs: ['edge-1'] }), selection: derived, assumptions: ['face inferred'] });
    expect(gauge.requiresConfirmation).toBe(true);
    expect(gauge.confirmationReasons).toEqual(expect.arrayContaining(['selection_reference_requires_confirmation', 'ai_assumptions_require_confirmation']));
  });
});
