import { describe, expect, it } from 'vitest';
import { chatContextPreamble, isReverseProgramResult, programFromNfab } from './programFromNfab';

function nfab(
  selectedId: string,
  params: Record<string, number>,
  featureNodes: Array<Record<string, unknown>>,
) {
  const rootId = 'base-root';
  return {
    magic: 'nfab', version: 3, createdAt: 1, updatedAt: 1, name: 'test',
    tree: {
      rootId,
      activeNodeId: featureNodes.length ? String(featureNodes.at(-1)?.id) : rootId,
      nodes: [
        { id: rootId, type: 'baseShape', params: {}, enabled: true, parentId: null },
        ...featureNodes,
      ],
    },
    scene: { selectedId, params, paramExpressions: {} },
  };
}

describe('programFromNfab', () => {
  it('projects mapped features with stable source ids and exact coordinate reversal', async () => {
    const result = await programFromNfab(nfab('box', { width: 100, depth: 60, height: 8 }, [
      {
        id: 'hole-stable', type: 'feature', featureType: 'hole', enabled: true,
        parentId: 'base-root', params: { diameter: 8, posX: -25, posZ: 5, holeType: 0, depth: 999 },
      },
      {
        id: 'fillet-stable', type: 'feature', featureType: 'fillet', enabled: true,
        parentId: 'hole-stable', params: { radius: 3 },
      },
    ]));
    if (!result) throw new Error('expected reverse program');
    expect(result?.program.features[0]).toMatchObject({ id: 'base-root', shape: 'rect', width: 100, depth: 60, height: 8 });
    expect(result?.program.features[1]).toMatchObject({ id: 'hole-stable', type: 'hole', diameter: 8, posX: -25, posY: 5 });
    expect(result?.program.features[2]).toMatchObject({ id: 'fillet-stable', type: 'fillet', radius: 3 });
    expect(result?.unmapped).toEqual([]);
    expect(result?.editPolicy.wholeModelRegenerationAllowed).toBe(false);
    expect(result?.designGraph.revisionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(isReverseProgramResult(result)).toBe(true);
    expect(isReverseProgramResult({ ...result, designGraph: { ...result.designGraph, revisionSha256: 'stale' } })).toBe(false);
  });

  it('retains opaque and disabled nodes in the lossless graph instead of silently dropping them', async () => {
    const result = await programFromNfab(nfab('cylinder', { diameter: 50, height: 400 }, [
      {
        id: 'loft-exact', type: 'feature', featureType: 'loft', enabled: true,
        parentId: 'base-root', params: { sectionCount: 2 },
        sketchData: { future: { preserve: true } },
      },
      {
        id: 'disabled-hole', type: 'feature', featureType: 'hole', enabled: false,
        parentId: 'loft-exact', params: { diameter: 8 },
      },
    ]));
    expect(result?.program.features).toHaveLength(1);
    expect(result?.unmapped).toEqual(['loft']);
    expect(result?.editPolicy.protectedNodeIds).toEqual(['disabled-hole', 'loft-exact']);
    expect(result?.designGraph.nodes.find(node => node.id === 'loft-exact')?.source)
      .toMatchObject({ sketchData: { future: { preserve: true } } });
    expect(chatContextPreamble(result!)).toContain('전체 모델을 재생성하거나 기존 피처를 생략하지 말 것');
    expect(chatContextPreamble(result!)).toContain(result!.designGraph.revisionSha256);
  });

  it('maps shell and axis-aligned rib but protects selection/expression semantics', async () => {
    const result = await programFromNfab(nfab('box', { width: 100, depth: 60, height: 20 }, [
      {
        id: 'shell-1', type: 'feature', featureType: 'shell', enabled: true,
        parentId: 'base-root', params: { wallThickness: 2, openFace: 2 },
        faceSelections: [{ persistentId: 'face:top' }],
      },
      {
        id: 'rib-1', type: 'feature', featureType: 'rib', enabled: true,
        parentId: 'shell-1', params: { startX: -20, startZ: 5, endX: 20, endZ: 5, thickness: 4, height: 15 },
        paramExpressions: { height: '=RIB_H' },
      },
    ]));
    expect(result?.program.features[1]).toMatchObject({ id: 'shell-1', wallThickness: 2, openFace: 'bottom' });
    expect(result?.program.features[2]).toMatchObject({ id: 'rib-1', length: 40, posX: 0, posY: 5, alongY: false });
    expect(result?.editPolicy.protectedNodeIds).toEqual(['rib-1', 'shell-1']);
  });

  it('fails closed when the base or NFAB identity cannot be represented', async () => {
    expect(await programFromNfab(nfab('lBracket', {}, []))).toBeNull();
    expect(await programFromNfab({ scene: { selectedId: 'box', params: {} } })).toBeNull();
    expect(await programFromNfab(null)).toBeNull();
  });
});
