/**
 * Operator-supplied source manifest for architecture/interior evaluation.
 *
 * This file intentionally contains no source files and no machine-specific
 * paths. Operators register a locator and the hash of the source they have
 * actually received; promotion remains blocked until every required field is
 * reviewed and recorded.
 */
export const ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_SCHEMA = 'nexyfab.architecture-interior-reference-manifest.v1' as const;

export const ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY = Object.freeze({
  requiredRoles: ['manual', 'reference', 'regression', 'holdout'] as const,
  holdoutUsedForTuning: false,
  minimumIndependentApprovalReviewers: 2,
});

export type ArchitectureInteriorReferenceRole = typeof ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.requiredRoles[number];
export type ReferenceLicenseStatus = 'approved' | 'pending' | 'unknown' | 'restricted' | 'not_applicable';
export type ReferenceApprovalDecision = 'approved' | 'pending' | 'rejected';

export interface ArchitectureInteriorReferenceProvenance {
  /** Supplied by the operator; never a path embedded by the application. */
  locator: string;
  authority: 'operator';
  description: string;
}

export interface ArchitectureInteriorReferenceApprovalReceipt {
  decision: ReferenceApprovalDecision;
  receiptHash: string | null;
  reviewerIds: readonly string[];
  reviewedAt: string | null;
}

export interface ArchitectureInteriorReferenceManifestEntry {
  id: string;
  label: string;
  role: ArchitectureInteriorReferenceRole;
  sourceHash: string | null;
  provenance: ArchitectureInteriorReferenceProvenance;
  licenseStatus: ReferenceLicenseStatus;
  usedForTuning: boolean;
  approvalReceipt: ArchitectureInteriorReferenceApprovalReceipt;
}

export interface ArchitectureInteriorReferenceManifest {
  schema: typeof ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_SCHEMA;
  manifestId: string;
  operator: string;
  entries: readonly ArchitectureInteriorReferenceManifestEntry[];
}

export interface ArchitectureInteriorReferenceManifestAssessment {
  manifestId: string;
  eligible: boolean;
  blockers: string[];
  entryCount: number;
  approvedEntryCount: number;
  rolesPresent: ArchitectureInteriorReferenceRole[];
}

/**
 * A source-level lineage record for the three Wave 1 golden scenarios.
 *
 * The corpus is operator-owned and read-only.  Consequently this module stores
 * only a corpus-relative path, an operator locator, and the hash observed in
 * the inventory; it never embeds or reads CAD bytes at runtime.
 */
export const ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA = 'nexyfab.architecture-interior-golden-lineage.v1' as const;
export const ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA = 'nexyfab.architecture-interior.reference-inventory.v1' as const;
export const ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256 = 'e9055e794ecc60bb9d70ad73a74f4ad9bea7d1c4c8ca7afc919a582470d65d38' as const;

export type ArchitectureInteriorGoldenLineageRole = 'reference' | 'regression' | 'holdout';
export type ArchitectureInteriorGoldenSourceFormat = 'rvt' | 'ifc' | 'dwg';
export type ArchitectureInteriorGoldenProbeMode = 'native_review' | 'automated_probe';

export interface ArchitectureInteriorGoldenLineageSource {
  id: string;
  role: ArchitectureInteriorGoldenLineageRole;
  sourcePath: string;
  sourceHash: string;
  format: ArchitectureInteriorGoldenSourceFormat;
  probeMode: ArchitectureInteriorGoldenProbeMode;
  provenance: ArchitectureInteriorReferenceProvenance;
  licenseStatus: ReferenceLicenseStatus;
  usedForTuning: false;
  approvalReceipt: ArchitectureInteriorReferenceApprovalReceipt;
}

export interface ArchitectureInteriorGoldenScenarioLineage {
  schema: typeof ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA;
  scenarioId: string;
  inventorySchema: typeof ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA;
  inventoryRootSha256: typeof ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256;
  scoreEligible: false;
  holdoutTuningUses: 0;
  sources: readonly ArchitectureInteriorGoldenLineageSource[];
}

