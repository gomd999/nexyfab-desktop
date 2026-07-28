/**
 * 건축 공간 구획·피난 미검토 고지 (260729).
 *
 * `interiorCheck`(보행거리 BFS·수용인원·피난폭)는 이미 있고 인테리어에서 잘 돈다.
 * 그런데 **건축 어셈블리는 그 입력을 하나도 선언하지 않는다** — 실측: gable_house 벽15·
 * commercial_massing 벽43 모두 개구부·roomBounds·exits 가 전부 없다(벽은 평범한 box).
 * 그 결과 4층 상업건물 도서가 공간 구획·피난을 **한 번도 보지 않고** 나갔고 아무도
 * 그 사실을 말하지 않았다 — 내진·부재 검토와 같은 자리다.
 *
 * ⚠ 벽 외곽에서 실을 도출하지 않는다. 43장 벽이 감싼 영역을 방 하나로 치면 추측이고,
 * 그 위에 보행거리·수용인원을 얹으면 근거 없는 수치가 된다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type V = { label: string; ok: boolean; failed: string[]; unavailable?: string[] } | null;
const verdict = (id: string) =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => V)(buildAssemblyTemplate('building', id, {}), {});
const spaceNote = (id: string) => (verdict(id)?.unavailable ?? []).find((u) => /공간 구획/.test(u));

describe('벽으로 공간을 감싼 건축 어셈블리는 고지된다', () => {
  it.each(['gable_house', 'commercial_massing', 'water_tank', 'elevator_shaft'])('%s', (id) => {
    expect(spaceNote(id)).toBeTruthy();
  });

  it('벽 장수를 실제로 세어 말한다 — 근거 있는 문구', () => {
    expect(spaceNote('commercial_massing')).toContain('벽 43장');
    expect(spaceNote('gable_house')).toContain('벽 15장');
  });

  it('실을 도출하지 않았다는 사실과 이유를 밝힌다', () => {
    const n = spaceNote('commercial_massing')!;
    expect(n).toContain('추측이 되므로 나누지 않았습니다');
    expect(n).toContain('피난을 확인하지 않았습니다');
  });

  it('재실 공간이라고 단정하지 않는다 — 물탱크·승강로도 벽이 있다', () => {
    const n = spaceNote('water_tank')!;
    expect(n).toContain('사람이 사용하는 공간이라면');
    expect(n).toContain('설비 공간이면 해당 없습니다');
  });

  it('무엇을 선언하면 되는지 이름으로 말한다', () => {
    expect(spaceNote('gable_house')).toContain('실 경계·출입구·용도');
  });
});

describe('과잉 경고를 하지 않는다', () => {
  it.each(['rc_frame', 'duct_run', 'steel_canopy', 'industrial_stair'])(
    '%s 는 벽이 없어 침묵한다', (id) => {
      expect(spaceNote(id)).toBeUndefined();
    });

  it('거부 경로에서도 고지가 살아남는다 — 조기 반환이 삼키던 자리', () => {
    // 벽이 있는 건축 어셈블리는 거의 전부 거부 경로(벽식 R 필요 등)로 빠진다.
    // 성공 경로에만 붙이면 정작 필요한 곳에 한 건도 도달하지 않는다.
    const v = verdict('water_tank');
    expect(v?.unavailable?.length).toBe(2); // 벽식 횡력(입력 필요) + 공간 구획
  });
});
