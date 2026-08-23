/**
 * Commercial mechanical-core feature contract.
 *
 * This is deliberately a fixed list. Adding a feature elsewhere in the
 * modeler does not expand the commercial claim until the feature has a
 * three-cycle, revision-bound receipt covering both NFAB and STEP.
 */

export const MECHANICAL_CORE_FEATURE_CONTRACT_SCHEMA =
  'nexyfab.mechanical-core-feature-contract.v1' as const;
export const MECHANICAL_CORE_FEATURE_RECEIPT_SCHEMA =
  'nexyfab.mechanical-core-feature-closed-loop.v1' as const;
export const MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA =
  'nexyfab.mechanical-core-feature-local-axis-evidence.v1' as const;
export const MECHANICAL_CORE_LOCAL_ASSESSMENT_SCHEMA =
  'nexyfab.mechanical-core-feature-local-assessment.v1' as const;

export const MECHANICAL_CORE_30_FEATURES = [
  'hole',
  'fillet',
  'chamfer',
  'shell',
  'rib',
  'linearPattern',
  'circularPattern',
  'draft',
  'scale',
  'moveCopy',
  'variableFillet',
  'offsetFace',
  'thread',
  'helix',
  'bend',
  'flange',
  'hem',
  'jog',
  'tab',
  'cut',
  'bendRelief',
  'cornerRelief',
  'variableShell',
  'sketchExtrude',
  'revolve',
  'sweep',
  'loft',
  'mirror',
  'boolean',
  'splitBody',
] as const;

export type MechanicalCoreFeatureId = (typeof MECHANICAL_CORE_30_FEATURES)[number];

/**
 * A feature is not considered locally closed-loop until every axis below has
 * been executed for that same feature and revision.  Keeping this list fixed
 * prevents a registry/geometry smoke test from being presented as evidence of
 * persistence, undo, exchange, or drawing behavior.
 */
export const MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES = [
  'create',
  'edit',
  'regenerate',
  'save_reopen',
  'undo',
  'export',
  'drawing',
] as const;

export type MechanicalCoreLocalClosedLoopAxis =
  (typeof MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES)[number];
export type MechanicalCoreLocalAxisStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface MechanicalCoreLocalEvidenceBindingV1 {
  /** Repository-relative path to an immutable test result or artifact. */
  path: string;
  sha256: string;
  /** Exact bytes written for the artifact when the producing runner records it. */
  bytes: number;
  /** Stable assertion/case identifier inside the bound artifact. */
  assertionId: string;
}

export interface MechanicalCoreLocalSelectionIdentityV1 {
  featureFamily: MechanicalCoreFeatureId;
  /** Stable feature object identifier within the saved design. */
  featureId: string;
  selectionId: string;
  identitySha256: string;
  preserved: boolean;
  topologySilentRemapCount: number;
}

export interface MechanicalCoreLocalAxisRunV1 {
  feature: MechanicalCoreFeatureId;
  axis: MechanicalCoreLocalClosedLoopAxis;
  status: MechanicalCoreLocalAxisStatus;
  executedAt: string | null;
  evidence: readonly MechanicalCoreLocalEvidenceBindingV1[];
  /** Stable feature/selection identity evidence, independent of commercial CAD claims. */
  selectionIdentity?: MechanicalCoreLocalSelectionIdentityV1;
  /** Source revision bound to this individual axis run. */
  designRevisionSha256?: string;
  detail?: string;
}

export interface MechanicalCoreLocalAxisEvidenceV1 {
  schema: typeof MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA;
  generatedAt: string;
  designRevisionSha256: string;
  runs: readonly MechanicalCoreLocalAxisRunV1[];
}

export interface MechanicalCoreLocalAxisDecision {
  axis: MechanicalCoreLocalClosedLoopAxis;
  status: MechanicalCoreLocalAxisStatus;
  evidenceCount: number;
  blockers: string[];
}

export interface MechanicalCoreLocalFeatureDecision {
  feature: MechanicalCoreFeatureId;
  status: MechanicalCoreLocalAxisStatus;
  passedAxes: number;
  requiredAxes: number;
  axes: readonly MechanicalCoreLocalAxisDecision[];
}

export interface MechanicalCoreLocalClosedLoopDecision {
  schema: typeof MECHANICAL_CORE_LOCAL_ASSESSMENT_SCHEMA;
  eligible: boolean;
  requiredFeatures: number;
  passedFeatures: number;
  requiredAxesPerFeature: number;
  axisTotals: Record<MechanicalCoreLocalAxisStatus, number>;
  cases: readonly MechanicalCoreLocalFeatureDecision[];
  blockers: string[];
}

