/**
 * building 도메인 안전검토 디스패치 (260729).
 *
 * 5개 분야 전수 평가에서 건축이 가장 약했다 — 8종 중 **7종이 판정 불가**. 열어보니
 * 두 가지 별개 문제였다:
 *
 *  ① building 만 **도메인 단위 고정 배선**이었다. bridge·mech 는 선언 메타로
 *     디스패치하는데 building 은 무조건 loadPathCheck 로 갔다. 그래서 계단이 라멘
 *     골조 검토로 넘어가 "role 태깅 필요"로 거부됐고, 정작 `stairCheck`(트레드 휨·
 *     스트링거 휨)는 **존재하면서 한 번도 불리지 않았다.**
 *
 *  ② "해당 없음"이 "판정 불가"로 표기됐다. 물탱크·승강로·박공집은 기둥 0 · 벽 다수인
 *     **벽식 구조**라 라멘 하중경로가 애초에 없는데, "입력을 더 주면 판정된다"로 읽혔다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';
import { loadPathCheck } from './load-path.mjs';

type Verdict = { label: string; ok: boolean; failed: string[]; unavailable?: string[] } | null;
const verdict = (id: string) =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => Verdict)(
    (buildAssemblyTemplate as unknown as (d: string, i: string, p: unknown) => unknown)('building', id, {}), {});

describe('선언 메타로 디스패치한다', () => {
  it('계단은 stairCheck 로 간다 — 있으면서 놀던 검사', () => {
    const v = verdict('industrial_stair');
    expect(v?.label).toContain('계단 검토');
    expect(v?.ok).toBe(true);
    expect(v?.unavailable ?? []).toHaveLength(0); // 종전엔 "role 태깅 필요"로 거부됐다
  });

  it('라멘 골조는 종전대로 하중경로 검토 — 회귀 없음', () => {
    const v = verdict('rc_frame');
    expect(v?.label).toContain('하중경로');
    expect(v?.ok).toBe(true);
  });
});

describe('해당 없음과 판정 불가를 구별한다', () => {
  it.each(['water_tank', 'elevator_shaft', 'gable_house'])(
    '%s(벽식 구조)는 해당 없음 — null 로 침묵한다', (id) => {
      // 기둥 0 · 벽 다수 = 벽식. 라멘 하중경로가 없는 것이지 입력이 모자란 게 아니다.
      expect(verdict(id)).toBeNull();
    });

  it('벽식 판정은 사유를 남긴다 — 침묵의 근거가 검사 결과에 있다', () => {
    const r = (loadPathCheck as unknown as (a: unknown, p: unknown) => { notApplicable?: boolean; error: string })(
      buildAssemblyTemplate('building', 'water_tank', {}), {});
    expect(r.notApplicable).toBe(true);
    expect(r.error).toContain('벽식 구조');
    expect(r.error).toContain('라멘 골조');
  });

  it('기둥이 있으면 벽식으로 넘기지 않는다 — 진짜 태깅 누락은 그대로 판정 불가', () => {
    // steel_canopy: 기둥14·보3·슬래브0 — 지붕 태깅이 빠진 것일 수 있으므로 침묵시키면 안 된다.
    const v = verdict('steel_canopy');
    expect(v?.unavailable?.join(' ')).toContain('role 태깅 필요');
  });

  it('자기모순 신호는 침묵시키지 않는다 — 슬래브 수 ≠ 층수', () => {
    const v = verdict('commercial_massing');
    expect(v?.unavailable?.join(' ')).toContain('슬래브 수');
  });
});
