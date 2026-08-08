/**
 * K5 심화 — HLR 실투영+해석 치수: 치수 텍스트가 모델 파라미터와 일치하고
 * (픽셀 측정 아님), 구멍 위치/지름 콜아웃이 실린다. OCCT wasm 필요 — 게이트
 * 규약은 이웃 스위트(RUN_OCCT_FEASIBILITY)와 동일.
 */
import { describe, expect, it } from 'vitest';
import { hlrDrawingWithDims } from './hlr-drawing.mjs';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

describeMaybe('HLR drawing with analytic dims (K5)', () => {
  it('plate with holes: real projection + parameter-sourced dimensions', async () => {
    const asm = {
      name: 'plate', domain: 'mech',
      parts: [{
        id: 'p', type: 'plate_with_holes',
        params: { width: 100, depth: 60, thickness: 10, holes: [{ x: 25, y: 30, d: 8 }, { x: 75, y: 30, d: 8 }] },
        at: {},
      }],
    };
    const r = await hlrDrawingWithDims(asm, { views: ['front', 'top'] });
    expect(r.ok).toBe(true);
    expect(r.dims.overall).toEqual({ W: 100, D: 60, H: 10 });
    // front: 전폭·전고 치수 + 실투영 path 존재
    expect(r.views.front).toContain('>100<');
    expect(r.views.front).toContain('>10<');
    expect((r.views.front.match(/<path/g) ?? []).length).toBeGreaterThan(2);
    // top: 깊이·구멍 위치(25/75)·⌀그룹
    expect(r.views.top).toContain('>60<');
    expect(r.views.top).toContain('>25<');
    expect(r.views.top).toContain('>75<');
    expect(r.views.top).toContain('⌀8×2');
    // 은선(파선) 렌더가 남아 있다 — 실투영 증거
    expect(r.views.front).toContain('stroke-dasharray');
  }, 120_000);
});
