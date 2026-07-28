/**
 * 지지 공차와 용접 인접 공차 사이의 사각지대 (260729).
 *
 * 실측한 두 임계:
 *   · 지지 판정(support-check `tol`)  = 8mm — 이 안이면 "얹힘"으로 보고 supported
 *   · 용접 인접 판정                  ≈ 2mm — 이 밖이면 용접이 생기지 않는다
 *
 * 그 사이(약 3~8mm)에서는 **용접 0 · 부유 0 · designOk true** 가 되어, 아무것에도
 * 붙어 있지 않은 부재가 "형상 타당성(부유·간섭·배관) 이상 없음"으로 나갔다.
 *
 * support-check 는 이미 `faceContacts{part,on,gapMm,suggestTzMm}` 로 그 사실을
 * 산출하고 있었다 — 소비자 문서로 나가지 않았을 뿐이다(§6-G "판정이 소비자에 도달하지 않음").
 *
 * ⚠ 임계를 새로 만들지 않았다. 두 기존 판정의 자기정합만 본다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { easySummary } from './easy-summary.mjs';

type Built = {
  ok: boolean; welds?: unknown[]; support?: { floating: string[]; faceContacts: { gapMm: number }[] };
  designOk?: boolean;
};
const build = buildAssembly as unknown as (a: unknown) => Built;
const summary = easySummary as unknown as (a: unknown, o?: Record<string, unknown>) => string;

/** at.tz 는 **최소 코너**(중심 아님). base z 0..100, 보 바닥 z = 100 + gap. */
const rig = (gap: number) => ({
  name: '접촉', domain: 'mech',
  parts: [
    { id: 'base', type: 'box', role: 'slab', material: 'steel', params: { width: 2000, depth: 2000, height: 100 }, at: { tx: 0, ty: 0, tz: 0 } },
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `bm_${i}`, type: 'box', role: 'beam', material: 'steel',
      params: { width: 1800, depth: 100, height: 150 }, at: { tx: 100, ty: 200 + i * 400, tz: 100 + gap },
    })),
  ],
});
const text = (gap: number) =>
  summary(rig(gap), { title: 't', domain: 'mech' }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('지지·용접 공차 사이 사각지대', () => {
  it('사각지대가 실재한다 — 5mm 에서 용접 0·부유 0·designOk true', () => {
    // 이 테스트는 결함을 고정하는 것이 아니라 **전제를 고정**한다. 두 공차가 바뀌어
    // 사각지대가 사라지면 여기서 먼저 알게 된다.
    const b = build(rig(5));
    expect(b.welds).toHaveLength(0);
    expect(b.support?.floating).toHaveLength(0);
    expect(b.designOk).toBe(true);
    expect(b.support?.faceContacts.length).toBeGreaterThan(0); // 판정은 이미 있었다
  });

  it('사각지대에서 소비자가 틈을 본다 — 종전엔 "이상 없음"뿐이었다', () => {
    const t = text(5);
    expect(t).toContain('얹혀만 있고 접합이 없는 자리 4군데');
    expect(t).toContain('틈 5mm');
    expect(t).toContain('떠 있습니다');
  });

  it('판정문이 "부유 이상 없음"을 한정한다', () => {
    expect(text(5)).toContain('떠 있는 채 접합 없는 자리 4군데');
  });

  it('권장 매립량을 함께 준다 — 3D 파일에서 별개 덩어리로 떨어지는 문제', () => {
    const t = text(5);
    expect(t).toContain('별개 덩어리로 떨어집니다');
    expect(t).toMatch(/권장 매립: bm_0 -\d+mm/);
  });

  it('맞닿아 용접이 잡히면 "떠 있다"고 하지 않는다 — 과잉 경고 금지', () => {
    const b = build(rig(0));
    expect((b.welds ?? []).length).toBeGreaterThan(0);
    const t = text(0);
    expect(t).not.toContain('떠 있습니다');
    expect(t).not.toContain('떠 있는 채 접합 없는 자리');
  });

  it('공차 밖(9mm)은 종전대로 부유로 잡힌다 — 회귀 없음', () => {
    const b = build(rig(9));
    expect(b.support?.floating).toHaveLength(4);
    expect(b.designOk).toBe(false);
    expect(text(9)).toContain('부유 부품 4개');
  });
});
