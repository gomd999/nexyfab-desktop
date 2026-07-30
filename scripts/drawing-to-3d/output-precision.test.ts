/**
 * output-precision.test.ts — 산출물에 **없는 정밀도**를 적지 않는다 (260802).
 *
 * ## 왜 생겼나 — 라이브 실측
 * 배포본 문서를 훑으니 두 종류가 나왔다:
 * ```
 * 안전검토.html    통상 0.08333333333333333 이상   ← 실제로는 H/12 라는 **관례값**
 * 부품제작도.html  y1="58.400000000000006"        ← 부동소수 잔재(실제 58.4)
 * ```
 * 앞의 것이 더 나쁘다: 16자리로 찍히면 **그만큼 정밀해 보이는데 그 정밀도는 없다**(과고지).
 * 뒤의 것은 SVG 좌표라 형상에는 영향이 없지만 파일을 키우고 오독을 부른다.
 *
 * ## ⚠ 반올림이 답이 아니었다
 * `0.083` 으로 줄이면 **관례값이라는 사실이 사라진다.** 그래서 값을 줄인 게 아니라
 * **원래 표기(`H/12`)를 보여 준다** — 비교는 원값으로, 표시만 바꾼다.
 */
import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyReportHtml } from './domain-dossier-verify.mjs';
import { partSheets } from './part-sheets.mjs';
import { ga2dDrawing } from './package.mjs';

const tpl = (d: string, id: string): unknown =>
  (buildAssemblyTemplate as unknown as (a: string, b: string) => unknown)(d, id);
/** 스타일·스크립트는 제외한다 — 사람이 읽는 본문만 본다. */
const strip = (h: string): string =>
  h.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
const longDecimals = (h: string): string[] => [...strip(h).matchAll(/\d+\.\d{7,}/g)].map((m) => m[0]);

describe('안전검토 — 한계값을 16자리 소수로 적지 않는다', () => {
  it.each(['retaining_wall_run', 'box_culvert', 'retaining_wall_alignment'])('civil/%s', (id) => {
    const html = (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(tpl('civil', id), { params: {} });
    expect(html).toBeTruthy();
    const bad = longDecimals(html!);
    expect(bad, `과도한 소수: ${bad.slice(0, 3).join(', ')}`).toEqual([]);
  });

  it('★관례값은 **원래 표기**로 보인다 — 반올림하면 관례라는 사실이 사라진다', () => {
    const html = (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
      tpl('civil', 'retaining_wall_run'), { params: {} }) ?? '';
    expect(html).toMatch(/H\/12/);
    expect(html).toMatch(/B\/3/);
  });
});

describe('부품 제작도 — SVG 좌표에 부동소수 잔재가 없다', () => {
  it.each(['gear_train', 'conveyor', 'tower_crane'])('mech/%s', (id) => {
    const r = (partSheets as unknown as (a: unknown, o: unknown) => { html?: string } | string)(tpl('mech', id), { title: 't' });
    const html = typeof r === 'string' ? r : (r?.html ?? '');
    const bad = longDecimals(html);
    expect(bad, `과도한 소수: ${bad.slice(0, 3).join(', ')}`).toEqual([]);
  });
});

describe('GA 도면 — SVG 속성에 부동소수 잔재가 없다', () => {
  /**
   * ⚠ 자리마다 `.toFixed(1)` 을 붙이는 방식은 포기했다 — 방출 지점이 여러 함수에 흩어져
   *   있어 한 번에 못 잡고, **이미 붙은 자리에 덧붙이면 런타임 오류**가 난다(실제로 겪었다).
   *   방출 직후 한 곳에서 정리한다(`tidySvgNumbers`). 이 검사가 그 지점을 지킨다.
   */
  it.each(['gear_train', 'conveyor', 'tower_crane'])('mech/%s', (id) => {
    const html = (ga2dDrawing as unknown as (a: unknown, o: unknown) => string)(
      tpl('mech', id), { title: 't', domain: 'mech' });
    const bad = longDecimals(html);
    expect(bad, `과도한 소수: ${bad.slice(0, 3).join(', ')}`).toEqual([]);
  });

  it('★치수 텍스트는 건드리지 않는다 — 속성만 정리한다', () => {
    // 도면에 기입된 치수 문자가 사라지거나 바뀌면 안 된다.
    const html = (ga2dDrawing as unknown as (a: unknown, o: unknown) => string)(
      tpl('mech', 'gear_train'), { title: 't', domain: 'mech' });
    expect(html).toMatch(/<text[^>]*>[^<]*\d/);   // 숫자가 든 텍스트가 여전히 있다
    expect(html).toMatch(/SCALE 1:/);
  });
});