const lineageSource = (
  id: string,
  role: ArchitectureInteriorGoldenLineageRole,
  sourcePath: string,
  sourceHash: string,
  format: ArchitectureInteriorGoldenSourceFormat,
  description: string,
): ArchitectureInteriorGoldenLineageSource => ({
  id,
  role,
  sourcePath,
  sourceHash,
  format,
  probeMode: format === 'rvt' ? 'native_review' : 'automated_probe',
  provenance: {
    locator: `operator://reference-corpus/${encodeURI(sourcePath)}`,
    authority: 'operator',
    description,
  },
  licenseStatus: 'unknown',
  usedForTuning: false,
  approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
});

/**
 * Wave 1 candidate lineage bound to the 2026-08-21 7,407-file inventory.
 * Unknown rights and absent independent approvals are intentional: this is
 * usable for local probes, but must remain score-ineligible until reviewed.
 */
export const ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES: readonly ArchitectureInteriorGoldenScenarioLineage[] = Object.freeze([
  {
    schema: ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA,
    scenarioId: 'arch-single-storey-small-office',
    inventorySchema: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA,
    inventoryRootSha256: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256,
    scoreEligible: false,
    holdoutTuningUses: 0,
    sources: Object.freeze([
      lineageSource('office-reference-ifc', 'reference', '참고파일들4/office-design-14.snapshot.2/Untitled.ifc', '18459cb87e0560deb9ad86569d15c59f3c9a263fda62aa0dc6a646125b6ddf99', 'ifc', 'Office reference model from the operator inventory; IFC is limited to the automated probe path.'),
      lineageSource('office-regression-dwg', 'regression', '참고파일들4/office-design-14.snapshot.2/Untitled.dwg', '6f08e107dcb88cfffb0c37d14c09c77c82785c518fd073302420116a805025c0', 'dwg', 'Office regression drawing from the operator inventory; DWG is limited to the automated probe path.'),
      lineageSource('office-holdout-rvt', 'holdout', '참고파일들4/6-story-corporate-office-revit-1.snapshot.1/6 Story Corporate Office Building 3D model (1).rvt', '6c2fec006819b984e2a05c39acb5cc8e1227c1c82dddd4d4b9f8bb77ccdbc065', 'rvt', 'Independent office holdout candidate; RVT requires native review and has no approval yet.'),
    ]),
  },
  {
    schema: ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA,
    scenarioId: 'arch-multi-storey-apartment',
    inventorySchema: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA,
    inventoryRootSha256: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256,
    scoreEligible: false,
    holdoutTuningUses: 0,
    sources: Object.freeze([
      lineageSource('apartment-reference-rvt', 'reference', '참고파일들4/3-story-100-square-meteres-apartment-revit-1.snapshot.1/3story 100m villa  (2).rvt', 'ca5dcd947d40f83be80134607e77ec564ccbb084a26e793a34a5d5f76792f9a4', 'rvt', 'Apartment reference model from the operator inventory; RVT is limited to native review.'),
      lineageSource('apartment-regression-dwg', 'regression', '참고파일들4/3-story-100-square-meteres-apartment-revit-1.snapshot.1/3story 100m villa  (1).dwg', 'dacc185ebe42cec20b5d4340a34be6fbafedc4210fb70004ff5b7dfe3d49f7ca', 'dwg', 'Apartment regression drawing from the operator inventory; DWG is limited to the automated probe path.'),
      lineageSource('apartment-holdout-rvt', 'holdout', '참고파일들4/revit-skills-showcase-3-bedroom-apartment-building-1.snapshot.3/Apartment Building.rvt', '7386182ebe722167feb248e58681969c9f8ddea8adbee2eec9f684a9682838c6', 'rvt', 'Independent apartment holdout candidate; RVT requires native review and has no approval yet.'),
    ]),
  },
  {
    schema: ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA,
    scenarioId: 'interior-cafe-restaurant-kitchen',
    inventorySchema: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA,
    inventoryRootSha256: ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256,
    scoreEligible: false,
    holdoutTuningUses: 0,
    sources: Object.freeze([
      lineageSource('cafe-reference-rvt', 'reference', '참고파일들4/reconstruction-of-the-restaurant-s-kitchen-exterior-fragments-of-workspaces-1.snapshot.5/В_АР_ПЭ_01 Этаж_План помещений копия 1.rvt', 'f4b63cab9d4507df05aafa4be7fe9b273bd25e66dceffe07d7c37e739b90723c', 'rvt', 'Cafe reference model from the operator inventory; RVT is limited to native review.'),
      lineageSource('cafe-regression-dwg', 'regression', '참고파일들4/kitchen-interior-1.snapshot.2/Kitchen Full.dwg', 'c0c5523e20f37e49740ac366dd90c282a117815ceab432af9c151244f4ed67ea', 'dwg', 'Cafe regression drawing from the operator inventory; DWG is limited to the automated probe path.'),
      lineageSource('cafe-holdout-rvt', 'holdout', '참고파일들4/simple-kitchen-3.snapshot.1/kitchen view.rvt', '13bd375d3172993898c519732710fe7e3b3773d1a884406aa2f5d2f0564bd3d4', 'rvt', 'Independent cafe holdout candidate; RVT requires native review and has no approval yet.'),
    ]),
  },
]);

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOCATOR = /^(?:operator|holdout|https?):\/\/[^\s]+$/;
const ROLES = new Set<ArchitectureInteriorReferenceRole>(ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.requiredRoles);
const LICENSES = new Set<ReferenceLicenseStatus>(['approved', 'pending', 'unknown', 'restricted', 'not_applicable']);
const PROMOTION_LICENSES = new Set<ReferenceLicenseStatus>(['approved', 'not_applicable']);
const DECISIONS = new Set<ReferenceApprovalDecision>(['approved', 'pending', 'rejected']);