export interface MechanicalCoreLocalEvaluationOptions {
  /**
   * Bindings independently verified by the caller against bytes on disk.
   * A PASS receipt is deliberately downgraded to FAIL when this callback is
   * absent or returns false.
   */
  verifyEvidenceBinding?: (binding: MechanicalCoreLocalEvidenceBindingV1) => boolean;
  /** Recompute the stable identity digest rather than trusting a receipt boolean/hash. */
  verifySelectionIdentity?: (identity: MechanicalCoreLocalSelectionIdentityV1) => boolean;
}

export function mechanicalCoreSelectionIdentityPayload(
  identity: Pick<MechanicalCoreLocalSelectionIdentityV1, 'featureFamily' | 'featureId' | 'selectionId'>,
): string {
  return `${identity.featureFamily}\0${identity.featureId}\0${identity.selectionId}`;
}

export const MECHANICAL_CORE_AI_EDITABLE_FEATURES: ReadonlySet<string> =
  new Set<string>(MECHANICAL_CORE_30_FEATURES);

export interface MechanicalCoreFeatureCaseV1 {
  feature: MechanicalCoreFeatureId;
  cycles: number;
  status: 'pass' | 'fail' | 'not_run';
  checks: {
    manualEditApplied: boolean;
    aiPatchApplied: boolean;
    nfabRoundtrip: boolean;
    stepRoundtrip: boolean;
    stableIdsPreserved: boolean;
    lockedValuesPreserved: boolean;
    selectionBindingsPreserved: boolean;
    topologySilentRemapCount: number;
  };
}

export interface MechanicalCoreFeatureClosedLoopReceiptV1 {
  schema: typeof MECHANICAL_CORE_FEATURE_RECEIPT_SCHEMA;
  releaseChannel: 'mechanical-core';
  generatedAt: string;
  designRevisionSha256: string;
  sourceEvidenceSha256: string;
  cases: readonly MechanicalCoreFeatureCaseV1[];
}

