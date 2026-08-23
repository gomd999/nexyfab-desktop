/** STEP-first interoperability contract for the standalone mechanical CAD. */

export const MECHANICAL_STEP_INTEROP_RECEIPT_SCHEMA =
  'nexyfab.mechanical-step-interoperability-receipt.v2' as const;
export const MECHANICAL_STEP_INTEROP_ASSESSMENT_SCHEMA =
  'nexyfab.mechanical-step-interoperability-assessment.v2' as const;

export const STEP_COMPATIBILITY_LEVELS = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type StepCompatibilityLevel = (typeof STEP_COMPATIBILITY_LEVELS)[number];

export const REQUIRED_STEP_TARGETS = ['nexyfab', 'independent-step-parser'] as const;
export const OPTIONAL_VENDOR_STEP_TARGETS = ['solidworks', 'fusion', 'onshape', 'nx', 'creo'] as const;
export type RequiredStepTarget = (typeof REQUIRED_STEP_TARGETS)[number];
export type OptionalVendorStepTarget = (typeof OPTIONAL_VENDOR_STEP_TARGETS)[number];
export type StepInteropTarget = RequiredStepTarget | OptionalVendorStepTarget;

export const STEP_INTEROP_CHECKS = {
  C0: ['opened'],
  C1: ['schema_conformance', 'valid_brep', 'body_count', 'units', 'bounding_box', 'volume', 'surface_area'],
  C2: ['product_structure', 'occurrence_transforms'],
  C3: ['component_names', 'part_numbers', 'attributes'],
  C4: ['returned_reimport', 'geometry_diff', 'revision_binding'],
  C5: ['native_feature_history'],
} as const satisfies Record<StepCompatibilityLevel, readonly string[]>;

export interface MechanicalStepInteropCheckV1 {
  id: string;
  status: 'pass' | 'fail' | 'not_run';
  expected?: string | number;
  actual?: string | number;
  tolerance?: number;
}

export interface MechanicalStepInteropReceiptV1 {
  schema: typeof MECHANICAL_STEP_INTEROP_RECEIPT_SCHEMA;
  releaseChannel: 'mechanical-core';
  target: StepInteropTarget;
  targetVersion: string;
  protocol: 'AP203' | 'AP214' | 'AP242';
  modelKind: 'assembly';
  requestedLevel: StepCompatibilityLevel;
  executionMode: 'kernel_self_test' | 'independent_parser' | 'native_application' | 'official_cloud_import';
  designRevisionSha256: string;
  sourceArtifactSha256: string;
  openedArtifactSha256: string;
  returnedArtifactSha256: string;
  evidenceBundleSha256: string;
  operatorId: string;
  operatorSignatureRef: string;
  executedAt: string;
  checks: readonly MechanicalStepInteropCheckV1[];
}

