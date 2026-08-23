import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bindConstructionPlan } from '../provenance';
import { buildConstructionChangeImpact, canonical, validateConstructionChangeImpact, type ConstructionChangeImpactSource } from '../changeImpact';
import { rcFramePlan } from '../module';
import type { ConstructionPackage } from '../module';

const source = (value: ConstructionChangeImpactSource['value'], revisionNumber: number, workspaceLineageId = 'bim-project'): ConstructionChangeImpactSource => ({ value, revisionNumber, workspaceLineageId });
const bind = (revision: string, hash: string, mutate?: (plan: ReturnType<typeof rcFramePlan>) => void) => {
  const plan = rcFramePlan();
  mutate?.(plan);
  return bindConstructionPlan(plan, { workspaceRevisionId: `${revision}:r${hash}`, workspaceContentHash: hash.repeat(64) }).revisionBinding!;
};

describe('construction BIM revision change-impact provenance', () => {
  it('deterministically reports concrete quantity and activity schedule impacts', () => {
    const before = bind('bim-project', 'a', undefined);
    const after = bind('bim-project', 'b', (plan) => { plan.concreteElements[0]!.L_m += 0.1; plan.activities[1]!.duration_days += 1; });
    const result = buildConstructionChangeImpact({ before: source(before, 4), after: source(after, 5) });
    expect(result.changes.filter((item) => item.kind === 'changed').map((item) => item.objectId)).toEqual(['bim:rc-frame:activity-pour', 'bim:rc-frame:beam-01']);
    expect(result.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectId: 'bim:rc-frame:beam-01', impact: 'quantity', changeKind: 'changed' }),
      expect.objectContaining({ objectId: 'bim:rc-frame:activity-pour', impact: 'schedule', changeKind: 'changed' }),
    ]));
    expect(result.counts).toMatchObject({ added: 0, removed: 0, changed: 2, unchanged: 6, quantityImpacts: 1, scheduleImpacts: 1 });
    expect(validateConstructionChangeImpact(result)).toEqual([]);
    expect(result.resultSha256).toBe(buildConstructionChangeImpact({ before: source(before, 4), after: source(after, 5) }).resultSha256);
  });

  it('accepts a verified package boundary only with HOLD/NOT_RUN claims and rejects authority promotion', () => {
    const before = bind('bim-project', 'a');
    const after = bind('bim-project', 'b');
    const packageLike = {
      provenance: { revisionBinding: after, quantityObjects: after.objectBindings },
      claimBoundary: { actualCostEvidence: 'NOT_RUN' as const, actualSiteEvidence: 'NOT_RUN' as const, releaseEligible: false as const },
    } as unknown as ConstructionPackage;
    const result = buildConstructionChangeImpact({ before: source(before, 1), after: source(packageLike, 2) });
    expect(result.releaseEligible).toBe(false);
    const promoted = structuredClone(packageLike) as typeof packageLike;
    promoted.provenance.priceEvidence = { sourceId: 'real', sourceSha256: 'f'.repeat(64), authority: 'authoritative' };
    expect(() => buildConstructionChangeImpact({ before: source(before, 1), after: source(promoted, 2) })).toThrow('PACKAGE_AUTHORITY_CLAIM');
  });

  it('fails closed for legacy IDs, tampering, unknown/duplicate IDs, lineage mismatch, and reverse/equal revisions', () => {
    const before = bind('bim-project', 'a');
    const after = bind('bim-project', 'b');
    const legacyPlan = rcFramePlan();
    for (const item of [...legacyPlan.concreteElements, ...legacyPlan.rebarGroups, ...(legacyPlan.formworkElements ?? []), ...legacyPlan.activities]) delete item.objectId;
    const legacy = bindConstructionPlan(legacyPlan, { revisionId: 'legacy:r1', revisionSha256: 'c'.repeat(64) }).revisionBinding!;
    expect(() => buildConstructionChangeImpact({ before: source(legacy, 1), after: source(after, 2) })).toThrow('LEGACY_DERIVED_BINDING');
    const tampered = structuredClone(after); tampered.objectBindings[0]!.sourceObjectSha256 = 'f'.repeat(64);
    expect(() => buildConstructionChangeImpact({ before: source(before, 1), after: source(tampered, 2) })).toThrow('BINDING_HASH_MISMATCH');
    expect(() => buildConstructionChangeImpact({ before: source(before, 2), after: source(after, 2) })).toThrow('WORKSPACE_REVISION_NOT_INCREASING');
    expect(() => buildConstructionChangeImpact({ before: source(before, 3), after: source(after, 2) })).toThrow('WORKSPACE_REVISION_NOT_INCREASING');
    expect(() => buildConstructionChangeImpact({ before: source(before, 1, 'other-project'), after: source(after, 2) })).toThrow('WORKSPACE_LINEAGE_MISMATCH');
  });

  it('rejects a structurally forged result even when the attacker recomputes resultSha256', () => {
    const before = bind('bim-project', 'a');
    const after = bind('bim-project', 'b', (plan) => { plan.concreteElements[0]!.L_m += 0.1; });
    const result = buildConstructionChangeImpact({ before: source(before, 1), after: source(after, 2) });
    const forged = structuredClone(result);
    const forgedChanged = forged.changes.find((item) => item.kind === 'changed')!;
    const forgedObjectId = forgedChanged.objectId;
    forgedChanged.kind = 'unchanged';
    forgedChanged.id = `change:unchanged:${forgedChanged.role}:${forgedChanged.objectId}`;
    const { resultSha256: _ignored, ...draft } = forged;
    forged.resultSha256 = createHash('sha256').update(canonical(draft), 'utf8').digest('hex');
    expect(validateConstructionChangeImpact(forged)).toEqual(expect.arrayContaining(['change_impact_change_row_mismatch:' + forgedObjectId]));
  });

  it('derives role changes independently from source hashes and rejects a rehashed forged role', () => {
    const before = bind('bim-project', 'a');
    const after = bind('bim-project', 'b');
    const roleChanged = structuredClone(after);
    const target = roleChanged.objectBindings.find((item) => item.objectId === 'bim:rc-frame:beam-01')!;
    target.role = 'schedule';
    roleChanged.bindingSha256 = createHash('sha256').update(canonical({ revisionId: roleChanged.revisionId, revisionSha256: roleChanged.revisionSha256, workspaceRevisionId: roleChanged.workspaceRevisionId, workspaceContentHash: roleChanged.workspaceContentHash, bindingMode: roleChanged.bindingMode, payloadSha256: roleChanged.payloadSha256, objectBindings: roleChanged.objectBindings }), 'utf8').digest('hex');
    const result = buildConstructionChangeImpact({ before: source(before, 1), after: source(roleChanged, 2) });
    const changed = result.changes.find((item) => item.objectId === target.objectId)!;
    expect(changed).toMatchObject({ role: 'schedule', kind: 'changed', beforeSourceObjectSha256: result.beforeObjectBindingHashes[target.objectId]!.sourceObjectSha256, afterSourceObjectSha256: result.afterObjectBindingHashes[target.objectId]!.sourceObjectSha256 });
    expect(result.impacts.find((item) => item.objectId === target.objectId)?.impact).toBe('schedule');
    expect(validateConstructionChangeImpact(result)).toEqual([]);

    const forged = structuredClone(result);
    const forgedChanged = forged.changes.find((item) => item.objectId === target.objectId)!;
    forgedChanged.role = 'concrete';
    forgedChanged.id = `change:${forgedChanged.kind}:concrete:${forgedChanged.objectId}`;
    const forgedImpact = forged.impacts.find((item) => item.objectId === target.objectId)!;
    forgedImpact.role = 'concrete';
    forgedImpact.id = `impact:${forgedImpact.changeKind}:concrete:${forgedImpact.objectId}`;
    forgedImpact.impact = 'quantity';
    const { resultSha256: _ignored, ...draft } = forged;
    forged.resultSha256 = createHash('sha256').update(canonical(draft), 'utf8').digest('hex');
    expect(validateConstructionChangeImpact(forged)).toEqual(expect.arrayContaining(['change_impact_change_row_mismatch:' + target.objectId, 'change_impact_impacts_mismatch']));
  });
});
