/**
 * 부품 제작도 — 그룹핑 정확성과 **조용한 절단 금지** (260728, 복합 다물체 점검).
 *
 * 두 결함을 고정한다:
 *  1) `partAabb` **오호출**(2인자) — 이 함수는 단일 객체 `{type,...params}` 를 받는데
 *     여기만 `partAabb(p.type, p.params)` 로 불러 **모든 부품에서 throw** 했고, catch 가
 *     그것을 삼켜 dims 가 항상 [0,0,0] 이 됐다. 크기가 다른 부재가 한 군으로 뭉쳐
 *     제작도가 대표 1장만 나갔다(송전탑 99부재 → 5군).
 *  2) `groups.slice(0, maxSheets)` **조용한 절단** — 현수교 57군 중 24군만 발행되고
 *     33군이 아무 표시 없이 사라졌다.
 */
import { describe, it, expect } from 'vitest';
import { partSheets as _ps } from './part-sheets.mjs';
import { buildAssemblyTemplate as _bt } from './domain-assemblies.mjs';

const partSheets = _ps as unknown as (a: unknown, o?: Record<string, unknown>) => string;
const tpl = _bt as unknown as (d: string, id: string, p: Record<string, unknown>) => Record<string, unknown>;

describe('partSheets — 크기가 다른 부재를 한 군으로 뭉치지 않는다', () => {
  it('★엔벨로프가 실제로 산출된다 — 종전엔 전 부품에서 throw 해 0×0×0 이었다', () => {
    const html = partSheets(tpl('mech', 'transmission_tower', {}), { title: 't' });
    // 0×0×0 엔벨로프가 남아 있으면 partAabb 가 다시 죽고 있다는 뜻이다.
    expect(html).not.toContain('>0×0×0<');
    expect(html).not.toContain('엔벨로프를 산출하지 못한 부재');
  });

  it('길이가 다른 부재는 서로 다른 군으로 나뉜다', () => {
    // 같은 type·재질인데 길이만 다른 두 부재 → 2군이어야 한다.
    const asm = {
      name: 'g', parts: [
        { id: 'a', type: 'box', material: 'SS400', params: { width: 100, depth: 50, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'b', type: 'box', material: 'SS400', params: { width: 300, depth: 50, height: 20 }, at: { tx: 0, ty: 200, tz: 0 } },
      ],
    };
    const html = partSheets(asm, { title: 't' });
    expect(html).toContain('그룹 대표 2종');
  });
});

describe('partSheets — 시트 상한 초과분을 조용히 버리지 않는다', () => {
  const many = {
    name: 'many',
    parts: Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`, type: 'box', material: 'SS400',
      params: { width: 100 + i * 10, depth: 50, height: 20 },
      at: { tx: 0, ty: i * 100, tz: 0 },
    })),
  };

  it('★미발행 군을 부재 일람표로 싣고, 빠뜨린 것이 아님을 명시한다', () => {
    const html = partSheets(many, { title: 't', maxSheets: 5 });
    expect(html).toContain('부재 일람표');
    expect(html).toContain('개별 제작도 미발행 25종');
    expect(html).toContain('빠뜨린 것이 아니라');
    expect(html).toContain('일람표 25종');
  });

  it('★일람표에 제작 치수가 실제로 인쇄된다 — 게이트만 통과시키는 표기가 아니다', () => {
    const html = partSheets(many, { title: 't', maxSheets: 5 });
    // 마지막 부재의 폭(100+29*10=390)이 문서에 실제로 있어야 한다
    expect(html).toContain('width=390');
  });

  it('상한 안이면 일람표를 붙이지 않는다 (잡음 0)', () => {
    const html = partSheets(many, { title: 't', maxSheets: 40 });
    expect(html).not.toContain('부재 일람표');
    expect(html).not.toContain('미발행');
  });
});
