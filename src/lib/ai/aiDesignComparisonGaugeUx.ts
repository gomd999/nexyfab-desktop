import {
  applyPartialDesignCandidate,
  type CandidateComparisonViewModel,
  type CandidateEvidenceStatus,
  type CandidateMetric,
  type DesignCandidate,
} from './designCandidateComparison';
import { tryUpdateGaugeTarget, type GaugeViewModelV1 } from './gaugeViewModel';

export const AI_DESIGN_COMPARISON_GAUGE_UX_SCHEMA = 'nexyfab.ai-design-comparison-gauge-ux.v1' as const;
export type UxMetricCategory = 'requirements' | 'dimensions' | 'manufacturing' | 'cost';
export type UxChangeState = 'changed' | 'unchanged' | 'unknown';

export interface ComparisonMatrixCell {
  candidateId: string;
  metricId: string;
  label: string;
  category: UxMetricCategory;
  value: number | string | null;
  unit?: string;
  change: UxChangeState;
  metricStatus: CandidateEvidenceStatus;
  sourceEvidenceStatus: CandidateEvidenceStatus | null;
  /** Worst-case combination of the metric claim and its bound evidence. */
  evidenceStatus: CandidateEvidenceStatus;
  evidenceId?: string;
  /** Cost values are estimates unless a verified cost receipt explicitly says otherwise. */
  estimated: boolean;
  displayValue: string;
}

export interface ComparisonMatrixRow {
  metricId: string;
  label: string;
  category: UxMetricCategory;
  cells: readonly ComparisonMatrixCell[];
}

export interface ComparisonMatrixViewModel {
  schema: typeof AI_DESIGN_COMPARISON_GAUGE_UX_SCHEMA;
  candidates: readonly DesignCandidate[];
  rows: readonly ComparisonMatrixRow[];
}

export interface PartialApplyUxResult {
  ok: boolean;
  candidateId: string;
  featureIds: readonly string[];
  blockedReasons: readonly string[];
  actionId?: string;
}

const statuses: CandidateEvidenceStatus[] = ['verified', 'failed', 'unknown', 'not_run'];
const isStatus = (value: unknown): value is CandidateEvidenceStatus => statuses.includes(value as CandidateEvidenceStatus);
const metricCategory = (metric: CandidateMetric): UxMetricCategory => {
  const extended = metric as CandidateMetric & { category?: UxMetricCategory; estimated?: boolean };
  if (extended.category) return extended.category;
  const text = `${metric.metricId} ${metric.label}`.toLowerCase();
  if (/cost|price|원|usd|eur|비용|가격/.test(text)) return 'cost';
  if (/manufact|dfm|machin|fabricat|제조|가공/.test(text)) return 'manufacturing';
  if (/dimension|length|width|height|diameter|radius|size|치수|길이|폭|높이/.test(text)) return 'dimensions';
  return 'requirements';
};
const metricEstimated = (candidate: DesignCandidate, metric: CandidateMetric): boolean => {
  const extended = metric as CandidateMetric & { estimated?: boolean; source?: string };
  if (metricCategory(metric) !== 'cost') return false;
  const source = candidate.evidence.find(item => item.evidenceId === metric.evidenceId);
  return !(extended.estimated === false && metric.status === 'verified' && source?.status === 'verified');
};
const statusFor = (candidate: DesignCandidate, metric: CandidateMetric): CandidateEvidenceStatus => {
  const metricStatus = isStatus(metric.status) ? metric.status : 'unknown';
  const sourceStatus = candidate.evidence.find(item => item.evidenceId === metric.evidenceId)?.status;
  if (!sourceStatus) return metricStatus;
  if (metricStatus === 'failed' || sourceStatus === 'failed') return 'failed';
  if (metricStatus === 'unknown' || sourceStatus === 'unknown') return 'unknown';
  if (metricStatus === 'not_run' || sourceStatus === 'not_run') return 'not_run';
  return 'verified';
};
const sameValue = (a: CandidateMetric, b: CandidateMetric): boolean => a.value === b.value && a.unit === b.unit;
const display = (metric: CandidateMetric, status: CandidateEvidenceStatus, estimated: boolean): string => {
  const value = metric.value === null || metric.value === undefined ? 'Unknown' : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
  if (status !== 'verified') return `${value} · ${status.replace('_', ' ')}`;
  if (estimated) return `${value} · estimated`;
  return value;
};

/** Creates a max-three-candidate matrix while retaining evidence status verbatim. */
export function createComparisonMatrix(model: CandidateComparisonViewModel): ComparisonMatrixViewModel {
  const candidates = model.candidates.slice(0, 3);
  const byId = new Map<string, CandidateMetric>();
  const rows = new Map<string, { label: string; category: UxMetricCategory }>();
  for (const candidate of candidates) for (const metric of candidate.metrics) {
    if (!rows.has(metric.metricId)) rows.set(metric.metricId, { label: metric.label, category: metricCategory(metric) });
    byId.set(`${candidate.candidateId}:${metric.metricId}`, metric);
  }
  return {
    schema: AI_DESIGN_COMPARISON_GAUGE_UX_SCHEMA,
    candidates,
    rows: [...rows.entries()].map(([metricId, meta]) => {
      const present = candidates.map(candidate => byId.get(`${candidate.candidateId}:${metricId}`));
      const first = present.find(Boolean);
      return { metricId, ...meta, cells: candidates.map((candidate, index) => {
        const metric = present[index];
        const evidenceStatus = metric ? statusFor(candidate, metric) : 'unknown';
        const estimated = metric ? metricEstimated(candidate, metric) : meta.category === 'cost';
        const comparable = !!metric && !!first && evidenceStatus === 'verified'
          && statusFor(candidates[present.indexOf(first)]!, first!) === 'verified';
        return {
          candidateId: candidate.candidateId, metricId, label: meta.label, category: meta.category,
          value: metric?.value ?? null, unit: metric?.unit,
          metricStatus: metric && isStatus(metric.status) ? metric.status : 'unknown',
          sourceEvidenceStatus: metric?.evidenceId ? candidate.evidence.find(item => item.evidenceId === metric.evidenceId)?.status ?? 'unknown' : null,
          evidenceStatus,
          change: comparable && sameValue(metric!, first!) ? 'unchanged' : comparable ? 'changed' : 'unknown',
          evidenceId: metric?.evidenceId, estimated, displayValue: metric ? display(metric, evidenceStatus, estimated) : 'Unknown · not run',
        };
      }) };
    }),
  };
}

