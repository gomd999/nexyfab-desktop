/** D1 완성도 게이트 테스트. */
import { describe, it, expect } from 'vitest';
import { checkDrawingCompleteness } from './drawing-completeness.mjs';

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