/** Draft manifest: locators are neutral operator tokens, never absolute paths. */
export const ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST = Object.freeze({
  schema: ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_SCHEMA,
  manifestId: 'architecture-interior-reference-manifest',
  operator: 'operator-pending',
  entries: Object.freeze([
    {
      id: 'example-7-3', label: '7.3 example', role: 'reference', sourceHash: null,
      provenance: { locator: 'operator://architecture-interior/example-7-3', authority: 'operator', description: 'Operator-provided 7.3 example locator.' },
      licenseStatus: 'unknown', usedForTuning: false,
      approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
    },
    {
      id: 'document-manuals', label: 'Document manuals', role: 'manual', sourceHash: null,
      provenance: { locator: 'operator://architecture-interior/document-manuals', authority: 'operator', description: 'Operator-provided manuals locator.' },
      licenseStatus: 'unknown', usedForTuning: false,
      approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
    },
    {
      id: 'operator-reference-files', label: 'Operator reference files', role: 'reference', sourceHash: null,
      provenance: { locator: 'operator://architecture-interior/reference-files', authority: 'operator', description: 'Operator-provided reference collection locator.' },
      licenseStatus: 'unknown', usedForTuning: false,
      approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
    },
    {
      id: 'architecture-interior-regression', label: 'Architecture/interior regression fixture', role: 'regression', sourceHash: null,
      provenance: { locator: 'operator://architecture-interior/regression-fixture', authority: 'operator', description: 'Operator-provided regression fixture locator.' },
      licenseStatus: 'unknown', usedForTuning: false,
      approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
    },
    {
      id: 'architecture-interior-independent-holdout', label: 'Independent architecture/interior holdout', role: 'holdout', sourceHash: null,
      provenance: { locator: 'operator://architecture-interior/independent-holdout', authority: 'operator', description: 'Operator-provided independent holdout locator.' },
      licenseStatus: 'unknown', usedForTuning: false,
      approvalReceipt: { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null },
    },
  ]),
}) as ArchitectureInteriorReferenceManifest;

function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

