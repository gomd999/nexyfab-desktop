/** Pure view model for direct-manipulation gauges. No canvas/UI dependency. */
import { selectionRequiresConfirmation, type SelectionContext } from './selectionContext';
import type { DirectManipulationBinding, DirectManipulationIntent, DirectManipulationUnit } from './directManipulation';

export const GAUGE_VIEW_MODEL_SCHEMA = 'nexyfab.gauge-view-model.v1' as const;
export type GaugeType = 'length' | 'radius' | 'diameter' | 'angle' | 'translation' | 'rotation' | 'fillet' | 'chamfer' | 'draft';
export type GaugeVerificationStatus = 'invalidated' | 'not_run';

export interface GaugeAxisFrame {
  axis: readonly [number, number, number] | null;
  coordinateFrame: string;
}

export interface GaugeViewModelV1 {
  schema: typeof GAUGE_VIEW_MODEL_SCHEMA;
  gaugeId: string;
  type: GaugeType;
  selection: SelectionContext;
  binding: DirectManipulationBinding;
  currentValue: number;
  targetValue: number;
  delta: number;
  unit: DirectManipulationUnit;
  snapIncrement: number | null;
  range: { min: number | null; max: number | null };
  axisFrame: GaugeAxisFrame;
  visible: boolean;
  primary: boolean;
  requiresConfirmation: boolean;
  confirmationReasons: readonly string[];
  invalidatedVerification: Readonly<Record<'geometry' | 'topology' | 'manufacturing', GaugeVerificationStatus>>;
  baseRevision: string;
  intentId: string;
}

export interface GaugeViewModelOptions {
  gaugeId?: string;
  visible?: boolean;
  primary?: boolean;
  axis?: readonly [number, number, number] | null;
  coordinateFrame?: string;
  min?: number | null;
  max?: number | null;
  snapIncrement?: number | null;
  confirmationReasons?: readonly string[];
}

const parameterType = (parameter: string): GaugeType => {
  const name = parameter.toLowerCase();
  if (name.includes('diameter') || name === 'dia' || name.startsWith('d_')) return 'diameter';
  if (name.includes('radius') || name === 'r') return 'radius';
  if (name.includes('angle') || name.includes('degree')) return 'angle';
  return 'length';
};

function gaugeType(binding: DirectManipulationBinding): GaugeType {
  switch (binding.kind) {
    case 'edge_fillet': return 'fillet';
    case 'edge_chamfer': return 'chamfer';
    case 'face_draft': return 'draft';
    case 'occurrence_translate': return 'translation';
    case 'occurrence_rotate': return 'rotation';
    case 'face_offset': return 'length';
    case 'feature_parameter': return parameterType(binding.parameter);
    case 'sketch_dimension': return binding.unit === 'deg' ? 'angle' : parameterType(binding.sketchId);
  }
}

function defaultRange(type: GaugeType, unit: DirectManipulationUnit): { min: number | null; max: number | null } {
  if (type === 'fillet' || type === 'chamfer' || type === 'radius' || type === 'diameter') return { min: 0, max: null };
  if (type === 'draft') return { min: -89.999, max: 89.999 };
  if (type === 'angle' || unit === 'deg') return { min: -360000, max: 360000 };
  return { min: null, max: null };
}

function bindingAxis(binding: DirectManipulationBinding): readonly [number, number, number] | null {
  if (binding.kind === 'occurrence_translate' || binding.kind === 'occurrence_rotate') return binding.axis;
  if (binding.kind === 'face_draft') return binding.pullDirection;
  return null;
}

/** Creates a UI-safe gauge directly from the validated intent's selection/binding. */
export function createGaugeViewModel(intent: DirectManipulationIntent, options: GaugeViewModelOptions = {}): GaugeViewModelV1 {
  const type = gaugeType(intent.binding);
  const range = defaultRange(type, intent.measurement.unit);
  const reasons = [
    ...(selectionRequiresConfirmation(intent.selection) ? ['selection_reference_requires_confirmation'] : []),
    ...((intent.assumptions?.length ?? 0) > 0 ? ['ai_assumptions_require_confirmation'] : []),
    ...(options.confirmationReasons ?? []),
  ];
  const axis = options.axis === undefined ? bindingAxis(intent.binding) : options.axis;
  return {
    schema: GAUGE_VIEW_MODEL_SCHEMA,
    gaugeId: options.gaugeId ?? `gauge:${intent.intentId}`,
    type,
    selection: structuredClone(intent.selection),
    binding: structuredClone(intent.binding),
    currentValue: intent.measurement.startValue,
    targetValue: intent.measurement.targetValue,
    delta: intent.measurement.delta,
    unit: intent.measurement.unit,
    snapIncrement: options.snapIncrement === undefined ? intent.measurement.snapIncrement ?? null : options.snapIncrement,
    range: { min: options.min === undefined ? range.min : options.min, max: options.max === undefined ? range.max : options.max },
    axisFrame: { axis: axis ? [...axis] as [number, number, number] : null, coordinateFrame: options.coordinateFrame ?? intent.coordinateFrame },
    visible: options.visible ?? true,
    primary: options.primary ?? true,
    requiresConfirmation: reasons.length > 0,
    confirmationReasons: [...new Set(reasons)],
    invalidatedVerification: { geometry: 'invalidated', topology: 'invalidated', manufacturing: 'invalidated' },
    baseRevision: intent.baseRevision,
    intentId: intent.intentId,
  };
}

export const gaugeViewModelFromIntent = createGaugeViewModel;

export function updateGaugeTarget(gauge: GaugeViewModelV1, targetValue: number): GaugeViewModelV1 {
  if (!Number.isFinite(targetValue)) return gauge;
  const increment = gauge.snapIncrement !== null && Number.isFinite(gauge.snapIncrement) && gauge.snapIncrement > 0
    ? gauge.snapIncrement
    : null;
  const snapped = increment === null ? targetValue : Math.round(targetValue / increment) * increment;
  if ((gauge.range.min !== null && snapped < gauge.range.min) || (gauge.range.max !== null && snapped > gauge.range.max)) return gauge;
  const delta = snapped - gauge.currentValue;
  return { ...gauge, targetValue: snapped, delta, invalidatedVerification: { geometry: 'invalidated', topology: 'invalidated', manufacturing: 'invalidated' } };
}

/** Explicit result form for shells that need to show why a target was rejected. */
export function tryUpdateGaugeTarget(gauge: GaugeViewModelV1, targetValue: number):
  | { ok: true; gauge: GaugeViewModelV1 }
  | { ok: false; issues: readonly string[] } {
  if (!Number.isFinite(targetValue)) return { ok: false, issues: ['target_not_finite'] };
  const next = updateGaugeTarget(gauge, targetValue);
  if (next === gauge) return { ok: false, issues: ['target_out_of_range_or_invalid_snap'] };
  return { ok: true, gauge: next };
}

export function setGaugeVisibility(gauge: GaugeViewModelV1, visible: boolean, primary = gauge.primary): GaugeViewModelV1 {
  return { ...gauge, visible, primary };
}
