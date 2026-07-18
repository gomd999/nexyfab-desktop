/** importMerge 게이트 테스트 — 코퍼스 차단·형식 검증(OCCT 미기동 경로만). */
import { describe, it, expect } from 'vitest';
import { resolveImportParts } from './importMerge';

describe('resolveImportParts — 라이선스·형식 게이트', () => {
  it('참고 코퍼스 경로는 삽입 거부(로컬 전용 라이선스)', async () => {
    const r = await resolveImportParts({ parts: [
      { id: 'x', type: 'import', file: 'C:/Users/me/Downloads/참고파일들4/some.step', at: { tx: 0, ty: 0, tz: 0 } },
    ] });
    expect(r.errors[0]).toContain('로컬 전용');
    expect(r.imports).toHaveLength(0);
    expect(r.asm.parts).toHaveLength(0); // 차단 부품은 어셈블리에서 제외
  });
  it('GrabCAD 경로도 차단한다', async () => {
    const r = await resolveImportParts({ parts: [
      { id: 'y', type: 'import', file: '/data/grabcad/model.step' },
    ] });
    expect(r.errors[0]).toContain('로컬 전용');
  });
  it('없는 파일은 정직 오류, 일반 부품은 통과', async () => {
    const r = await resolveImportParts({ parts: [
      { id: 'ok', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } },
      { id: 'z', type: 'import', file: 'C:/no/such/file.step' },
    ] });
    expect(r.errors.join(' ')).toContain('읽기 실패');
    expect(r.asm.parts).toHaveLength(1);
  });
});
