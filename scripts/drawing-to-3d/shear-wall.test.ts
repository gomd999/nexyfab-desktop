/**
 * 벽식 횡력 검토 배선 (260729).
 *
 * `shear_wall` 계산기(전단벽 강성·분담, KDS 14 20 22 §4.9 원문식까지 구현)는
 * **어디서도 호출되지 않았다.** 그 사이 벽식 3종(물탱크·승강로·박공집)은 라멘 전용
 * loadPathCheck 로 넘어가 "해당 없음"으로 침묵했다 — stairCheck 와 똑같은 자리.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { shearWallCheck } from './shear-wall-check.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type SW = {
  ok: boolean; label: string; messageKo?: string; needInputs?: { name: string }[];
  checks?: Record<string, { pass: boolean | null; detail: string[] }>;
  basis?: { lateralWalls: number; dirX: number; dirY: number; storyShear_kN: number; governing: string; hn_m: number };
} | null;
const sw = shearWallCheck as unknown as (a: unknown, p?: unknown) => SW;
const tpl = (id: string) => buildAssemblyTemplate('building', id, {});

describe('형상에서 파생되는 것과 요구하는 것', () => {
  it('벽·방향·중량·높이는 형상에서 찾는다 — 입력이 없어도 거기까지는 말한다', () => {
    const r = sw(tpl('water_tank'), {});
    expect(r?.ok).toBe(false);
    expect(r?.messageKo).toContain('전단벽 4장(X 2·Y 2)');
    expect(r?.messageKo).toContain('전체높이');
  });

  it('형상에서 알 수 없는 것만 요구한다 — R 또는 V0', () => {
    const names = sw(tpl('water_tank'), {})?.needInputs?.map((x) => x.name);
    expect(names).toEqual(['seismic.R', 'wind.V0']);
  });

  it('"횡력에 안전하다는 뜻이 아니다"를 명시한다', () => {
    expect(sw(tpl('water_tank'), {})?.messageKo).toContain('"횡력에 안전하다"는 뜻이 아닙니다');
  });

  it('벽이 없으면 null — 라멘에 벽식 검토를 들이대지 않는다', () => {
    expect(sw(tpl('rc_frame'), { seismic: { R: 4 } })).toBeNull();
  });
});

describe('R 을 주면 판정한다', () => {
  it('방향별로 나눠 본다 — 전단벽은 강축으로만 저항한다', () => {
    const r = sw(tpl('water_tank'), { seismic: { R: 4 } });
    expect(r?.ok).toBe(true);
    expect(r?.checks?.dirX.pass).toBe(true);
    expect(r?.checks?.dirY.pass).toBe(true);
    expect(r?.basis?.dirX).toBe(2);
    expect(r?.basis?.dirY).toBe(2);
  });

  it('층전단력과 그 출처를 밝힌다', () => {
    const b = sw(tpl('water_tank'), { seismic: { R: 4 } })?.basis;
    expect(b?.storyShear_kN).toBeGreaterThan(0);
    expect(b?.governing).toContain('지진');
  });

  it('전 높이를 관통하지 않는 벽은 세지 않고 그 사실을 적는다', () => {
    // 박공집: 최대 2700mm 벽 6장이 횡력저항, 나머지 9장은 박공 조각·개구부 상부.
    const r = sw(tpl('gable_house'), { seismic: { R: 4 } });
    expect(r?.basis?.lateralWalls).toBe(6);
    expect(r?.checks?.partialWalls.pass).toBeNull();
    expect(r?.checks?.partialWalls.detail.join(' ')).toContain('판정하지 않는다');
  });

  it('승강로 코어벽을 찾아낸다 — 전 높이 관통 3장', () => {
    const r = sw(tpl('elevator_shaft'), { seismic: { R: 4 } });
    expect(r?.basis?.lateralWalls).toBe(3);
    expect(r?.basis?.hn_m).toBeGreaterThan(17);
  });
});

describe('디스패치', () => {
  const verdict = (id: string, p: unknown) =>
    (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { label: string; ok: boolean; unavailable?: string[] } | null)(tpl(id), p);

  it.each(['water_tank', 'elevator_shaft', 'gable_house'])(
    '%s 는 더 이상 침묵하지 않는다 — 벽식 검토로 간다', (id) => {
      const v = verdict(id, {});
      expect(v).not.toBeNull();
      expect(v?.label).toContain('벽식 횡력 검토');
      expect(v?.unavailable?.join(' ')).toContain('반응수정계수 R');
    });

  it('R 을 주면 실제 판정이 나온다', () => {
    const v = verdict('water_tank', { seismic: { R: 4 } });
    expect(v?.ok).toBe(true);
    // ⚠ 260729: 종전엔 unavailable 0 을 기대했다. 이후 **공간 구획·피난 미검토** 고지가
    // 추가돼(벽이 있는 건축 어셈블리 공통) 1건이 남는다 — 벽식 횡력이 판정됐다는 사실과
    // 별개의 항목이라 남는 것이 맞다. 이 테스트의 의도는 "횡력 거부가 사라진다"이다.
    expect((v?.unavailable ?? []).some((u) => /반응수정계수 R/.test(u))).toBe(false);
    expect((v?.unavailable ?? []).every((u) => /공간 구획/.test(u))).toBe(true);
  });

  it('라멘은 종전대로 하중경로 검토 — 회귀 없음', () => {
    expect(verdict('rc_frame', {})?.label).toContain('하중경로');
  });
});