function validateApproval(entry: ArchitectureInteriorReferenceManifestEntry, issues: string[]): boolean {
  const approval = entry.approvalReceipt;
  let valid = true;
  if (!approval || typeof approval !== 'object' || !DECISIONS.has(approval.decision)) { issues.push(`approval_decision_invalid:${entry.id}`); return false; }
  const reviewerIds = Array.isArray(approval.reviewerIds) ? approval.reviewerIds : [];
  if (!Array.isArray(approval.reviewerIds)) { issues.push(`approval_reviewers_invalid:${entry.id}`); valid = false; }
  const reviewers = new Set(reviewerIds.filter(text));
  if (approval.decision !== 'approved' || !SHA256.test(approval.receiptHash ?? '') || reviewers.size < ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.minimumIndependentApprovalReviewers || !DATE.test(approval.reviewedAt ?? '')) {
    issues.push(`approval_incomplete:${entry.id}`); valid = false;
  }
  if (reviewers.size !== reviewerIds.length) { issues.push(`approval_reviewers_invalid:${entry.id}`); valid = false; }
  return valid;
}

/** Structural and promotion-safety validation. Does not read a locator. */
export function validateArchitectureInteriorReferenceManifest(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['manifest_invalid'];
  const manifest = value as Partial<ArchitectureInteriorReferenceManifest>;
  const issues: string[] = [];
  if (manifest.schema !== ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_SCHEMA) issues.push('manifest_schema_invalid');
  if (!SAFE_ID.test(manifest.manifestId ?? '') || !text(manifest.operator)) issues.push('manifest_identity_invalid');
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) return [...issues, 'manifest_entries_missing'];
  const ids = new Set<string>();
  const sourceHashes = new Map<string, ArchitectureInteriorReferenceRole[]>();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') { issues.push('entry_invalid'); continue; }
    const item = entry as ArchitectureInteriorReferenceManifestEntry;
    if (!SAFE_ID.test(item.id) || ids.has(item.id) || !text(item.label)) issues.push(`entry_identity_invalid:${item.id ?? 'unknown'}`);
    ids.add(item.id);
    if (!ROLES.has(item.role)) issues.push(`entry_role_invalid:${item.id}`);
    if (!SHA256.test(item.sourceHash ?? '')) issues.push(`source_hash_missing_or_invalid:${item.id}`);
    if (!item.provenance || item.provenance.authority !== 'operator' || !LOCATOR.test(item.provenance.locator ?? '') || !text(item.provenance.description)) issues.push(`provenance_invalid:${item.id}`);
    if (!LICENSES.has(item.licenseStatus) || !PROMOTION_LICENSES.has(item.licenseStatus)) issues.push(`license_not_approved:${item.id}`);
    if (typeof item.usedForTuning !== 'boolean') issues.push(`used_for_tuning_invalid:${item.id}`);
    if (item.role === 'holdout' && item.usedForTuning !== ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.holdoutUsedForTuning) issues.push(`holdout_used_for_tuning:${item.id}`);
    validateApproval(item, issues);
    const hash = item.sourceHash;
    if (typeof hash === 'string' && SHA256.test(hash)) sourceHashes.set(hash, [...(sourceHashes.get(hash) ?? []), item.role]);
  }
  for (const [hash, roles] of sourceHashes) {
    // A source may be listed more than once within one role (for example when
    // a manual and reference record intentionally point at the same licensed
    // package), but it must never cross the evaluation split.  In particular,
    // regression and holdout reuse would silently turn a regression fixture
    // into tuning data, while reference/regression reuse makes the measured
    // score non-independent.  Keep the historical, specific diagnostic for
    // callers that already display it and add a deterministic diagnostic for
    // every other cross-role collision.
    const distinctRoles = [...new Set(roles)]
      .filter((role): role is Exclude<ArchitectureInteriorReferenceRole, 'manual'> => role !== 'manual')
      .sort();
    if (distinctRoles.includes('reference') && distinctRoles.includes('holdout')) issues.push(`reference_holdout_hash_overlap:${hash}`);
    for (let index = 0; index < distinctRoles.length; index += 1) {
      for (let next = index + 1; next < distinctRoles.length; next += 1) {
        const left = distinctRoles[index]!;
        const right = distinctRoles[next]!;
        if (left === 'reference' && right === 'holdout') continue;
        issues.push(`role_hash_overlap:${hash}:${left}:${right}`);
      }
    }
  }
  return [...new Set(issues)];
}

