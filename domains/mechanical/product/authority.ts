import {
  hashDomainAuthorityManifest,
  validateDomainAuthorityManifest,
  type DomainAuthorityEntry,
  type DomainAuthorityManifest,
} from '../../../src/lib/cad/domainAuthorityManifest';
import {
  validateMotorGearboxDriveModuleContract,
  type MechanicalProvenance,
  type MotorGearboxDriveModuleContract,
} from './contract';

export interface MechanicalAuthorityContext {
  projectId: string;
  projectRevisionSha256: string;
  sourceRevisionSha256: string;
}

export interface MechanicalAuthorityValidation {
  status: 'PASS' | 'HOLD';
  issues: string[];
  manifestSha256?: string;
  linkedAuthorityIds: string[];
}

const SHA = /^[a-f0-9]{64}$/;
const forbidden = /(?:^|[:/])(?:ai|preview)(?:[:/]|$)/i;

const provenanceEntries = (contract: MotorGearboxDriveModuleContract): MechanicalProvenance[] => {
  const result: MechanicalProvenance[] = [];
  for (const part of contract.parts) result.push(part.material, part.process, part.procurement.source);
  return result;
};

/**
 * Binds the mechanical product contract to the common, revision-scoped
 * authority manifest. This adapter only verifies supplied evidence; it never
 * creates client, standards, manufacturer, or safety evidence.
 */
export function validateMechanicalProductAuthority(
  manifest: unknown,
  contract: unknown,
  context: MechanicalAuthorityContext,
): MechanicalAuthorityValidation {
  const issues: string[] = [];
  const linkedAuthorityIds: string[] = [];
  const manifestResult = validateDomainAuthorityManifest(manifest);
  if (manifestResult.status !== 'PASS') {
    return { status: 'HOLD', issues: manifestResult.issues.map(issue => `manifest:${issue}`), linkedAuthorityIds };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { status: 'HOLD', issues, linkedAuthorityIds };
  const m = manifest as DomainAuthorityManifest;
  if (m.domain !== 'mechanical') issues.push('manifest:domain_mismatch');
  if (m.projectId !== context.projectId) issues.push('manifest:project_mismatch');
  if (m.projectRevision.sha256 !== context.projectRevisionSha256) issues.push('manifest:project_revision_mismatch');
  if (m.sourceRevision.sha256 !== context.sourceRevisionSha256) issues.push('manifest:source_revision_mismatch');
  if (!SHA.test(context.projectRevisionSha256) || !SHA.test(context.sourceRevisionSha256)) issues.push('context:invalid_revision_hash');

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return { status: 'HOLD', issues: [...issues, 'contract:not_an_object'], linkedAuthorityIds };
  const c = contract as MotorGearboxDriveModuleContract;
  const contractIssues = validateMotorGearboxDriveModuleContract(c);
  if (contractIssues.length) return { status: 'HOLD', issues: contractIssues.map(issue => `contract:${issue}`), linkedAuthorityIds };
  if (m.projectRevision.id !== c.identity.revision) issues.push('manifest:contract_revision_mismatch');

  const entries = Array.isArray(m.authorities) ? m.authorities : [];
  const byId = new Map<string, DomainAuthorityEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) issues.push(`manifest:duplicate_authority:${entry.id}`);
    byId.set(entry.id, entry);
    if (forbidden.test(entry.id) || forbidden.test(entry.sourceRef)) issues.push(`manifest:unsafe_authority:${entry.id}`);
  }
  const approved = (kind: DomainAuthorityEntry['kind']) => entries.filter(e => e.kind === kind && e.status === 'APPROVED' && e.rights.status === 'APPROVED');
  if (approved('client').length === 0) issues.push('authority:client_requirement_missing');
  if (approved('manufacturer').length + approved('standard').length === 0) issues.push('authority:manufacturer_or_standard_missing');
  if (approved('catalog').length === 0) issues.push('authority:material_process_catalog_missing');

  for (const [index, source] of provenanceEntries(c).entries()) {
    const path = `contract:provenance[${index}]`;
    const authority = byId.get(source.sourceId);
    if (!authority) { issues.push(`${path}:authority_missing:${source.sourceId}`); continue; }
    linkedAuthorityIds.push(authority.id);
    if (authority.status !== 'APPROVED') issues.push(`${path}:authority_not_approved:${authority.id}`);
    if (authority.contentSha256 !== source.contentSha256) issues.push(`${path}:content_hash_mismatch:${authority.id}`);
    if (authority.rights.status !== 'APPROVED' || authority.rights.receiptSha256 !== source.rightsReceiptSha256) issues.push(`${path}:rights_receipt_mismatch:${authority.id}`);
  }
  if (new Set(linkedAuthorityIds).size !== linkedAuthorityIds.length) issues.push('contract:provenance_duplicate_authority_link');
  // Professional review is deliberately a promotion gate, not fabricated here.
  if (approved('professional-review').length === 0) issues.push('authority:professional_review:HOLD');
  const uniqueIssues = [...new Set(issues)];
  return {
    status: uniqueIssues.length === 0 ? 'PASS' : 'HOLD',
    issues: uniqueIssues,
    manifestSha256: manifestResult.canonicalSha256 ?? (manifestResult.status === 'PASS' ? hashDomainAuthorityManifest(m) : undefined),
    linkedAuthorityIds: [...new Set(linkedAuthorityIds)],
  };
}
