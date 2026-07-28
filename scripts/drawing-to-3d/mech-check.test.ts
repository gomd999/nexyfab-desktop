/**
 * 기계 분야 안전·정합 검토 (260728).
 *
 * 배경: 5개 분야 실측 평가에서 **mech 만 도메인 판정이 하나도 없었다.**
 * `runDomainSafetyCheck` 는 interior/landscape/bridge/building 을, `verificationReportHtml` 은
 * civil 을 맡는데 mech 은 어느 쪽에도 걸리지 않았다 — 260723 A-7 이 civil 에서 잡았던
 * "어느 쪽으로도 도달 못 함"과 구조가 같다. 템플릿 16종으로 가장 많은 분야인데.
 *
 * 이 테스트가 고정하는 것은 **무엇을 판정하고 무엇을 판정하지 않는가**의 경계다.
 */
import { describe, it, expect } from 'vitest';
import { mechCheck as _mc } from './mech-check.mjs';
import { domainSafetyVerdict as _dsv } from './domain-dossier-verify.mjs';
import { buildAssemblyTemplate as _bt } from './domain-assemblies.mjs';

type Check = { pass: boolean | null; detail?: string[] };
type Result = { ok: boolean; label?: string; checks?: Record<string, Check>; needInputs?: Array<{ name: string }> } | null;
const mechCheck = _mc as unknown as (a: unknown) => Result;
const domainSafetyVerdict = _dsv as unknown as (a: unknown, p?: unknown) => { ok: boolean; failed: string[]; unavailable?: string[] } | null;
const tpl = _bt as unknown as (d: string, id: string, p: Record<string, unknown>) => Record<string, unknown>;

describe('mechCheck — 선언값만으로 판정 가능한 것만 판정한다', () => {
  it('기어열: 중심거리가 a = m(z₁+z₂)/2 와 맞으면 통과 (템플릿 자기정합)', () => {
    const r = mechCheck(tpl('mech', 'gear_train', {}));
    expect(r?.ok).toBe(true);
    expect(r?.checks?.centerDistance.pass).toBe(true);
  });

  it('★중심거리가 어긋나면 잡는다 — 그 기어는 물리지 않는다', () => {
    const r = mechCheck({ gearMeta: { module: 3, teeth: [20, 40], centerDistances: [95] } });
    expect(r?.checks?.centerDistance.pass).toBe(false);
    expect(r?.checks?.centerDistance.detail?.join(' ')).toContain('이론 90');
  });

  it('★언더컷은 합·불을 판정하지 않는다 — 압력각이 선언돼 있지 않다', () => {
    // 20° 를 가정해 FAIL 을 내면 그게 날조다. 산출값만 적고 pass=null.
    const r = mechCheck({ gearMeta: { module: 2, teeth: [12, 40], centerDistances: [52] } });
    expect(r?.checks?.undercutInfo.pass).toBeNull();
    expect(r?.checks?.undercutInfo.detail?.join(' ')).toContain('압력각');
  });

  it('열교환기: TEMA 튜브 피치 하한(1.25×외경)', () => {
    expect(mechCheck({ hxMeta: { tubePitch: 25, tubeOD: 19 } })?.checks?.tubePitch.pass).toBe(true);
    expect(mechCheck({ hxMeta: { tubePitch: 22, tubeOD: 19 } })?.checks?.tubePitch.pass).toBe(false);
  });

  it('로봇 암: 도달거리는 링크 길이 합을 넘을 수 없다 (각도 규약과 무관한 상한)', () => {
    expect(mechCheck({ robotMeta: { upperArmLen: 700, forearmLen: 600, reach: 1154 } })?.checks?.reachBound.pass).toBe(true);
    expect(mechCheck({ robotMeta: { upperArmLen: 700, forearmLen: 600, reach: 1400 } })?.checks?.reachBound.pass).toBe(false);
  });

  it('★지배 입력이 없으면 통과로 둔갑시키지 않고 무엇이 필요한지 말한다', () => {
    for (const [meta, need] of [['vesselMeta', '설계압력'], ['tankMeta', '내용물 밀도'], ['craneMeta', '카운터웨이트']] as const) {
      const r = mechCheck({ [meta]: { diameter: 1000 } });
      expect(r?.ok, meta).toBe(false);
      expect(JSON.stringify(r?.needInputs), meta).toContain(need);
    }
  });

  it('적용 가능한 검사가 없으면 null — "검증 없음"과 "통과"는 다르다', () => {
    expect(mechCheck(tpl('mech', 'pump_unit', {}))).toBeNull();
    expect(mechCheck({})).toBeNull();
  });
});

describe('domainSafetyVerdict — mech 배선 + "확인 못 함"과 "기준 미달"의 분리', () => {
  it('mech 기어열이 이제 도메인 판정에 잡힌다 (종전엔 null 이었다)', () => {
    const v = domainSafetyVerdict(tpl('mech', 'gear_train', {}), {});
    expect(v).not.toBeNull();
    expect(v?.ok).toBe(true);
  });

  it('★입력 부족은 `unavailable` 로 나가고 `failed` 를 오염시키지 않는다', () => {
    const v = domainSafetyVerdict(tpl('mech', 'pressure_vessel', {}), {});
    expect(v?.failed).toEqual([]);           // "기준 미달"이 아니다
    expect(v?.ok).toBe(true);                // 안전 경고를 날조하지 않는다
    expect(v?.unavailable?.join(' ')).toContain('설계압력'); // 그러나 숨기지도 않는다
  });

  it('적용 검토가 없는 mech 어셈블리는 종전대로 null', () => {
    expect(domainSafetyVerdict(tpl('mech', 'pump_unit', {}), {})).toBeNull();
  });
});