export interface MechanicalStepInteropAssessmentV1 {
  schema: typeof MECHANICAL_STEP_INTEROP_ASSESSMENT_SCHEMA;
  releaseChannel: 'mechanical-core';
  requiredLevel: 'C4';
  verifiedLevel: StepCompatibilityLevel | null;
  verifiedTargets: StepInteropTarget[];
  eligible: boolean;
  blockers: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

function checksThrough(level: StepCompatibilityLevel): string[] {
  const max = STEP_COMPATIBILITY_LEVELS.indexOf(level);
  return STEP_COMPATIBILITY_LEVELS
    .slice(0, max + 1)
    .flatMap(item => [...STEP_INTEROP_CHECKS[item]]);
}

function receiptBlockers(receipt: MechanicalStepInteropReceiptV1, requiredLevel: StepCompatibilityLevel): string[] {
  const prefix = `target:${receipt?.target ?? 'missing'}`;
  const blockers: string[] = [];
  if (receipt?.schema !== MECHANICAL_STEP_INTEROP_RECEIPT_SCHEMA) blockers.push(`${prefix}:schema`);
  if (receipt?.releaseChannel !== 'mechanical-core') blockers.push(`${prefix}:channel`);
  if (!(STEP_COMPATIBILITY_LEVELS as readonly string[]).includes(receipt?.requestedLevel)) blockers.push(`${prefix}:level`);
  if (STEP_COMPATIBILITY_LEVELS.indexOf(receipt?.requestedLevel) < STEP_COMPATIBILITY_LEVELS.indexOf(requiredLevel)) {
    blockers.push(`${prefix}:level_below_${requiredLevel}`);
  }
  if (receipt?.protocol !== 'AP214' && receipt?.protocol !== 'AP242') blockers.push(`${prefix}:protocol`);
  if (receipt?.modelKind !== 'assembly') blockers.push(`${prefix}:assembly_required`);
  if (!receipt?.targetVersion?.trim()) blockers.push(`${prefix}:version`);
  if (!receipt?.operatorId?.trim() || !receipt?.operatorSignatureRef?.trim()) blockers.push(`${prefix}:operator_evidence`);
  if (!Number.isFinite(Date.parse(receipt?.executedAt ?? ''))) blockers.push(`${prefix}:time`);
  for (const [field, value] of Object.entries({
    designRevisionSha256: receipt?.designRevisionSha256,
    sourceArtifactSha256: receipt?.sourceArtifactSha256,
    openedArtifactSha256: receipt?.openedArtifactSha256,
    returnedArtifactSha256: receipt?.returnedArtifactSha256,
    evidenceBundleSha256: receipt?.evidenceBundleSha256,
  })) if (!SHA256.test(value ?? '')) blockers.push(`${prefix}:hash:${field}`);

  if (receipt.target === 'nexyfab') {
    if (receipt.executionMode !== 'kernel_self_test') blockers.push(`${prefix}:execution_mode`);
  } else if (receipt.target === 'independent-step-parser') {
    if (receipt.executionMode !== 'independent_parser') blockers.push(`${prefix}:independent_execution_required`);
  } else if (receipt.executionMode !== 'native_application' && receipt.executionMode !== 'official_cloud_import') {
    blockers.push(`${prefix}:vendor_native_execution_required`);
  }

  const grouped = new Map<string, MechanicalStepInteropCheckV1[]>();
  for (const check of Array.isArray(receipt?.checks) ? receipt.checks : []) {
    const values = grouped.get(check?.id) ?? [];
    values.push(check);
    grouped.set(check?.id, values);
    if (check?.status === 'fail') blockers.push(`${prefix}:failed_check:${check.id}`);
  }
  for (const id of checksThrough(requiredLevel)) {
    const matches = grouped.get(id) ?? [];
    if (matches.length !== 1) blockers.push(`${prefix}:check:${id}:${matches.length ? 'duplicate' : 'missing'}`);
    else if (matches[0]?.status !== 'pass') blockers.push(`${prefix}:check:${id}:${matches[0]?.status ?? 'missing'}`);
  }
  return [...new Set(blockers)];
}

/**
 * Mechanical-core C4 is a standalone-product gate. It requires one assembly
 * roundtrip in NexyFab and the same immutable AP242 artifact through an
 * independently implemented STEP parser/writer. Vendor-native receipts are
 * accepted as optional evidence and never block the standalone release.
 */
export function evaluateMechanicalStepInteroperability(
  receipts: readonly MechanicalStepInteropReceiptV1[] | null | undefined,
): MechanicalStepInteropAssessmentV1 {
  const values = Array.isArray(receipts) ? receipts : [];
  const blockers: string[] = [];
  const requiredTargets: readonly StepInteropTarget[] = REQUIRED_STEP_TARGETS;
  for (const target of requiredTargets) {
    const matches = values.filter(receipt => receipt?.target === target);
    if (matches.length !== 1) {
      blockers.push(`target:${target}:${matches.length ? 'duplicate' : 'missing'}`);
      continue;
    }
    blockers.push(...receiptBlockers(matches[0]!, 'C4'));
  }
  for (const receipt of values) {
    if (![...REQUIRED_STEP_TARGETS, ...OPTIONAL_VENDOR_STEP_TARGETS].includes(receipt?.target)) {
      blockers.push(`target:unknown:${String(receipt?.target)}`);
    }
  }
  const revisionHashes = new Set(values
    .filter(receipt => requiredTargets.includes(receipt.target))
    .map(receipt => receipt.designRevisionSha256));
  const sourceHashes = new Set(values
    .filter(receipt => requiredTargets.includes(receipt.target))
    .map(receipt => receipt.sourceArtifactSha256));
  if (revisionHashes.size !== 1) blockers.push('matrix:revision_mismatch');
  if (sourceHashes.size !== 1) blockers.push('matrix:source_artifact_mismatch');

  const uniqueBlockers = [...new Set(blockers)];
  const verifiedTargets = requiredTargets.filter(target => {
    const matches = values.filter(receipt => receipt.target === target);
    return matches.length === 1 && receiptBlockers(matches[0]!, 'C4').length === 0;
  });
  return {
    schema: MECHANICAL_STEP_INTEROP_ASSESSMENT_SCHEMA,
    releaseChannel: 'mechanical-core',
    requiredLevel: 'C4',
    verifiedLevel: uniqueBlockers.length === 0 ? 'C4' : null,
    verifiedTargets: [...verifiedTargets],
    eligible: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
  };
}
