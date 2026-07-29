/**
 * 「검토 불가」와 「그와 별개로 판정한 것」은 함께 있어야 한다 (260729c).
 *
 * 실측: `tower_crane` 은 정적 전도를 실제로 산출(적합)하는데, 지배 입력(카운터웨이트)이
 * 없어 `ok:false` 라는 이유로 안전검토.html 에 **"검토 불가" 한 줄만** 나갔다.
 * 기계 6종이 전부 그랬고 **그들에게는 전도가 유일한 판정**이었다 —
 * 배선해 놓고 정작 필요한 곳에서 사라진 것이다.
 *
 * 이 세션에서 「조기 반환이 고지를 삼킨다」를 네 번 잡았고, 여기가 마지막 진입점이다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyReportHtml, domainSafetyVerdict } from './domain-dossier-verify.mjs';

const html = (dom: string, id: string, p: unknown = {}) =>
  (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
    buildAssemblyTemplate(dom, id, {}), { title: 't', params: p }) ?? '';
type V = { ok: boolean; failed: string[]; unavailable?: string[]; judgedDespiteRefusal?: number; judgedNote?: string } | null;
const verdict = (dom: string, id: string, p: unknown = {}) =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => V)(buildAssemblyTemplate(dom, id, {}), p);

describe('거부해도 산출된 검토는 문서에 남는다', () => {
  it.each(['tower_crane', 'tank_silo', 'pressure_vessel', 'mold_cavity', 'transmission_tower', 'excavator_bucket'])(
    '%s — 전도가 문서에 나온다(종전엔 "검토 불가" 한 줄뿐이었다)', (id) => {
      const h = html('mech', id);
      expect(h).toContain('정적 전도');
      expect((h.match(/판정: /g) ?? []).length).toBeGreaterThan(0);
    });

  it('「입력 대기」와 「검토 불가」를 구별한다 — 원인 모르는 실패가 아니다', () => {
    const h = html('mech', 'tower_crane');
    expect(h).toContain('입력 대기 — 판정하지 않음');
    expect(h).not.toContain('알 수 없는 사유');
    expect(h).toContain('카운터웨이트');           // 필요 입력을 이름으로
  });

  it('요약에도 「별개로 판정했다」가 전달된다', () => {
    const v = verdict('mech', 'tower_crane');
    expect(v?.judgedDespiteRefusal).toBeGreaterThan(0);
    expect(v?.judgedNote).toContain('별개로');
    expect((v?.unavailable ?? []).join(' ')).toContain('카운터웨이트');   // 거부 사유도 남는다
  });

  it('판정이 하나도 없는 거부에는 붙이지 않는다 — 과고지 금지', () => {
    // ⚠ commercial_massing 은 이제 관통 검사가 붙어 거부 상태에서도 1건을 판정한다 —
    //   과고지가 아니라 정확하다. 설비가 없어 관통도 없는 gable_house 로 확인한다.
    const v = verdict('building', 'gable_house');          // 입력 없음 → 횡력 거부, 설비 없음
    expect(v?.judgedDespiteRefusal).toBeUndefined();
  });

  it('거부 상태에서도 형상만으로 되는 판정은 남는다 — commercial_massing 관통', () => {
    const v = verdict('building', 'commercial_massing');
    expect(v?.judgedDespiteRefusal).toBe(1);
    expect(v?.judgedNote).toContain('형상');
  });

  it('마크업이 새지 않는다', () => {
    for (const id of ['tower_crane', 'tank_silo', 'excavator_bucket']) {
      expect(html('mech', id).replace(/<[^>]+>/g, ' '), id).not.toContain('**');
    }
  });
});

describe('조경 — 목재가 없어도 제원으로 판정한다 (260729c)', () => {
  it.each([
    ['parking_pavement', '포장 층 두께 합'],
    ['tree_planting', '식재 간격'],
    ['planter_wall', '저판 폭'],
  ])('%s — %s', (id, label) => {
    const h = html('landscape', id);
    expect(h).toContain(label);
    expect((h.match(/판정: /g) ?? []).length).toBeGreaterThan(0);
  });

  it('목재도 제원도 없는 것은 종전대로 판정 0 — 지어내지 않는다', () => {
    // 260730: fence_run·pavilion 은 제원 자기정합이 붙어 판정한다.
    // 메타가 아예 없는 apartment_complex 만 남았다.
    const v = verdict('landscape', 'apartment_complex');
    expect((v?.unavailable ?? []).join(' ')).toContain('판정한 항목이 0개');
  });
});

describe('관통 검사가 출하 템플릿에서 실제로 돈다 (260729c)', () => {
  it('commercial_massing 계단실·PS 개구를 관통이 통과한다', () => {
    const h = html('building', 'commercial_massing', { seismic: { R: 4 } });
    expect(h).toContain('설비 관통');
    expect(h).toContain('관통 3개소');
    expect(h).toContain('개구가 확인된 관통 3개소');
  });

  it('cafe_room 배수·통기가 실제로 검토된다 — 종전엔 「대상 없음」이었다', () => {
    const a = buildAssemblyTemplate('interior', 'cafe_room', {}) as { pipes?: unknown[]; parts: { role?: string }[] };
    expect((a.pipes ?? []).length).toBeGreaterThan(0);
    // ⚠ role 은 `toilet`·`basin`·`sink` 여야 한다 — `interior-check.ROLE_FX` 가 그 이름으로
    //   KDS 표 4.1-2 기구를 찾는다. `fixture` 로 뭉쳤더니 **DFU 판정이 통째로 생략**됐고,
    //   검사가 "기구 role 매핑 없음 — DFU 판정 생략(정직)" 으로 밝혀서 드러났다.
    expect(a.parts.filter((p) => ['toilet', 'basin', 'sink'].includes(p.role ?? '')).length).toBe(3);
  });

  it('★DFU 판정이 실제로 돌고 통기관이 기준을 만족한다', () => {
    // 통기관을 DN50 으로 뒀다가 **기준 미달로 걸렸다**(§4.3(1): 배수관 DN100 의 1/2 초과
    // → DN65). 검사가 잡아 DN75 로 고쳤다 — 검사가 자기 템플릿의 오류를 잡은 사례다.
    const h = html('interior', 'cafe_room', { usage: 'office' });
    expect(h).toContain('sumDFU');
    expect(h).not.toContain('role 매핑 없음');
    const v = verdict('interior', 'cafe_room', { usage: 'office' });
    expect(v?.failed).toEqual([]);
  });
});
