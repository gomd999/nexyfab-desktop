import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST,
  ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES,
  assessArchitectureInteriorGoldenLineages,
  assessArchitectureInteriorReferenceManifest,
  validateArchitectureInteriorGoldenLineages,
  validateArchitectureInteriorReferenceManifest,
  type ArchitectureInteriorReferenceManifest,
} from './architectureInteriorReferenceManifest';

const hash = (value: string) => value.repeat(64).slice(0, 64);

function completeManifest(): ArchitectureInteriorReferenceManifest {
  const manifest = structuredClone(ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST) as ArchitectureInteriorReferenceManifest;
  manifest.entries.forEach((entry, index) => {
    entry.sourceHash = hash((index + 1).toString(16));
    entry.licenseStatus = 'approved';
    entry.approvalReceipt = { decision: 'approved', receiptHash: hash(String(index + 11)), reviewerIds: ['reviewer-a', 'reviewer-b'], reviewedAt: '2026-08-21T00:00:00.000Z' };
  });
  return manifest;
}

describe('architecture/interior operator reference manifest', () => {
  it('keeps the draft fail-closed without scanning or embedding operator sources', () => {
    const assessment = assessArchitectureInteriorReferenceManifest();
    expect(assessment.eligible).toBe(false);
    expect(assessment.blockers).toEqual(expect.arrayContaining(['source_hash_missing_or_invalid:example-7-3', 'license_not_approved:document-manuals', 'approval_incomplete:architecture-interior-independent-holdout']));
    expect(ARCHITECTURE_INTERIOR_REFERENCE_MANIFEST.entries.every(entry => !/^([A-Za-z]:[\\/]|\\\\)/.test(entry.provenance.locator))).toBe(true);
  });

  it('promotes only a complete manifest containing all roles and two approvals', () => {
    const manifest = completeManifest();
    manifest.entries[0]!.licenseStatus = 'not_applicable';
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toEqual([]);
    expect(assessArchitectureInteriorReferenceManifest(manifest)).toMatchObject({ eligible: true, entryCount: 5, approvedEntryCount: 5, rolesPresent: ['reference', 'manual', 'regression', 'holdout'] });
  });

  it('blocks unknown license/hash/approval and holdout tuning', () => {
    const manifest = completeManifest();
    const holdout = manifest.entries.find(entry => entry.role === 'holdout')!;
    holdout.usedForTuning = true;
    holdout.licenseStatus = 'unknown';
    holdout.sourceHash = null;
    holdout.approvalReceipt = { decision: 'pending', receiptHash: null, reviewerIds: [], reviewedAt: null };
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toEqual(expect.arrayContaining([
      `source_hash_missing_or_invalid:${holdout.id}`,
      `license_not_approved:${holdout.id}`,
      `holdout_used_for_tuning:${holdout.id}`,
      `approval_incomplete:${holdout.id}`,
    ]));
    expect(assessArchitectureInteriorReferenceManifest(manifest).eligible).toBe(false);
  });

  it('blocks a reference/holdout duplicate source hash', () => {
    const manifest = completeManifest();
    const reference = manifest.entries.find(entry => entry.role === 'reference')!;
    const holdout = manifest.entries.find(entry => entry.role === 'holdout')!;
    holdout.sourceHash = reference.sourceHash;
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toContain(`reference_holdout_hash_overlap:${reference.sourceHash}`);
    expect(assessArchitectureInteriorReferenceManifest(manifest).eligible).toBe(false);
  });

  it('fails closed when regression reuses a reference or holdout source hash', () => {
    const manifest = completeManifest();
    const reference = manifest.entries.find(entry => entry.role === 'reference')!;
    const regression = manifest.entries.find(entry => entry.role === 'regression')!;
    const holdout = manifest.entries.find(entry => entry.role === 'holdout')!;

    regression.sourceHash = reference.sourceHash;
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toContain(`role_hash_overlap:${reference.sourceHash}:reference:regression`);
    expect(assessArchitectureInteriorReferenceManifest(manifest).eligible).toBe(false);

    regression.sourceHash = hash('42');
    regression.sourceHash = holdout.sourceHash;
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toContain(`role_hash_overlap:${holdout.sourceHash}:holdout:regression`);
    expect(assessArchitectureInteriorReferenceManifest(manifest).eligible).toBe(false);
  });

  it('returns validation issues instead of throwing for malformed reviewer arrays', () => {
    const manifest = completeManifest();
    const entry = manifest.entries[0]!;
    (entry.approvalReceipt as unknown as { reviewerIds: unknown }).reviewerIds = 'reviewer-a';
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toEqual(expect.arrayContaining([
      `approval_reviewers_invalid:${entry.id}`,
      `approval_incomplete:${entry.id}`,
    ]));
  });

  it('allows manual metadata to share a licensed package with a reference entry', () => {
    const manifest = completeManifest();
    const manual = manifest.entries.find(entry => entry.role === 'manual')!;
    const reference = manifest.entries.find(entry => entry.role === 'reference')!;
    manual.sourceHash = reference.sourceHash;
    expect(validateArchitectureInteriorReferenceManifest(manifest)).toEqual([]);
  });

  it('binds office, apartment, and cafe to actual inventory hashes with split probes', () => {
    expect(validateArchitectureInteriorGoldenLineages()).toEqual([]);
    expect(ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES).toHaveLength(3);
    for (const lineage of ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES) {
      expect(lineage.scoreEligible).toBe(false);
      expect(lineage.holdoutTuningUses).toBe(0);
      expect(new Set(lineage.sources.map(source => source.role))).toEqual(new Set(['reference', 'regression', 'holdout']));
      expect(new Set(lineage.sources.map(source => source.sourceHash)).size).toBe(3);
      expect(lineage.sources.filter(source => source.format === 'rvt').every(source => source.probeMode === 'native_review')).toBe(true);
      expect(lineage.sources.filter(source => source.format !== 'rvt').every(source => source.probeMode === 'automated_probe')).toBe(true);
      expect(lineage.sources.every(source => source.licenseStatus === 'unknown' && source.approvalReceipt.decision === 'pending')).toBe(true);
    }
    expect(new Set(ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES.flatMap(lineage => lineage.sources.map(source => source.sourceHash))).size).toBe(9);
    expect(assessArchitectureInteriorGoldenLineages()).toMatchObject({ eligible: false, scenarioCount: 3, sourceCount: 9, holdoutTuningUses: 0 });
    expect(assessArchitectureInteriorGoldenLineages().blockers).toEqual(expect.arrayContaining([
      'lineage_license_not_approved:arch-single-storey-small-office:office-reference-ifc',
      'lineage_approval_incomplete:arch-multi-storey-apartment:apartment-holdout-rvt',
    ]));
  });

  it('fails closed instead of throwing for malformed golden-lineage reviewer arrays', () => {
    const lineages = structuredClone(ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES);
    const source = lineages[0]!.sources[0]!;
    (source.approvalReceipt as unknown as { reviewerIds: unknown }).reviewerIds = 'reviewer-a';
    expect(assessArchitectureInteriorGoldenLineages(lineages).blockers).toEqual(expect.arrayContaining([
      `lineage_approval_reviewers_invalid:${lineages[0]!.scenarioId}:${source.id}`,
      `lineage_approval_incomplete:${lineages[0]!.scenarioId}:${source.id}`,
    ]));
  });

  it('rejects lineage hash reuse, holdout tuning, and an RVT automated probe', () => {
    const lineages = structuredClone(ARCHITECTURE_INTERIOR_GOLDEN_LINEAGES) as any;
    const office = lineages[0]!;
    const reference = office.sources[0]!;
    const holdout = office.sources[2]!;
    holdout.sourceHash = reference.sourceHash;
    office.holdoutTuningUses = 1;
    reference.probeMode = 'native_review';
    expect(validateArchitectureInteriorGoldenLineages(lineages)).toEqual(expect.arrayContaining([
      `lineage_source_hash_overlap:${reference.sourceHash}`,
      'lineage_holdout_tuning_nonzero:arch-single-storey-small-office',
      'lineage_probe_mode_invalid:arch-single-storey-small-office:office-reference-ifc',
    ]));
    expect(assessArchitectureInteriorGoldenLineages(lineages).eligible).toBe(false);
  });
});
