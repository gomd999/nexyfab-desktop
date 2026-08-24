import {
  createDomainDeliverableManifest,
  validateDomainDeliverableManifest,
  type DomainDeliverable,
  type DomainDeliverableManifest,
} from '../../../src/lib/cad/domainDeliverableManifest';

export const MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS = [
  'native-project',
  'step',
  'part-drawings',
  'assembly-drawing',
  'bom',
  'tolerance-inspection-report',
  'dfm-report',
  'assembly-verification-receipt',
] as const;

export type MechanicalDriveModuleDeliverableKind = typeof MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS[number];

const FORMAT_BY_KIND: Record<MechanicalDriveModuleDeliverableKind, DomainDeliverable['format']> = {
  'native-project': 'json',
  step: 'step',
  'part-drawings': 'drawing',
  'assembly-drawing': 'drawing',
  bom: 'bom',
  'tolerance-inspection-report': 'pdf',
  'dfm-report': 'pdf',
  'assembly-verification-receipt': 'json',
};

const sameSequence = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);

export interface MechanicalDriveModuleManifestExpectations {
  projectRevision?: string;
  modelContentHash?: string;
}

export interface MechanicalDriveModuleManifestValidation {
  valid: boolean;
  errors: string[];
}

export type MechanicalDriveModuleDeliverableManifest = DomainDeliverableManifest & {
  domain: 'mechanical';
  requiredDeliverableKinds: MechanicalDriveModuleDeliverableKind[];
};

/**
 * Creates the complete, rights-neutral deliverable declaration for the
 * motor/gearbox drive-module product.  It only accepts already-produced,
 * verified artifacts; it does not infer or substitute deliverable kinds.
 */
export function createMechanicalDriveModuleDeliverableManifest(input: Omit<MechanicalDriveModuleDeliverableManifest, 'schema' | 'domain' | 'requiredDeliverableKinds'>): MechanicalDriveModuleDeliverableManifest {
  const manifest = createDomainDeliverableManifest({
    ...input,
    domain: 'mechanical',
    requiredDeliverableKinds: [...MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS],
  });
  return manifest as MechanicalDriveModuleDeliverableManifest;
}

/**
 * Validates the common manifest and then applies the mechanical product's
 * stricter contract. Unknown, substituted, stale, or unverified artifacts are
 * rejected even when the generic manifest would accept them.
 */
export function validateMechanicalDriveModuleDeliverableManifest(
  input: unknown,
  expectations: MechanicalDriveModuleManifestExpectations = {},
): MechanicalDriveModuleManifestValidation {
  const common = validateDomainDeliverableManifest(input);
  const errors = [...common.errors];
  if (!common.valid || !input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: [...new Set(errors)] };
  }

  const manifest = input as Partial<MechanicalDriveModuleDeliverableManifest>;
  if (manifest.domain !== 'mechanical') errors.push('mechanical_domain_required');
  if (!Array.isArray(manifest.requiredDeliverableKinds) || !sameSequence(manifest.requiredDeliverableKinds, MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS)) {
    errors.push('mechanical_required_kinds_exact_mismatch');
  }
  if (expectations.projectRevision !== undefined && manifest.projectRevision !== expectations.projectRevision) {
    errors.push('mechanical_project_revision_mismatch');
  }
  if (expectations.modelContentHash !== undefined && manifest.modelContentHash !== expectations.modelContentHash) {
    errors.push('mechanical_model_content_hash_mismatch');
  }

  const deliverables = Array.isArray(manifest.deliverables) ? manifest.deliverables : [];
  const byKind = new Map<string, DomainDeliverable>();
  for (const item of deliverables) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS.includes(item.kind as MechanicalDriveModuleDeliverableKind)) {
      errors.push(`mechanical_unknown_deliverable_kind:${item.kind}`);
      continue;
    }
    byKind.set(item.kind, item as DomainDeliverable);
    if (item.format !== FORMAT_BY_KIND[item.kind as MechanicalDriveModuleDeliverableKind]) {
      errors.push(`mechanical_format_mismatch:${item.kind}`);
    }
    if (item.sourceRevision !== manifest.projectRevision) errors.push(`mechanical_stale_deliverable:${item.kind}`);
    if (item.verificationStatus !== 'verified') errors.push(`mechanical_unverified_deliverable:${item.kind}`);
  }
  for (const kind of MECHANICAL_DRIVE_MODULE_DELIVERABLE_KINDS) {
    if (!byKind.has(kind)) errors.push(`mechanical_required_deliverable_missing:${kind}`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertMechanicalDriveModuleDeliverableManifest(
  input: unknown,
  expectations: MechanicalDriveModuleManifestExpectations = {},
): asserts input is MechanicalDriveModuleDeliverableManifest {
  const result = validateMechanicalDriveModuleDeliverableManifest(input, expectations);
  if (!result.valid) throw new Error(`invalid_mechanical_drive_module_deliverable_manifest:${result.errors.join(',')}`);
}
