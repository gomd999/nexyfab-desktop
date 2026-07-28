/**
 * 재실밀도 기본값이 판정을 지어내던 것 (260729).
 *
 * 전수 감사에서 interior 2종(two_room·three_room_unit)이 `exit_count` FAIL 이었다.
 * 파고드니 규칙은 `occupants > 50 → 출구 2개소`이고 `occupants = 면적 ÷ 밀도` 인데,
 * **밀도 기본값이 1.4 ㎡/인 — 집회좌석 밀도**였다. 중립값이 아니다.
 *
 * 결과: 72㎡ 주거 2실이 **재실자 52명**으로 계산돼 FAIL. 실제 주거 밀도면 4명 남짓이다.
 * 대칭으로, 통과한 것들(cafe_room·apartment_unit)도 **근거 없는 통과**였다 —
 * 지어낸 밀도가 우연히 50 아래로 떨어졌을 뿐이다.
 *
 * 용도는 어느 인테리어 템플릿에도 선언돼 있지 않다(kind:'assembly' 는 어셈블리 종류
 * 표시일 뿐 용도가 아니다 — 붙박이장·천장그리드에도 붙어 있다).
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { interiorCheck } from './interior-check.mjs';

type R = {
  ok: boolean;
  egress: { verdict: string; checks: Record<string, { pass: boolean }> } | null;
  egressUnavailable?: { needInputs: { name: string }[]; messageKo: string; derived: Record<string, number> };
};
const chk = (id: string, p?: unknown) =>
  (interiorCheck as unknown as (a: unknown, p: unknown) => R)(buildAssemblyTemplate('interior', id, {}), p ?? {}) ;

describe('밀도가 선언되지 않으면 재실자 기반 판정을 하지 않는다', () => {
  it.each(['two_room', 'three_room_unit', 'cafe_room', 'apartment_unit'])('%s — egress 를 산정하지 않는다', (id) => {
    const r = chk(id);
    expect(r.egress).toBeNull();
    expect(r.egressUnavailable).toBeTruthy();
  });

  it('형상에서 나오는 사실은 그대로 보고한다 — 면적·좌석·출구·문 폭', () => {
    const u = chk('two_room').egressUnavailable!;
    expect(u.derived.floorAreaM2).toBe(72);
    expect(u.derived.exitCount).toBe(1);
    expect(u.derived.doorWidthSumMm).toBe(1000);
    // 좌석은 재실자의 **하한**이지 재실자 수가 아니다.
    expect(u.derived).toHaveProperty('seatCountLowerBound');
  });

  it('용도가 정하는 값임을 밝히고 그것만 요구한다', () => {
    const u = chk('two_room').egressUnavailable!;
    expect(u.needInputs.map((x) => x.name)).toEqual(['occupantDensityM2']);
    expect(u.messageKo).toContain('용도가 정하는 값');
    expect(u.messageKo).toContain('"피난이 충분하다"는 뜻이 아닙니다');
  });
});

describe('밀도를 주면 종전대로 판정한다 — 규칙이 공허하지 않다', () => {
  it('집회좌석(1.4)을 명시하면 72㎡ 는 재실자 52명 → 출구 2개소 요구로 FAIL', () => {
    const r = chk('two_room', { occupantDensityM2: 1.4 });
    expect(r.egress?.verdict).toBe('FAIL');
    expect(r.egress?.checks.exit_count.pass).toBe(false);
    expect(r.egressUnavailable).toBeUndefined();
  });

  it('주거 밀도(19)를 명시하면 같은 실이 통과한다 — 밀도가 판정을 가른다', () => {
    const r = chk('two_room', { occupantDensityM2: 19 });
    expect(r.egress?.verdict).toBe('PASS');
    expect(r.egress?.checks.exit_count.pass).toBe(true);
  });

  it('카페도 밀도를 주면 판정된다 — 좌석이 있어도 밀도는 별개다', () => {
    expect(chk('cafe_room', { occupantDensityM2: 1.4 }).egress?.verdict).toBe('PASS');
  });
});
