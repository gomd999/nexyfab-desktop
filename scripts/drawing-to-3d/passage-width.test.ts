/**
 * N4/D-L2 — 통로 유효폭 게이트: 침식+도달성. 열린 실은 통과, 인위적 병목
 * (400mm 틈)은 900mm 기준에서 걸리고 350mm 기준으로는 통과해야 한다.
 */
import { describe, expect, it } from 'vitest';
import { passageWidthCheck } from './interior-check.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

function chokeRoom(gapMm: number) {
  // 6m×4m 실, 출입구 남측 중앙 900. 방 한가운데를 가로지르는 카운터 두 개가
  // gapMm 틈만 남긴다 → 북측 절반은 그 틈으로만 도달 가능.
  const W = 6000, D = 4000, counterD = 600;
  const leftLen = (W - gapMm) / 2;
  return {
    name: 'choke', domain: 'interior', kind: 'room',
    roomBounds: { W, D },
    exits: [{ x: W / 2, y: 0, widthMm: 900 }],
    parts: [
      { id: 'c1', type: 'box', params: { width: leftLen, depth: counterD, height: 1100 }, at: { tx: 0, ty: D / 2 - counterD / 2 }, role: 'counter' },
      { id: 'c2', type: 'box', params: { width: leftLen, depth: counterD, height: 1100 }, at: { tx: leftLen + gapMm, ty: D / 2 - counterD / 2 }, role: 'counter' },
    ],
  };
}

describe('passageWidthCheck (N4 · D-L2)', () => {
  it('open cafe room passes at 600mm', () => {
    const cafe = buildAssemblyTemplate('interior', 'cafe_room', {});
    const r = passageWidthCheck(cafe, { minWidthMm: 600 });
    expect(r.ok).toBe(true);
    expect(r.pass).toBe(true);
  });

  it('a 400mm choke fails the 900mm gate but passes a 350mm gate', () => {
    const fail = passageWidthCheck(chokeRoom(400), { minWidthMm: 900 });
    expect(fail.ok).toBe(true);
    expect(fail.pass).toBe(false);
    const passNarrow = passageWidthCheck(chokeRoom(400), { minWidthMm: 350 });
    expect(passNarrow.pass).toBe(true);
  });

  it('honest refusals without room meta', () => {
    expect(passageWidthCheck({ parts: [] }).ok).toBe(false);
  });
});
