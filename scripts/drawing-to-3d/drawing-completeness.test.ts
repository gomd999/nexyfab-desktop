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
    expect(r.failed.join(' ')).toContain('C2');
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
    expect(a.na).toEqual(['C9 (DXF 파일 별도 검사(HTML 범위 외))']);
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
