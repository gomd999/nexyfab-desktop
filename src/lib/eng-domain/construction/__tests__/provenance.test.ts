import { describe, expect, it } from 'vitest';
import { constructionModule, rcFramePlan } from '../module';
import { bindConstructionPlan, constructionSha256, validateConstructionProvenance } from '../provenance';
import { runDomainDriver } from '@/lib/domain-driver';

describe('construction BOQ/schedule provenance contract', () => {
  it('binds every quantity and schedule object to the same revision and source hash', () => {
    const plan = rcFramePlan();
    expect(validateConstructionProvenance(plan)).toEqual([]);
    expect(plan.revisionBinding?.objectBindings).toHaveLength(8);
    expect(new Set(plan.revisionBinding?.objectBindings.map((item) => item.objectId)).size).toBe(8);
    expect(plan.revisionBinding?.payloadSha256).toBe(constructionSha256({
      concreteElements: plan.concreteElements,
      rebarGroups: plan.rebarGroups,
      formworkElements: plan.formworkElements,
      activities: plan.activities,
      earthwork: plan.earthwork,
      costLineItems: plan.costLineItems,
      budget: plan.budget,
      contingencyFactor: plan.contingencyFactor,
    }));
  });

  it('detects a re-priced cost row even when the evidence envelope is unchanged', () => {
    const plan = rcFramePlan();
    plan.costLineItems![0]!.unitRate += 1;
    expect(validateConstructionProvenance(plan)).toContain('construction_payload_hash_mismatch');
  });

  it('refuses a stale source revision payload before producing a package', async () => {
    const plan = rcFramePlan();
    plan.concreteElements[0]!.L_m = 6.1;
    expect(validateConstructionProvenance(plan)).toContain('construction_payload_hash_mismatch');
    const result = await runDomainDriver({ id: 'stale' }, { ...constructionModule, plan: () => plan });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toContain('provenance incomplete');
  });

  it('refuses cost/site outputs when authority evidence is absent', async () => {
    const plan = rcFramePlan();
    delete plan.priceEvidence;
    delete plan.siteEvidence;
    const result = await runDomainDriver({ id: 'missing-authority' }, { ...constructionModule, plan: () => plan });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.reason).toContain('construction_price_evidence_missing');
      expect(result.refusal.reason).toContain('construction_site_evidence_missing');
    }
  });

  it('keeps a schedule-only package bound when no cost/site claim is made', async () => {
    const source = rcFramePlan();
    const plan = bindConstructionPlan({
      ...source,
      costLineItems: undefined,
      budget: undefined,
      earthwork: undefined,
      priceEvidence: undefined,
      siteEvidence: undefined,
    }, { revisionId: 'schedule-only:r1', revisionSha256: 'b'.repeat(64) });
    const result = await runDomainDriver({ id: 'schedule-only' }, { ...constructionModule, plan: () => plan });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.package.provenance.revisionBinding.revisionId).toBe('schedule-only:r1');
      expect(result.package.provenance.revisionBinding.bindingMode).toBe('legacy_derived');
      expect(result.package.claimBoundary).toEqual({ actualCostEvidence: 'NOT_APPLICABLE', actualSiteEvidence: 'NOT_APPLICABLE', releaseEligible: false });
    }
  });

  it('keeps fixture evidence visibly NOT_RUN and never release-eligible', async () => {
    const result = await runDomainDriver({ id: 'fixture-boundary' }, { ...constructionModule, plan: () => rcFramePlan() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.claimBoundary).toEqual({ actualCostEvidence: 'NOT_RUN', actualSiteEvidence: 'NOT_RUN', releaseEligible: false });
    expect(result.package.disclaimer).toContain('fixture');
  });

  it('requires explicit BIM object IDs and binds the preferred workspace aliases', () => {
    const source = rcFramePlan();
    delete source.concreteElements[0]!.objectId;
    expect(() => bindConstructionPlan(source, { workspaceRevisionId: 'bim-workspace:r2', workspaceContentHash: 'c'.repeat(64) })).toThrow('missing BIM object id');
    const rebound = bindConstructionPlan(rcFramePlan(), { workspaceRevisionId: 'bim-workspace:r2', workspaceContentHash: 'c'.repeat(64) });
    expect(rebound.revisionBinding).toMatchObject({ revisionId: 'bim-workspace:r2', revisionSha256: 'c'.repeat(64), workspaceRevisionId: 'bim-workspace:r2', workspaceContentHash: 'c'.repeat(64), bindingMode: 'workspace_explicit' });
    expect(rebound.revisionBinding?.objectBindings.every(item => item.bimObjectId === item.objectId && item.workspaceRevisionId === 'bim-workspace:r2' && item.workspaceContentHash === 'c'.repeat(64))).toBe(true);
    expect(() => bindConstructionPlan(rcFramePlan(), { workspaceRevisionId: 'bim-workspace:r2', revisionSha256: 'c'.repeat(64) })).toThrow('incomplete workspace revision binding');
  });

  it('rejects missing quantity ownership, revision/hash tampering, and promoted authority claims', () => {
    const missing = rcFramePlan();
    missing.revisionBinding!.objectBindings.pop();
    expect(validateConstructionProvenance(missing)).toContain('construction_object_binding_count_mismatch');
    const stale = rcFramePlan();
    stale.revisionBinding!.objectBindings[0]!.workspaceContentHash = 'd'.repeat(64);
    expect(validateConstructionProvenance(stale)).toContain('construction_object_revision_mismatch:concrete:bim:rc-frame:beam-01');
    const revisionTampered = rcFramePlan();
    revisionTampered.revisionBinding!.revisionSha256 = 'd'.repeat(64);
    expect(validateConstructionProvenance(revisionTampered)).toContain('construction_binding_hash_mismatch');
    const promoted = rcFramePlan();
    promoted.priceEvidence = { sourceId: 'real-price', sourceSha256: 'e'.repeat(64), authority: 'authoritative' };
    expect(validateConstructionProvenance(promoted)).toContain('construction_price_authority_claim_not_allowed');
  });
});
