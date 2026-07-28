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
    '%s(벽식 구조)는 라멘이 아니라 **벽식 검토**로 간다', (id) => {
      // ⚠ 260729 계약 변경: 이 테스트는 원래 `toBeNull()`(침묵)을 기대했다. 그때는
      // 벽식에 적용할 검토가 없었으므로 침묵이 최선이었다. 이후 shear_wall 계산기가
      // **구현돼 있으면서 한 번도 불리지 않았다**는 것을 발견해 배선했고, 이제 벽식은
      // 침묵이 아니라 자기 구조에 맞는 검토를 받는다 — "해당 없음"보다 나은 결과다.
      const v = verdict(id);
      expect(v).not.toBeNull();
      expect(v?.label).toContain('벽식 횡력 검토');
    });

  it('벽식 판정은 사유를 남긴다 — 침묵의 근거가 검사 결과에 있다', () => {
    const r = (loadPathCheck as unknown as (a: unknown, p: unknown) => { notApplicable?: boolean; error: string })(
      buildAssemblyTemplate('building', 'water_tank', {}), {});
    expect(r.notApplicable).toBe(true);
    expect(r.error).toContain('벽식 구조');
    expect(r.error).toContain('라멘 골조');
  });

  it('기둥이 있으면 벽식으로 넘겨 침묵시키지 않는다 — 사유를 남긴다', () => {
    // ⚠ 260729 갱신: 이 테스트는 원래 steel_canopy 를 "지붕 태깅이 빠진 것"으로 보고
    // 'role 태깅 필요'를 기대했다. 그러나 형상을 확인하니 column14→beam3→rafter14→
    // purlin6 의 **완결된 하중경로**이고 캐노피에 슬래브가 없는 것은 정상이다 —
    // 태깅 갭이 아니라 이 검사기(슬래브→보→기둥)의 적용범위 밖이었다.
    // 테스트의 원래 의도(기둥이 있으면 침묵시키지 않는다)는 그대로 유지한다.
    const v = verdict('steel_canopy');
    expect(v).not.toBeNull();
    expect(v?.unavailable?.join(' ')).toContain('지붕 골조형');
  });

  it('벽이 많아도 기둥이 있으면 침묵시키지 않는다 — 판정 불가로 남긴다', () => {
    // ⚠ 260729 갱신: 종전 이 테스트는 "슬래브 수 ≠ 층수"를 기대했는데 **그 신호 자체가
    // 오탐이었다**(기초 슬래브가 있는 건물은 항상 걸렸다 — 아래 describe 참조). 고친 뒤
    // commercial_massing 은 다음 관문에서 걸린다: 기둥 24본이 전부 1열(6×1) + 벽 43장이라
    // 직교 격자 라멘이 아니다. 테스트의 원래 의도(침묵시키지 않는다)는 그대로 유지한다.
    const v = verdict('commercial_massing');
    expect(v).not.toBeNull();
    expect(v?.unavailable?.join(' ')).toContain('직교 격자 라멘');
  });
});

describe('기둥 단 ↔ 슬래브 대응 (260729) — 개수 일치 가정이 틀렸던 것', () => {
  // 종전: `slabs.length !== nf` → "슬래브 수 ≠ 층수, 층당 1장 필요".
  // 실측(commercial_massing, floors=4): 기둥 단 z=[250,4450,8050,11650],
  // 슬래브 z=[0,4200,7800,11400,15000]. 기초 슬래브가 있는 4층 건물의 정상 구성인데
  // 5≠4 로 거부됐다 — 지붕/기초 슬래브를 가진 건물은 **항상** 걸리는 규칙이었다.
  const lp = loadPathCheck as unknown as (a: unknown, p: unknown) => { ok: boolean; error?: string };
  const tpl = (id: string) => buildAssemblyTemplate('building', id, {}) as unknown as { parts: { role?: string; at?: { tz?: number } }[] };

  it('기초 슬래브가 여분이어도 통과한다 — 슬래브 5 · 기둥 단 4', () => {
    const r = lp(tpl('commercial_massing'), {});
    expect(r.error ?? '').not.toContain('슬래브 수');
  });

  it('슬래브가 모자라면 그대로 걸린다 — 규칙을 느슨하게 만든 것이 아니다', () => {
    const a = tpl('commercial_massing');
    const cut = { ...a, parts: a.parts.filter((p) => p.role !== 'slab' || (p.at?.tz ?? 0) < 8000) };
    const r = lp(cut, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('위쪽 슬래브를 못 받는다');
  });

  it('단층 라멘은 종전대로 통과 — 회귀 없음', () => {
    expect(lp(tpl('rc_frame'), {}).ok).not.toBe(false);
  });

  it('1열 기둥 거부는 적용범위 한계임을 밝힌다 — 설계 결함으로 읽히면 안 된다', () => {
    // commercial_massing 은 기둥 24본이 전부 1열(6×1×4층) + 벽 43장.
    const r = lp(tpl('commercial_massing'), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('설계 결함이라는 뜻이 아니며');
  });
});
