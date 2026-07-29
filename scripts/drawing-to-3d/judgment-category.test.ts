/**
 * 판정의 범주와 도달 (260729b).
 *
 * 전수 재실측에서 **서로 반대 방향으로 틀린** 두 결함이 나왔다:
 *  ① `countJudged` 가 **자기정합을 안전 판정으로 셌다** → girder_bridge 는 실판정이 0인데
 *     "바닥판 폭 자기정합" 하나로 evidenceSufficient 가 충족돼 「이상 없음」으로 나갔다.
 *     앞 세션에 넣은 「판정 0개는 통과가 아니다」 안전망이 **범주 오류로 뚫린 자리**다.
 *  ② 렌더러가 `ok` 불리언을 판정으로 그리지 않았다 → 교량의 **실판정 2~4건이 문서에서
 *     합·불 없이** 나갔다(값만 나감).
 * 하나는 과대 계상, 하나는 표시 누락이라 상쇄되지 않고 각각 다른 거짓말을 한다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyVerdict, domainSafetyReportHtml } from './domain-dossier-verify.mjs';

const R = { seismic: { R: 4 }, wind: { V0: 30 }, fck: 24 };
type V = { ok: boolean; failed: string[]; unavailable?: string[] } | null;
const verdict = (dom: string, id: string, p: unknown = R) =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => V)(buildAssemblyTemplate(dom, id, {}), p);
const html = (dom: string, id: string, p: unknown = R) =>
  (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
    buildAssemblyTemplate(dom, id, {}), { title: 't', params: p }) ?? '';
const badges = (h: string) => (h.match(/판정: /g) ?? []).length;

describe('① 자기정합은 안전 판정이 아니다', () => {
  it('girder_bridge — 자기정합만 있으면 「판정 0개」로 드러난다', () => {
    const v = verdict('bridge', 'girder_bridge');
    // 바닥판 폭이 선언값과 맞는 것은 형상 자기모순이 없다는 뜻이지 안전하다는 뜻이 아니다.
    expect((v?.unavailable ?? []).join(' ')).toContain('판정한 항목이 0개');
    expect((v?.unavailable ?? []).join(' ')).toContain('"이상 없음"이 아니라');
  });

  it('이유를 「대상 없음」이 아니라 「입력 대기」로 구별한다', () => {
    // 목재 없는 조경(대상 없음)과 배근 미선언(입력 대기)은 다른 상태다.
    expect((verdict('bridge', 'girder_bridge')?.unavailable ?? []).join(' ')).toContain('입력 대기');
  });

  it('문서에서도 자기정합에 「안전 판정 아님」을 붙인다', () => {
    expect(html('bridge', 'girder_bridge')).toContain('안전 판정 아님');
  });

  it('실판정이 있는 교량은 자기정합이 섞여도 통과로 남는다 — 과탐 금지', () => {
    const v = verdict('bridge', 'truss_bridge');
    expect((v?.unavailable ?? []).join(' ')).not.toContain('판정한 항목이 0개');
  });
});

describe('② `ok` 불리언도 판정으로 그린다', () => {
  it.each([
    ['arch_bridge', 3],
    ['truss_bridge', 3],
    ['suspension_bridge', 4],
    ['cable_stayed_bridge', 2],
  ])('%s 는 배지가 %i건 이상 — 종전엔 전부 1건이었다', (id, min) => {
    expect(badges(html('bridge', id))).toBeGreaterThanOrEqual(min as number);
  });

  it('이름 없는 `ok` 는 판정으로 그리지 않는다 — 루트 결과·게이트가 판정으로 오인된다', () => {
    // girder_bridge 는 이름 있는 검사가 자기정합 1건뿐이라 배지도 1건이어야 한다.
    expect(badges(html('bridge', 'girder_bridge'))).toBe(1);
  });

  it('`INPUT` 은 판정이 아니다 — 괄호형(`INPUT(footing)`)까지 포함', () => {
    // 실측: rc_frame 이 "판정: INPUT(footing)" 으로 찍혀 입력 대기가 판정처럼 보였다.
    const T = ['building', 'bridge', 'landscape', 'interior'] as const;
    const IDS: Record<string, string[]> = {
      building: ['rc_frame', 'commercial_massing', 'steel_canopy'],
      bridge: ['girder_bridge', 'arch_bridge'],
      landscape: ['timber_deck', 'fence_run'],
      interior: ['studio_unit'],
    };
    for (const dom of T) {
      for (const id of IDS[dom]) {
        const t = html(dom, id).replace(/<[^>]+>/g, ' ');
        expect(t, `${dom}/${id}`).not.toMatch(/판정: \s*INPUT/);
      }
    }
  });

  it('입력 대기는 「판정하지 않음」으로 명시된다', () => {
    expect(html('bridge', 'girder_bridge')).toContain('입력 대기 — 판정하지 않음');
    expect(html('building', 'rc_frame')).toContain('입력 대기 — 판정하지 않음');
  });
});

describe('③ 교량 부재 판정 불가를 이름으로 요구한다', () => {
  it('배근이 없으면 As_mm2 를 요구한다 — 단면력 산출 ≠ 안전 판정', () => {
    const h = html('bridge', 'girder_bridge');
    expect(h).toContain('As_mm2');
    expect(h).toContain('단면력 산출');
  });

  it('배근을 주면 실제 판정이 돈다', () => {
    const v = verdict('bridge', 'girder_bridge', { ...R, As_mm2: 8000 });
    expect((v?.unavailable ?? []).length).toBe(0);
    expect(v?.failed.length).toBeGreaterThan(0); // 휨·전단·연성이 실제로 걸린다
    expect(badges(html('bridge', 'girder_bridge', { ...R, As_mm2: 8000 }))).toBeGreaterThanOrEqual(4);
  });
});

describe('④ 마크업이 어디서도 새지 않는다', () => {
  const ALL: Array<[string, string]> = [
    ['building', 'steel_canopy'], ['building', 'commercial_massing'], ['building', 'gable_house'],
    ['building', 'rc_frame'], ['building', 'water_tank'], ['building', 'elevator_shaft'],
    ['bridge', 'girder_bridge'], ['bridge', 'arch_bridge'], ['bridge', 'truss_bridge'],
    ['landscape', 'timber_deck'], ['landscape', 'pergola'],
    ['interior', 'studio_unit'], ['interior', 'apartment_unit'],
  ];
  it.each(ALL)('%s/%s', (dom, id) => {
    // steel_canopy 는 `r.ok===false` 분기가 esc 라 `**풍 상향력이 지배**` 가 샜다 —
    // 강조 처리는 **모든 문자열 출구**를 통과해야 한다.
    expect(html(dom, id).replace(/<[^>]+>/g, ' ')).not.toContain('**');
  });
});
