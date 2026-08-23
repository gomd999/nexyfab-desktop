import { describe, expect, it } from 'vitest';
import { buildEditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import { holedPlatePlan, lBracketPlan, revolveBushingPlan, steppedShaftPlan } from '@/lib/ai/design-driver/fixturePlanner';
import { workspaceCandidateToModelerDraft } from './workspaceCandidateToModeler';

describe('workspace candidate to modeler draft', () => {
  it('builds one atomic editable polygon history for an L bracket', () => {
    const result = workspaceCandidateToModelerDraft(buildEditableWorkspaceCandidate(lBracketPlan()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.baseShape).toEqual({ id: 'none', params: {} });
    expect(result.draft.features).toHaveLength(1);
    expect(result.draft.features[0]).toMatchObject({ type: 'sketchExtrude', enabled: true });
    expect(result.draft.features[0]?.sketchData?.profile.segments).toHaveLength(6);
    expect(result.draft.history.nodes).toHaveLength(2);
  });

  it('builds an exact-kernel rectangular base with four editable through holes', () => {
    const result = workspaceCandidateToModelerDraft(buildEditableWorkspaceCandidate(holedPlatePlan()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.baseShape).toEqual({ id: 'box', params: { width: 120, height: 10, depth: 80 } });
    expect(result.draft.features).toHaveLength(4);
    expect(result.draft.features.every(feature => feature.type === 'hole')).toBe(true);
    expect(result.draft.features[0]?.params).toMatchObject({
      diameter: 6.5,
      posX: -50,
      posZ: -30,
      endCondition: 1,
      engine: 1,
    });
    expect(result.draft.reverificationRequired).toBe(true);
  });

  it('builds a stepped shaft as an exact cylinder base plus one editable coaxial boss', () => {
    const result = workspaceCandidateToModelerDraft(buildEditableWorkspaceCandidate(steppedShaftPlan()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.baseShape).toEqual({ id: 'cylinder', params: { diameter: 24, height: 30 } });
    expect(result.draft.features).toHaveLength(1);
    expect(result.draft.features[0]).toMatchObject({ type: 'sketchExtrude', enabled: true });
    expect(result.draft.features[0]?.sketchData?.faceFrame).toEqual({
      origin: [0, 15, 0],
      normal: [0, 1, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
    });
    expect(result.draft.features[0]?.sketchData?.config.depth).toBe(25);
  });

  it('uses an exact cylinder base for a supported full-turn revolve', () => {
    const result = workspaceCandidateToModelerDraft(buildEditableWorkspaceCandidate(revolveBushingPlan()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.baseShape).toEqual({ id: 'cylinder', params: { diameter: 50, height: 60 } });
    expect(result.draft.features).toHaveLength(0);
  });

  it.each([
    ['schema', 'nexyfab.editable-workspace-candidate.v0', 'workspace_candidate_schema_invalid'],
    ['reverificationRequired', false, 'workspace_candidate_reverification_required'],
    ['inheritedVerification', true, 'workspace_candidate_inherited_verification_forbidden'],
    ['manufacturingReleaseReady', true, 'workspace_candidate_release_claim_forbidden'],
  ] as const)('fails closed when the HTTP candidate changes %s', (field, value, blocker) => {
    const candidate = buildEditableWorkspaceCandidate(lBracketPlan());
    const tampered = { ...candidate, [field]: value } as typeof candidate;
    expect(workspaceCandidateToModelerDraft(tampered)).toEqual({ ok: false, blockers: [blocker] });
  });
});