export interface MechanicalCoreFeatureContractDecision {
  schema: typeof MECHANICAL_CORE_FEATURE_CONTRACT_SCHEMA;
  eligible: boolean;
  required: number;
  passed: number;
  blockers: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

export function isMechanicalCoreFeatureId(value: string): value is MechanicalCoreFeatureId {
  return (MECHANICAL_CORE_30_FEATURES as readonly string[]).includes(value);
}

export function isMechanicalCoreLocalClosedLoopAxis(
  value: string,
): value is MechanicalCoreLocalClosedLoopAxis {
  return (MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES as readonly string[]).includes(value);
}

function validLocalEvidenceBinding(binding: MechanicalCoreLocalEvidenceBindingV1 | undefined): boolean {
  return Boolean(
    binding
    && typeof binding.path === 'string'
    && binding.path.trim().length > 0
    && !binding.path.replaceAll('\\', '/').split('/').includes('..')
    && !/^[a-zA-Z]:[\\/]/.test(binding.path)
    && !binding.path.startsWith('/')
    && SHA256.test(binding.sha256)
    && Number.isSafeInteger(binding.bytes)
    && binding.bytes > 0
    && typeof binding.assertionId === 'string'
    && binding.assertionId.trim().length > 0,
  );
}

const REQUIRED_LOCAL_ASSERTIONS: Readonly<Record<MechanicalCoreLocalClosedLoopAxis, readonly string[]>> = Object.freeze({
  create: ['.create.exact-solid'],
  edit: ['.edit.history-transition'],
  regenerate: ['.regenerate.native-repeat'],
  save_reopen: ['.save_reopen.saved-bytes', '.save_reopen.exact-roundtrip'],
  undo: ['.undo.exact-restore'],
  export: ['.export.native-step', '.export.step-reimport'],
  drawing: ['.drawing.three-view-hlr'],
});

export function requiredMechanicalCoreLocalAssertionSuffixes(
  axis: MechanicalCoreLocalClosedLoopAxis,
): readonly string[] {
  return REQUIRED_LOCAL_ASSERTIONS[axis];
}

/**
 * Evaluate local 30-feature evidence without inheriting any external or
 * commercial approval. Missing feature/axis records remain NOT_RUN. A claimed
 * PASS requires a timestamp, at least one structurally valid artifact binding,
 * and independent byte verification supplied by the caller.
 */
export function evaluateMechanicalCoreFeatureLocalClosedLoop(
  receipt: MechanicalCoreLocalAxisEvidenceV1 | null | undefined,
  options: MechanicalCoreLocalEvaluationOptions = {},
): MechanicalCoreLocalClosedLoopDecision {
  const blockers: string[] = [];
  if (receipt?.schema !== MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA) {
    blockers.push('local_axis_receipt_schema_invalid');
  }
  if (!Number.isFinite(Date.parse(receipt?.generatedAt ?? ''))) {
    blockers.push('local_axis_receipt_time_invalid');
  }
  if (!SHA256.test(receipt?.designRevisionSha256 ?? '')) {
    blockers.push('local_axis_receipt_revision_invalid');
  }

  const runs = Array.isArray(receipt?.runs) ? receipt.runs : [];
  for (const run of runs) {
    if (!isMechanicalCoreFeatureId(String(run?.feature))) {
      blockers.push(`local_axis_unknown_feature:${String(run?.feature)}`);
    }
    if (!isMechanicalCoreLocalClosedLoopAxis(String(run?.axis))) {
      blockers.push(`local_axis_unknown_axis:${String(run?.axis)}`);
    }
  }

  const cases: MechanicalCoreLocalFeatureDecision[] = MECHANICAL_CORE_30_FEATURES.map(feature => {
    const axes: MechanicalCoreLocalAxisDecision[] = MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.map(axis => {
      const matches = runs.filter(run => run?.feature === feature && run?.axis === axis);
      const axisBlockers: string[] = [];
      if (matches.length === 0) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:not_run`);
        return { axis, status: 'NOT_RUN', evidenceCount: 0, blockers: axisBlockers };
      }
      if (matches.length > 1) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:duplicate`);
        return {
          axis,
          status: 'FAIL',
          evidenceCount: matches.reduce((sum, item) => sum + (item.evidence?.length ?? 0), 0),
          blockers: axisBlockers,
        };
      }

      const run = matches[0]!;
      const evidence: readonly MechanicalCoreLocalEvidenceBindingV1[] = Array.isArray(run.evidence) ? run.evidence : [];
      if (run.status === 'NOT_RUN') {
        axisBlockers.push(`feature:${feature}:axis:${axis}:not_run`);
        return { axis, status: 'NOT_RUN', evidenceCount: evidence.length, blockers: axisBlockers };
      }
      if (run.status !== 'PASS') {
        axisBlockers.push(`feature:${feature}:axis:${axis}:status:${String(run.status).toLowerCase()}`);
        return { axis, status: 'FAIL', evidenceCount: evidence.length, blockers: axisBlockers };
      }

      if (!Number.isFinite(Date.parse(run.executedAt ?? ''))) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:executed_at_invalid`);
      }
      if (evidence.length === 0) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:evidence_missing`);
      }
      for (const binding of evidence) {
        if (!validLocalEvidenceBinding(binding)) {
          axisBlockers.push(`feature:${feature}:axis:${axis}:binding_invalid`);
        } else if (!options.verifyEvidenceBinding?.(binding)) {
          axisBlockers.push(`feature:${feature}:axis:${axis}:binding_unverified`);
        }
      }
      const requiredAssertions = REQUIRED_LOCAL_ASSERTIONS[axis];
      for (const suffix of requiredAssertions) {
        if (!evidence.some(binding => binding.assertionId.endsWith(suffix))) {
          axisBlockers.push(`feature:${feature}:axis:${axis}:assertion_missing:${suffix}`);
        }
      }
      const selection = run.selectionIdentity;
      if (!selection
        || selection.featureFamily !== feature
        || typeof selection.featureId !== 'string'
        || !selection.featureId.trim()
        || typeof selection.selectionId !== 'string'
        || !selection.selectionId.trim()
        || !SHA256.test(selection.identitySha256)
        || selection.preserved !== true
        || selection.topologySilentRemapCount !== 0) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:selection_identity_invalid`);
      } else if (!options.verifySelectionIdentity?.(selection)) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:selection_identity_unverified`);
      }
      if (run.designRevisionSha256 !== receipt?.designRevisionSha256) {
        axisBlockers.push(`feature:${feature}:axis:${axis}:revision_binding_invalid`);
      }
      return {
        axis,
        status: axisBlockers.length === 0 ? 'PASS' : 'FAIL',
        evidenceCount: evidence.length,
        blockers: [...new Set(axisBlockers)],
      };
    });
    const passedAxes = axes.filter(axis => axis.status === 'PASS').length;
    const status: MechanicalCoreLocalAxisStatus = passedAxes === axes.length
      ? 'PASS'
      : axes.some(axis => axis.status === 'FAIL') ? 'FAIL' : 'NOT_RUN';
    return {
      feature,
      status,
      passedAxes,
      requiredAxes: MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.length,
      axes,
    };
  });

  const axisTotals: Record<MechanicalCoreLocalAxisStatus, number> = {
    PASS: 0,
    FAIL: 0,
    NOT_RUN: 0,
  };
  for (const item of cases) {
    for (const axis of item.axes) {
      axisTotals[axis.status] += 1;
      blockers.push(...axis.blockers);
    }
  }
  const uniqueBlockers = [...new Set(blockers)];
  const passedFeatures = cases.filter(item => item.status === 'PASS').length;
  return {
    schema: MECHANICAL_CORE_LOCAL_ASSESSMENT_SCHEMA,
    eligible: uniqueBlockers.length === 0 && passedFeatures === MECHANICAL_CORE_30_FEATURES.length,
    requiredFeatures: MECHANICAL_CORE_30_FEATURES.length,
    passedFeatures,
    requiredAxesPerFeature: MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.length,
    axisTotals,
    cases,
    blockers: uniqueBlockers,
  };
}

