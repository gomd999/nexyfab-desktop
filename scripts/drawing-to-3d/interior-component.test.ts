/**
 * 실내 부분요소 검토 배선 (260729).
 *
 * interior 도메인은 **무조건 interiorCheck(피난·수용인원)** 로 갔다 — building 이 무조건
 * loadPathCheck 로 가던 것과 같은 고정 배선이다. 그래서 붙박이장·카운터바·칸막이벽·
 * 천장그리드가 "roomBounds{W,D} 메타 필요"로 거부됐다. 이들은 **방이 아니라 부분 요소**라
 * roomBounds 가 없는 게 맞다 — 입력 부족이 아니라 피난 검토의 대상이 아니다.
 *
 * 검사는 전부 **선언값만의 산술 자기정합**이다(기어 중심거리와 같은 종류). 지어낼 값이 없다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { interiorComponentCheck } from './interior-component-check.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type Res = { ok: boolean; label: string; checks: Record<string, { pass: boolean | null; detail: string[] }> } | null;
const check = interiorComponentCheck as unknown as (a: unknown) => Res;
const tpl = (id: string) => buildAssemblyTemplate('interior', id, {});

describe('출하 템플릿에 오탐이 없다', () => {
  it.each(['built_in_closet', 'counter_bar', 'partition_wall', 'ceiling_grid'])('%s 전 항목 통과', (id) => {
    const r = check(tpl(id));
    expect(r).not.toBeNull();
    const failed = Object.entries(r!.checks).filter(([, c]) => c.pass === false).map(([k]) => k);
    expect(failed).toEqual([]);
  });
});

describe('자기모순은 잡는다 — 규칙이 공허하지 않다', () => {
  it('칸막이 벽두께 ≠ 스터드폭 + 보드×2', () => {
    expect(check({ partitionMeta: { wallThk: 100, studWidth: 65, boardThk: 12.5, length: 4000 } })
      ?.checks.thickness.pass).toBe(false);
  });
  it('스터드 개수 × 피치가 길이를 넘음', () => {
    expect(check({ partitionMeta: { studs: 20, studPitch: 450, length: 4000 } })
      ?.checks.studSpan.pass).toBe(false);
  });
  it('개구부가 벽 밖으로 나감', () => {
    expect(check({ partitionMeta: { length: 4000, opening: { width: 900, x: 3500 } } })
      ?.checks.opening.pass).toBe(false);
  });
  it('천장 셀 수 ≠ 가로 × 세로', () => {
    expect(check({ ceilingMeta: { cellsX: 6, cellsY: 5, cells: 28 } })?.checks.cellCount.pass).toBe(false);
  });
  it('타일 + 조명 ≠ 셀 수 — 수량표 모순', () => {
    expect(check({ ceilingMeta: { tiles: 20, lights: 4, cells: 30 } })?.checks.tileCount.pass).toBe(false);
  });
  it('행거 베이가 전체 베이를 넘음', () => {
    expect(check({ closetMeta: { bays: 2, hangerBays: 3 } })?.checks.hangerBays.pass).toBe(false);
  });
  it('상판 내밈이 깊이를 넘음 — 지지 없이 뜬 상판', () => {
    expect(check({ counterMeta: { overhang: 900, depth: 700 } })?.checks.overhang.pass).toBe(false);
  });
});

describe('판정하지 않는 것은 판정하지 않는다', () => {
  it('좌석 간격·문 짝수는 산출값만 — 적정 기준이 용도마다 다르다', () => {
    expect(check({ counterMeta: { length: 2400, seatsApprox: 4 } })?.checks.seatPitch.pass).toBeNull();
    expect(check({ closetMeta: { bays: 2, doors: 2 } })?.checks.doors.pass).toBeNull();
  });
  it('해당 메타가 없으면 null — 방 어셈블리에 가구 검사를 들이대지 않는다', () => {
    expect(check(tpl('cafe_room'))).toBeNull();
    expect(check({})).toBeNull();
  });
});

describe('디스패치 — 부분요소가 더 이상 "메타 필요"로 거부되지 않는다', () => {
  const verdict = (id: string) =>
    (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { label: string; ok: boolean; failed?: string[]; unavailable?: string[] } | null)(tpl(id), {});

  it.each(['built_in_closet', 'counter_bar', 'partition_wall', 'ceiling_grid'])(
    '%s 는 자기 검토를 받는다', (id) => {
      const v = verdict(id);
      expect(v?.unavailable ?? []).toHaveLength(0); // 종전엔 "roomBounds 메타 필요"
      expect(v?.label).not.toContain('피난');
      expect(v?.ok).toBe(true);
    });

  it('방 어셈블리는 종전대로 피난 검토 경로로 간다 — 회귀 없음', () => {
    expect(verdict('cafe_room')?.label).toContain('피난');
    expect(verdict('two_room')?.label).toContain('피난');
  });

  it('두 방의 exit_count FAIL 은 사라졌다 — 그건 지어낸 밀도의 인공물이었다', () => {
    // ⚠ 260729 정정: 이 테스트는 원래 two_room 의 FAIL 을 "진짜 피난 실패"로 고정했다.
    // 파고드니 `재실자 = 면적 ÷ 밀도` 이고 밀도 기본값이 **1.4㎡/인(집회좌석)** 이라
    // 72㎡ 주거가 재실자 52명으로 계산돼 "출구 2개소 필요"가 됐던 것이다. 용도는
    // 어디에도 선언돼 있지 않다. 이제 밀도 미선언이면 재실자 기반 판정을 하지 않는다.
    const v = verdict('two_room');
    expect(v?.ok).toBe(true);
    expect(v?.failed ?? []).toHaveLength(0);
    expect(v?.unavailable?.join(' ')).toContain('수용인원·피난폭');
  });

  it('interior 9종 전부 판정 경로에 있다 — 미적용 0', () => {
    const ids = (listAssemblyTemplates as unknown as (d: string) => { id: string }[])('interior').map((t) => t.id);
    expect(ids.every((id) => verdict(id) !== null)).toBe(true);
  });
});