export function applyPartialCandidateForUx(model: CandidateComparisonViewModel, candidateId: string, featureIds: readonly string[], currentRevision = model.baseRevision): PartialApplyUxResult {
  const result = applyPartialDesignCandidate(model, candidateId, featureIds, currentRevision);
  if (result.ok) return { ok: true, candidateId, featureIds: result.featureIds, blockedReasons: [], actionId: result.actionId };
  const candidate = model.candidates.find(item => item.candidateId === candidateId);
  const reasons = [...result.issues];
  if (currentRevision !== model.baseRevision && !reasons.includes('stale_workspace_revision')) reasons.unshift('stale_workspace_revision');
  if (candidate) {
    const available = new Set(candidate.featureIds);
    const outside = featureIds.filter(id => !available.has(id));
    if (outside.length) reasons.push('feature_outside_candidate', ...outside);
    if ([...candidate.metrics, ...candidate.evidence].some(item => item.status === 'unknown' || item.status === 'not_run')) reasons.push('verification_incomplete');
    if ([...candidate.metrics, ...candidate.evidence].some(item => item.status === 'failed')) reasons.push('contains_failed_evidence');
  }
  return { ok: false, candidateId, featureIds: [...featureIds], blockedReasons: [...new Set(reasons)] };
}

export type GaugeFrame = 'local' | 'global';
export type GaugeStepMode = 'fine' | 'coarse';
export interface GaugeUxOptions {
  editable?: boolean;
  selectionRelevance?: number;
  frame?: GaugeFrame;
  axisLock?: boolean;
  fineStep?: number;
  coarseStep?: number;
  mobile?: boolean;
  reducedMotion?: boolean;
  stale?: boolean;
  selectionValid?: boolean;
  topologyWillInvalidate?: boolean;
  rangeWarning?: boolean;
  snapWarning?: boolean;
}
export interface GaugeUxViewModel extends GaugeViewModelV1 {
  editable: boolean;
  selectionRelevance: number;
  frame: GaugeFrame;
  axisLock: boolean;
  steps: { fine: number; coarse: number };
  touchTargetPx: 44;
  reducedMotion: boolean;
  nonColorLabels: readonly string[];
  preflightWarnings: readonly string[];
}

export function createGaugeUxViewModel(gauge: GaugeViewModelV1, options: GaugeUxOptions = {}): GaugeUxViewModel {
  const requestedFine = options.fineStep ?? gauge.snapIncrement ?? 0.1;
  const fine = Number.isFinite(requestedFine) && requestedFine > 0 ? requestedFine : 0.1;
  const requestedCoarse = options.coarseStep ?? fine * 10;
  const coarse = Number.isFinite(requestedCoarse) && requestedCoarse >= fine ? requestedCoarse : fine * 10;
  const warnings = [
    ...(gauge.requiresConfirmation ? ['confirmation_required'] : []),
    ...(options.topologyWillInvalidate ? ['topology_verification_will_be_invalidated'] : []),
    ...(options.stale ? ['stale_workspace_revision'] : []),
    ...(options.selectionValid === false ? ['selection_scope_invalid'] : []),
    ...(options.rangeWarning ? ['range_limit'] : []),
    ...(options.snapWarning ? ['snap_adjustment'] : []),
  ];
  return { ...gauge, editable: options.editable ?? true, selectionRelevance: options.selectionRelevance ?? 0,
    frame: options.frame ?? (gauge.axisFrame.coordinateFrame === 'world' ? 'global' : 'local'), axisLock: options.axisLock ?? !!gauge.axisFrame.axis,
    steps: { fine, coarse }, touchTargetPx: 44, reducedMotion: options.reducedMotion ?? false,
    nonColorLabels: ['verified', 'failed', 'unknown', 'not_run', 'changed', 'unchanged'], preflightWarnings: [...new Set(warnings)] };
}

export function selectPrimaryGauge(gauges: readonly GaugeUxViewModel[]): GaugeUxViewModel | null {
  return [...gauges].filter(g => g.visible).sort((a, b) => Number(b.editable) - Number(a.editable) || b.selectionRelevance - a.selectionRelevance || a.gaugeId.localeCompare(b.gaugeId))[0] ?? null;
}

export function adjustGaugeByStep(gauge: GaugeUxViewModel, mode: GaugeStepMode, direction: 1 | -1): { ok: true; gauge: GaugeUxViewModel } | { ok: false; issues: readonly string[] } {
  const result = tryUpdateGaugeTarget(gauge, gauge.targetValue + gauge.steps[mode] * direction);
  return result.ok ? { ok: true, gauge: { ...gauge, ...result.gauge } } : result;
}

export function gaugeTouchAction(gauge: GaugeUxViewModel, action: 'increment' | 'decrement', mode: GaugeStepMode = 'fine') {
  return adjustGaugeByStep(gauge, mode, action === 'increment' ? 1 : -1);
}