/** Fail-closed assessment used by release evidence and UI claims. */
export function evaluateMechanicalCoreFeatureClosedLoop(
  receipt: MechanicalCoreFeatureClosedLoopReceiptV1 | null | undefined,
): MechanicalCoreFeatureContractDecision {
  const blockers: string[] = [];
  if (receipt?.schema !== MECHANICAL_CORE_FEATURE_RECEIPT_SCHEMA) blockers.push('feature_receipt_schema_invalid');
  if (receipt?.releaseChannel !== 'mechanical-core') blockers.push('feature_receipt_channel_invalid');
  if (!Number.isFinite(Date.parse(receipt?.generatedAt ?? ''))) blockers.push('feature_receipt_time_invalid');
  if (!SHA256.test(receipt?.designRevisionSha256 ?? '')) blockers.push('feature_receipt_revision_invalid');
  if (!SHA256.test(receipt?.sourceEvidenceSha256 ?? '')) blockers.push('feature_receipt_source_invalid');

  const cases = Array.isArray(receipt?.cases) ? receipt.cases : [];
  const counts = new Map<string, number>();
  for (const item of cases) counts.set(String(item?.feature), (counts.get(String(item?.feature)) ?? 0) + 1);
  for (const feature of MECHANICAL_CORE_30_FEATURES) {
    const matches = cases.filter(item => item?.feature === feature);
    if (matches.length !== 1) {
      blockers.push(`feature:${feature}:${matches.length ? 'duplicate' : 'missing'}`);
      continue;
    }
    const item = matches[0]!;
    const checks = item.checks;
    if (item.status !== 'pass') blockers.push(`feature:${feature}:status:${item.status}`);
    if (item.cycles !== 3) blockers.push(`feature:${feature}:cycles`);
    for (const [key, value] of Object.entries({
      manualEditApplied: checks?.manualEditApplied,
      aiPatchApplied: checks?.aiPatchApplied,
      nfabRoundtrip: checks?.nfabRoundtrip,
      stepRoundtrip: checks?.stepRoundtrip,
      stableIdsPreserved: checks?.stableIdsPreserved,
      lockedValuesPreserved: checks?.lockedValuesPreserved,
      selectionBindingsPreserved: checks?.selectionBindingsPreserved,
    })) {
      if (value !== true) blockers.push(`feature:${feature}:check:${key}`);
    }
    if (checks?.topologySilentRemapCount !== 0) blockers.push(`feature:${feature}:topology_silent_remap`);
  }
  for (const [feature, count] of counts) {
    if (!isMechanicalCoreFeatureId(feature)) blockers.push(`feature:unknown:${feature}`);
    if (count > 1 && isMechanicalCoreFeatureId(feature)) blockers.push(`feature:${feature}:duplicate`);
  }
  if (cases.length !== MECHANICAL_CORE_30_FEATURES.length) blockers.push(`feature_case_count:${cases.length}/30`);

  const uniqueBlockers = [...new Set(blockers)];
  const passed = MECHANICAL_CORE_30_FEATURES.filter(feature => {
    const item = cases.find(candidate => candidate.feature === feature);
    return item?.status === 'pass'
      && item.cycles === 3
      && item.checks?.manualEditApplied === true
      && item.checks?.aiPatchApplied === true
      && item.checks?.nfabRoundtrip === true
      && item.checks?.stepRoundtrip === true
      && item.checks?.stableIdsPreserved === true
      && item.checks?.lockedValuesPreserved === true
      && item.checks?.selectionBindingsPreserved === true
      && item.checks?.topologySilentRemapCount === 0;
  }).length;
  return {
    schema: MECHANICAL_CORE_FEATURE_CONTRACT_SCHEMA,
    eligible: uniqueBlockers.length === 0,
    required: MECHANICAL_CORE_30_FEATURES.length,
    passed,
    blockers: uniqueBlockers,
  };
}
