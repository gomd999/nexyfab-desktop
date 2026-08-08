/**
 * P-2 역루프 순수 코어 — 왕복 정합(programToFeatures의 posY→posZ 사상의 정확한
 * 역), 미매핑 피처의 명시 반환(조용한 누락 금지), 베이스 불가 시 null.
 */
import { describe, expect, it } from 'vitest';
import { programFromNfab, chatContextPreamble } from './programFromNfab';

describe('programFromNfab (P-2)', () => {
  it('round-trips a box + hole + fillet, reversing the posZ→posY mapping', () => {
    const r = programFromNfab({
      scene: { selectedId: 'box', params: { width: 100, depth: 60, height: 8 } },
      tree: { nodes: [
        { featureType: 'hole', enabled: true, params: { diameter: 8, posX: -25, posZ: 5, holeType: 0, depth: 999 } },
        { featureType: 'fillet', enabled: true, params: { radius: 3 } },
      ] },
    })!;
    expect(r.program.features[0]).toMatchObject({ type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 });
    expect(r.program.features[1]).toMatchObject({ type: 'hole', diameter: 8, posX: -25, posY: 5 });
    expect(r.program.features[2]).toMatchObject({ type: 'fillet', radius: 3 });
    expect(r.unmapped).toEqual([]);
  });

  it('lists out-of-vocabulary features honestly and skips disabled nodes', () => {
    const r = programFromNfab({
      scene: { selectedId: 'cylinder', params: { diameter: 50, height: 400 } },
      tree: { nodes: [
        { featureType: 'shell', enabled: true, params: { wallThickness: 2 } },
        { featureType: 'hole', enabled: false, params: { diameter: 8 } }, // 비활성=제외
      ] },
    })!;
    expect(r.program.features).toHaveLength(1);
    expect(r.program.features[0]).toMatchObject({ shape: 'circle', width: 50, height: 400 });
    expect(r.unmapped).toEqual(['shell']);
    expect(chatContextPreamble(r)).toContain('shell');
    expect(chatContextPreamble(r)).toContain('반영되지 못했다');
  });

  it('returns null when the base cannot be represented (no silent partial context)', () => {
    expect(programFromNfab({ scene: { selectedId: 'lBracket', params: {} }, tree: { nodes: [] } })).toBeNull();
    expect(programFromNfab(null)).toBeNull();
  });
});