export function assessArchitectureInteriorReferenceManifest(value: unknown = ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST): ArchitectureInteriorReferenceManifestAssessment {
  const manifest = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ArchitectureInteriorReferenceManifest> : {};
  const blockers = validateArchitectureInteriorReferenceManifest(value);
  const entries = Array.isArray(manifest.entries) ? manifest.entries as ArchitectureInteriorReferenceManifestEntry[] : [];
  const rolesPresent = [...new Set(entries.map(entry => entry?.role).filter((role): role is ArchitectureInteriorReferenceRole => ROLES.has(role)))];
  const approvedEntryCount = entries.filter(entry => PROMOTION_LICENSES.has(entry?.licenseStatus) && entry?.approvalReceipt?.decision === 'approved').length;
  if (ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.requiredRoles.some(role => !rolesPresent.includes(role))) blockers.push('required_role_missing');
  return { manifestId: typeof manifest.manifestId === 'string' ? manifest.manifestId : '', eligible: blockers.length === 0, blockers: [...new Set(blockers)], entryCount: entries.length, approvedEntryCount, rolesPresent };
}

const LINEAGE_SCENARIOS = new Set(['arch-single-storey-small-office', 'arch-multi-storey-apartment', 'interior-cafe-restaurant-kitchen']);
const LINEAGE_ROLES = new Set<ArchitectureInteriorGoldenLineageRole>(['reference', 'regression', 'holdout']);
const LINEAGE_FORMATS = new Set<ArchitectureInteriorGoldenSourceFormat>(['rvt', 'ifc', 'dwg']);
const RELATIVE_CORPUS_PATH = /^[^\\/][^\\]*$/;

