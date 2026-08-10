export const CAD_RELEASE_STATUSES = [
  'ai_draft',
  'auto_verifying',
  'auto_verified',
  'manual_revision',
  'expert_review_required',
  'expert_approved',
  'manufacturing_or_construction_approved',
  'blocked',
] as const;

export type CadReleaseStatus = typeof CAD_RELEASE_STATUSES[number];
export type CadExportPurpose = 'design_review' | 'expert_review' | 'manufacturing_or_construction';

const EXPORTABLE: Record<CadExportPurpose, readonly CadReleaseStatus[]> = {
  design_review: ['auto_verified', 'manual_revision', 'expert_review_required', 'expert_approved', 'manufacturing_or_construction_approved'],
  expert_review: ['expert_review_required', 'expert_approved', 'manufacturing_or_construction_approved'],
  manufacturing_or_construction: ['manufacturing_or_construction_approved'],
};

export function cadExportBlockers(status: CadReleaseStatus, purpose: CadExportPurpose): string[] {
  if (status === 'blocked') return ['cad-release-status-blocked'];
  if (!EXPORTABLE[purpose].includes(status)) return [`cad-release-status-not-approved:${status}:${purpose}`];
  return [];
}

export function assertCadExportAllowed(status: CadReleaseStatus, purpose: CadExportPurpose): void {
  const blockers = cadExportBlockers(status, purpose);
  if (blockers.length) throw new Error(`CAD_EXPORT_BLOCKED:${blockers.join(',')}`);
}
