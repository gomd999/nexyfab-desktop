import { describe, expect, it } from 'vitest';
import {
  createAiDesign2d3dSyncContract,
  preview2dTo3dImpact,
  preview3dGaugeTo2dUpdate,
  syncAiDesignSelection,
  type StableSyncRef,
} from './aiDesign2d3dSync';

const ref = (kind: StableSyncRef['kind'], id: string): StableSyncRef => ({ kind, id });

function contract() {
  return createAiDesign2d3dSyncContract({
    projectId: 'project-1', revision: 'rev-7', focus: 'split',
    twoDToThreeD: [
      { source: ref('dimension', 'dim-hole'), targets: [ref('parameter', 'param-hole')] },
      { source: ref('drawing_entity', 'entity-plate'), targets: [ref('feature', 'feature-plate')] },
    ],
    threeDToTwoD: [
      { source: ref('parameter', 'param-hole'), targets: [ref('dimension', 'dim-hole')] },
    ],
  });
}

describe('AI Design 2D/3D synchronization contract', () => {
  it('synchronizes stable selections in split focus', () => {
    const result = syncAiDesignSelection(contract(), { source: '2d', refs: [ref('dimension', 'dim-hole')] });
    expect(result).toMatchObject({ status: 'SYNCED', targets: [ref('parameter', 'param-hole')] });
  });

  it('fails closed for ambiguous mappings instead of guessing', () => {
    const base = contract();
    const ambiguous = createAiDesign2d3dSyncContract({ ...base, twoDToThreeD: [{ source: ref('dimension', 'dim-hole'), targets: [ref('parameter', 'a'), ref('parameter', 'b')] }] });
    const result = syncAiDesignSelection(ambiguous, { source: '2d', refs: [ref('dimension', 'dim-hole')] });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.unresolved[0].candidates).toHaveLength(2);
  });

  it('returns preview-only 2D impact and 3D gauge update results', () => {
    const c = contract();
    const impact = preview2dTo3dImpact(c, [ref('drawing_entity', 'entity-plate')]);
    const update = preview3dGaugeTo2dUpdate(c, ref('parameter', 'param-hole'));
    expect(impact).toMatchObject({ kind: '2d_to_3d_impact_preview', previewOnly: true, commitAllowed: false, status: 'SYNCED' });
    expect(update).toMatchObject({ kind: '3d_to_2d_drawing_update_preview', previewOnly: true, commitAllowed: false, status: 'SYNCED' });
  });

  it('requires input when a requested reference is not mapped', () => {
    const result = preview3dGaugeTo2dUpdate(contract(), ref('parameter', 'unknown-gauge'));
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.unresolved[0].candidates).toEqual([]);
  });

  it('rejects cross-domain mappings and fails closed for invalid request kinds', () => {
    expect(() => createAiDesign2d3dSyncContract({
      projectId: 'project-1', revision: 'rev-1', focus: 'split',
      twoDToThreeD: [{ source: ref('feature', 'feature-1'), targets: [ref('dimension', 'dimension-1')] }],
      threeDToTwoD: [],
    })).toThrow('AI_DESIGN_2D_3D_SYNC_INVALID_ID');
    expect(syncAiDesignSelection(contract(), { source: '2d', refs: [ref('feature', 'feature-1')] })).toMatchObject({ status: 'NEEDS_INPUT', targets: [] });
  });
});
