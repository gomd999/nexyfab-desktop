/** D1 완성도 게이트 테스트. */
import { describe, it, expect } from 'vitest';
import { checkDrawingCompleteness, completenessApplicability } from './drawing-completeness.mjs';

describe('checkDrawingCompleteness', () => {
  it('전 마커 존재 시 8/8 통과', () => {
    const html = 'nf-titleblock data-dwg 시트 nfhatch SECTION A-A DETAIL B ⌀ 8 2 2 2 stroke-dasharray="5 3" <circle 발주 규격 SCH40 필릿 △';
    const r = checkDrawingCompleteness(html);
    expect(r.ok).toBe(true);
    expect(r.score).toBe('8/8');
  });
  it('누락 항목을 정직 보고한다', () => {
    const r = checkDrawingCompleteness('nf-titleblock data-dwg 시트');
    expect(r.ok).toBe(false);
    // ⚠ 260728: 종전엔 C2(단면도)를 기대했으나 **선택 뷰는 판정 불가로 바꿨다.**
    // 근거: 6개 도메인 실측에서 5개가 C3 로 실패했고, 열어보니 GA 생성기는 작은/얇은
    // 부품이 있을 때만 상세도를 그린다 — 큰 부재만 있는 도면은 없는 게 맞다. 즉 그 FAIL 은
    // 과탐이었고, §7-4 로 소비자 문서에 실리면서 거의 모든 패키지에 경고가 떴다.
    // 필수 항목(치수 체계·선 종류·BOM 규격열 등)의 미충족은 그대로 FAIL 로 잡힌다.
    expect(r.failed.join(' ')).toContain('C4');
    expect(r.na.join(' ')).toContain('C2');
  });
});

/**
 * 적용 가능성(N/A) — 260728 §7-3.
 * 종전엔 "필요 없는 항목이 없는 것"과 "필요한데 빠진 것"이 같은 FAIL 로 보였다.
 * 실측: 단순 브래킷 GA 가 7/8 이었고 유일한 실패가 C5(중심선) — 구멍도 원형 부재도 없어
 * 중심선이 없는 게 맞는 부품이었다. 이 과탐이 §7-4(소비자 도달)의 실제 착수 장애였다.
 */
describe('completenessApplicability + N/A 처리', () => {
  const gaLike = '<div class="nf-titleblock" data-dwg="A" >시트 1</div>';

  it('applicability 미전달 = 종전 동작(전부 적용) — 하위호환', () => {
    const a = checkDrawingCompleteness(gaLike);
    const b = checkDrawingCompleteness(gaLike, {});
    expect(a).toEqual(b);
    // C9 는 항상 N/A(HTML 범위 외). C2·C3 은 없으면 판정 불가(위 describe 참조).
    expect(a.na.map((n: string) => n.slice(0, 2)).sort()).toEqual(['C2', 'C3', 'C9']);
  });

  it('원형 부재가 없으면 C5·C6 이 FAIL 이 아니라 N/A 가 된다', () => {
    const r = checkDrawingCompleteness(gaLike, { applicability: { hasCircular: false, hasWelds: true } });
    expect(r.failed.some((f: string) => f.startsWith('C5'))).toBe(false);
    expect(r.failed.some((f: string) => f.startsWith('C6'))).toBe(false);
    expect(r.na.some((n: string) => n.startsWith('C5'))).toBe(true);
    expect(r.na.some((n: string) => n.startsWith('C6'))).toBe(true);
  });

  it('용접이 없으면 C8 이 N/A — 있으면 그대로 판정한다', () => {
    const none = checkDrawingCompleteness(gaLike, { applicability: { hasCircular: true, hasWelds: false } });
    expect(none.na.some((n: string) => n.startsWith('C8'))).toBe(true);
    const some = checkDrawingCompleteness(gaLike, { applicability: { hasCircular: true, hasWelds: true } });
    expect(some.failed.some((f: string) => f.startsWith('C8'))).toBe(true);
  });

  it('★모르면 "적용됨"으로 둔다 — N/A 를 과하게 주면 검사가 조용히 사라진다', () => {
    // built 를 안 주면 용접 여부를 모른다 → 적용됨(true)
    expect(completenessApplicability({ parts: [{ type: 'box' }] }).hasWelds).toBe(true);
    // 구멍 선언은 type 과 무관하게 원형이다
    expect(completenessApplicability({ parts: [{ type: 'box', params: { holes: [{ x: 1, y: 1, d: 5 }] } }] }).hasCircular).toBe(true);
    // 지름류 파라미터도 원형으로 본다
    expect(completenessApplicability({ parts: [{ type: 'box', params: { diameter: 20 } }] }).hasCircular).toBe(true);
    // 순수 각재만 있으면 원형 없음
    expect(completenessApplicability({ parts: [{ type: 'box', params: { width: 10 } }] }, { welds: [] })).toEqual({ hasCircular: false, hasWelds: false });
  });
});

/**
 * 선택 뷰(C2 단면도·C3 부분 상세) — PASS 보존, FAIL 만 판정 불가 (260728 자율 점검).
 *
 * 실측: 6개 도메인 중 **5개**가 C3 로 실패했다(mech 만 통과). GA 생성기는 작은/얇은 부품이
 * 있을 때만 DETAIL 을 그리므로, RC 프레임처럼 큰 부재만 있으면 **상세도가 필요 없는 게 맞다.**
 * §7-4 로 완성도를 소비자 문서에 실으면서 거의 모든 패키지에 "갖춰지지 않은 항목"이 떴다.
 */
describe('선택 뷰 C2·C3 — 있으면 PASS, 없으면 판정 불가', () => {
  const base = '<div class="nf-titleblock" data-dwg="A">시트 1</div>';

  it('그려져 있으면 PASS 로 남는다 — 확인된 정보를 버리지 않는다', () => {
    const html = `${base}<div class="nfhatch"></div>SECTION A-A DETAIL B`;
    const r = checkDrawingCompleteness(html);
    const by = (id: string) => r.passed.includes(id);
    expect(by('C2')).toBe(true);
    expect(by('C3')).toBe(true);
  });

  it('★없으면 FAIL 이 아니라 N/A — "필요한데 빠짐"과 "필요 없어 안 그림"을 구별 못 한다', () => {
    const r = checkDrawingCompleteness(base);
    expect(r.failed.some((f: string) => f.startsWith('C2'))).toBe(false);
    expect(r.failed.some((f: string) => f.startsWith('C3'))).toBe(false);
    expect(r.na.some((n: string) => n.startsWith('C2'))).toBe(true);
    expect(r.na.some((n: string) => n.startsWith('C3'))).toBe(true);
    // 사유가 붙는다 — 왜 판정 못 했는지
    expect(r.na.join(' ')).toContain('생성기는 필요할 때만 그린다');
  });

  it('다른 항목의 진짜 미충족은 그대로 FAIL 이다 (과소 보고 아님)', () => {
    // 표제란이 없으면 C1 은 여전히 실패해야 한다
    const r = checkDrawingCompleteness('<div>빈 도면</div>');
    expect(r.failed.some((f: string) => f.startsWith('C1'))).toBe(true);
  });
});