/** Validates Wave 1 lineage without reading external corpus bytes. */
export function validateArchitectureInteriorGoldenLineages(value: unknown = ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES): string[] {
  if (!Array.isArray(value) || value.length !== 3) return ['lineage_scenario_count_invalid'];
  const issues: string[] = [];
  const scenarioIds = new Set<string>();
  const allHashes = new Set<string>();
  for (const lineage of value) {
    if (!lineage || typeof lineage !== 'object') { issues.push('lineage_invalid'); continue; }
    const item = lineage as ArchitectureInteriorGoldenScenarioLineage;
    if (item.schema !== ARCHITECTURE_INTERIOR_GOLDEN_LINEAGE_SCHEMA) issues.push(`lineage_schema_invalid:${item.scenarioId ?? 'unknown'}`);
    if (!LINEAGE_SCENARIOS.has(item.scenarioId) || scenarioIds.has(item.scenarioId)) issues.push(`lineage_scenario_invalid:${item.scenarioId ?? 'unknown'}`);
    scenarioIds.add(item.scenarioId);
    if (item.inventorySchema !== ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_SCHEMA || item.inventoryRootSha256 !== ARCHITECTURE_INTERIOR_REFERENCE_INVENTORY_ROOT_SHA256) issues.push(`lineage_inventory_binding_invalid:${item.scenarioId}`);
    if (item.scoreEligible !== false) issues.push(`lineage_score_eligible_not_false:${item.scenarioId}`);
    if (item.holdoutTuningUses !== 0) issues.push(`lineage_holdout_tuning_nonzero:${item.scenarioId}`);
    if (!Array.isArray(item.sources) || item.sources.length !== 3) { issues.push(`lineage_sources_invalid:${item.scenarioId}`); continue; }
    const roles = new Set<ArchitectureInteriorGoldenLineageRole>();
    const hashes = new Set<string>();
    for (const source of item.sources) {
      if (!source || typeof source !== 'object') { issues.push(`lineage_source_invalid:${item.scenarioId}`); continue; }
      const entry = source as ArchitectureInteriorGoldenLineageSource;
      if (!entry.id?.trim() || !LINEAGE_ROLES.has(entry.role) || roles.has(entry.role)) issues.push(`lineage_source_role_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      roles.add(entry.role);
      if (!SHA256.test(entry.sourceHash ?? '')) issues.push(`lineage_source_hash_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (hashes.has(entry.sourceHash) || allHashes.has(entry.sourceHash)) issues.push(`lineage_source_hash_overlap:${entry.sourceHash}`);
      hashes.add(entry.sourceHash); allHashes.add(entry.sourceHash);
      if (!RELATIVE_CORPUS_PATH.test(entry.sourcePath ?? '') || entry.sourcePath.includes('../') || entry.sourcePath.includes('\\..\\')) issues.push(`lineage_source_path_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (!LINEAGE_FORMATS.has(entry.format)) issues.push(`lineage_source_format_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      const expectedProbeMode = entry.format === 'rvt' ? 'native_review' : 'automated_probe';
      if (entry.probeMode !== expectedProbeMode) issues.push(`lineage_probe_mode_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (!entry.provenance || entry.provenance.authority !== 'operator' || !LOCATOR.test(entry.provenance.locator ?? '') || !text(entry.provenance.description)) issues.push(`lineage_provenance_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (!LICENSES.has(entry.licenseStatus)) issues.push(`lineage_license_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (entry.usedForTuning !== false) issues.push(`lineage_source_tuning_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
      if (entry.role === 'holdout' && entry.usedForTuning !== ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.holdoutUsedForTuning) issues.push(`lineage_holdout_tuning_invalid:${item.scenarioId}:${entry.id ?? 'unknown'}`);
    }
    for (const role of LINEAGE_ROLES) if (!roles.has(role)) issues.push(`lineage_required_role_missing:${item.scenarioId}:${role}`);
  }
  for (const scenario of LINEAGE_SCENARIOS) if (!scenarioIds.has(scenario)) issues.push(`lineage_required_scenario_missing:${scenario}`);
  return [...new Set(issues)];
}

export interface ArchitectureInteriorGoldenLineageAssessment {
  eligible: boolean;
  blockers: string[];
  scenarioCount: number;
  sourceCount: number;
  holdoutTuningUses: number;
}

export function assessArchitectureInteriorGoldenLineages(value: unknown = ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES): ArchitectureInteriorGoldenLineageAssessment {
  const lineages = Array.isArray(value) ? value as ArchitectureInteriorGoldenScenarioLineage[] : [];
  const blockers = validateArchitectureInteriorGoldenLineages(value);
  const sourceCount = lineages.reduce((sum, lineage) => sum + (Array.isArray(lineage?.sources) ? lineage.sources.length : 0), 0);
  const holdoutTuningUses = lineages.reduce((sum, lineage) => sum + (typeof lineage?.holdoutTuningUses === 'number' ? lineage.holdoutTuningUses : 0), 0);
  if (lineages.some(lineage => lineage?.scoreEligible !== false)) blockers.push('lineage_score_eligibility_not_fail_closed');
  if (holdoutTuningUses !== 0) blockers.push('lineage_holdout_tuning_nonzero');
  for (const lineage of lineages) {
    for (const source of lineage?.sources ?? []) {
      if (source.licenseStatus !== 'approved' && source.licenseStatus !== 'not_applicable') blockers.push(`lineage_license_not_approved:${lineage.scenarioId}:${source.id}`);
      const approval = source.approvalReceipt;
      const reviewerIds = Array.isArray(approval?.reviewerIds) ? approval.reviewerIds : [];
      const reviewerCount = new Set(reviewerIds.filter(text)).size;
      if (!Array.isArray(approval?.reviewerIds) || reviewerCount !== reviewerIds.length) blockers.push(`lineage_approval_reviewers_invalid:${lineage.scenarioId}:${source.id}`);
      if (approval?.decision !== 'approved' || !SHA256.test(approval.receiptHash ?? '') || reviewerCount < ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST_POLICY.minimumIndependentApprovalReviewers || !DATE.test(approval.reviewedAt ?? '')) blockers.push(`lineage_approval_incomplete:${lineage.scenarioId}:${source.id}`);
    }
  }
  return { eligible: blockers.length === 0 && lineages.length === 3, blockers: [...new Set(blockers)], scenarioCount: lineages.length, sourceCount, holdoutTuningUses };
}
