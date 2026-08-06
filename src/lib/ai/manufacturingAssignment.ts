export type ManufacturingAssignmentSource = 'user_confirmed' | 'approved_family_policy';

export interface ManufacturingAssignment {
  definitionId: string;
  material: string;
  process: string;
  source: ManufacturingAssignmentSource;
  sourceRef: string;
  confirmedAt: string | null;
  policyId: string | null;
}

export interface ManufacturingFamilyPolicy {
  id: string;
  family: string;
  material: string;
  process: string;
  approved: true;
  approvalRef: string;
}

export type ManufacturingAssignmentResult =
  | { status: 'pass'; assignment: ManufacturingAssignment; codes: [] }
  | { status: 'not_run' | 'fail'; assignment: null; codes: string[] };

const validValue = (value: string | undefined) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{1,63}$/i.test(value);

/** Resolve manufacturing metadata without silent defaults. Family policy is
 * used only when the caller explicitly opts in and the policy is approved. */
export function resolveManufacturingAssignment(input: {
  definitionId: string;
  explicit?: { material?: string; process?: string; confirmed: boolean; sourceRef?: string; confirmedAt?: string };
  family?: string;
  policy?: ManufacturingFamilyPolicy;
  acceptFamilyPolicy?: boolean;
}): ManufacturingAssignmentResult {
  if (!input.definitionId.trim()) return { status: 'fail', assignment: null, codes: ['MANUFACTURING_DEFINITION_ID_MISSING'] };
  if (input.explicit) {
    if (!input.explicit.confirmed) return { status: 'not_run', assignment: null, codes: ['MANUFACTURING_EXPLICIT_VALUES_NOT_CONFIRMED'] };
    if (!validValue(input.explicit.material) || !validValue(input.explicit.process) || !input.explicit.sourceRef?.trim()) return { status: 'fail', assignment: null, codes: ['MANUFACTURING_EXPLICIT_PROVENANCE_INVALID'] };
    return { status: 'pass', codes: [], assignment: { definitionId: input.definitionId, material: input.explicit.material!, process: input.explicit.process!, source: 'user_confirmed', sourceRef: input.explicit.sourceRef, confirmedAt: input.explicit.confirmedAt ?? null, policyId: null } };
  }
  if (!input.acceptFamilyPolicy) return { status: 'not_run', assignment: null, codes: ['MANUFACTURING_MATERIAL_PROCESS_UNRESOLVED'] };
  const policy = input.policy;
  if (!policy || policy.approved !== true || !input.family || policy.family !== input.family || !validValue(policy.material) || !validValue(policy.process) || !policy.approvalRef.trim()) return { status: 'fail', assignment: null, codes: ['MANUFACTURING_FAMILY_POLICY_INVALID'] };
  return { status: 'pass', codes: [], assignment: { definitionId: input.definitionId, material: policy.material, process: policy.process, source: 'approved_family_policy', sourceRef: policy.approvalRef, confirmedAt: null, policyId: policy.id } };
}

export function applyManufacturingAssignments<T extends { definitionId: string; unresolvedMetadata: string[] }>(
  definitions: T[], assignments: ManufacturingAssignment[],
): Array<T & { manufacturingAssignment: ManufacturingAssignment | null; unresolvedMetadata: string[] }> {
  const byDefinition = new Map(assignments.map(item => [item.definitionId, item]));
  return definitions.map(definition => {
    const assignment = byDefinition.get(definition.definitionId) ?? null;
    return { ...definition, manufacturingAssignment: assignment, unresolvedMetadata: assignment ? definition.unresolvedMetadata.filter(item => item !== 'material' && item !== 'process') : [...definition.unresolvedMetadata] };
  });
}
