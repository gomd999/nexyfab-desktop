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
    // ⚠ 260729 계약 변경: 예시를 pump_unit → flanged_fitting 으로 바꿨다. 펌프는
    // 볼류트·노즐 기하가 선언돼 있어 이제 **판정 대상**이다(하드 기하 순서). 메타가
    // 아예 없는 flanged_fitting 이 "적용 검사 없음"의 올바른 예다.
    expect(mechCheck(tpl('mech', 'flanged_fitting', {}))).toBeNull();
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
    // 260729: pump_unit 은 이제 판정 대상 — 메타 없는 flanged_fitting 으로 교체.
    expect(domainSafetyVerdict(tpl('mech', 'flanged_fitting', {}), {})).toBeNull();
  });
});

describe('mech 판정 확장 (260729) — 선언값만으로 결정되는 것만', () => {
  // 전수 실측에서 mech 16종 중 10종이 미적용이었다. 그중 값을 지어내지 않고
  // 판정 가능한 것을 채웠다: 판정 3→9 · 정직거부 3→6 · 미적용 10→1.
  const check = mechCheck as unknown as (a: unknown) => {
    ok: boolean; label: string; checks?: Record<string, { pass: boolean | null; detail: string[] }>;
    needInputs?: { name: string }[];
  } | null;

  describe('4절 링크', () => {
    it('최장 링크가 나머지 3개 합을 넘으면 루프가 닫히지 않는다 — 하드 불가능성', () => {
      const r = check({ fourBarMeta: { ground: 1000, crank: 100, coupler: 100, rocker: 100 } });
      expect(r?.checks?.closable.pass).toBe(false);
      expect(r?.checks?.closable.detail.join(' ')).toContain('1000');
    });

    it('선언 Grashof 와 계산이 어긋나면 걸린다 — 기어 중심거리와 같은 자기정합', () => {
      // s+l = 120+400 = 520 ≤ p+q = 350+250 = 600 → Grashof 는 true 인데 false 로 선언.
      const r = check({ fourBarMeta: { ground: 400, crank: 120, coupler: 350, rocker: 250, grashof: false } });
      expect(r?.checks?.grashofConsistency.pass).toBe(false);
    });

    it('전달각은 합·불을 내지 않는다 — 허용 하한이 용도마다 다르다', () => {
      const r = check({ fourBarMeta: { ground: 400, crank: 120, coupler: 350, rocker: 250, transmissionDeg: 12 } });
      expect(r?.checks?.transmissionInfo.pass).toBeNull(); // 12° 라도 판정하지 않는다
      expect(r?.checks?.transmissionInfo.detail.join(' ')).toContain('판정하지 않는다');
    });

    it('링크 길이가 없으면 정직 거부', () => {
      expect(check({ fourBarMeta: {} })?.ok).toBe(false);
    });
  });

  describe('하드 기하 순서 — 어기면 형상이 성립하지 않는다', () => {
    it.each([
      ['프로펠러 허브 ≥ 외경', { propellerMeta: { diameter: 100, hubDia: 200 } }],
      ['펌프 볼류트 ≤ 흡입', { pumpMeta: { voluteDia: 100, suctionDia: 150, dischargeDia: 100 } }],
      ['밸브 몸통 ≤ 보어', { valveMeta: { bodyDia: 100, dn: 150 } }],
    ])('%s → 걸린다', (_label, asm) => {
      expect(check(asm)?.checks?.dimensionOrder.pass).toBe(false);
    });
  });

  describe('등간격 배치 자기정합', () => {
    it('롤러 개수 × 피치가 전장을 넘으면 치수 자기모순', () => {
      const r = check({ conveyorMeta: { rollers: 20, rollerPitch: 900, length: 6000 } });
      expect(r?.checks?.span.pass).toBe(false);
      expect(r?.checks?.span.detail.join(' ')).toContain('17100');
    });

    it('스테이션도 같은 규칙', () => {
      expect(check({ machineLineMeta: { stations: 10, stationPitch: 1500, length: 6000 } })?.checks?.span.pass).toBe(false);
    });

    it('개수가 1 이하거나 값이 없으면 판정하지 않는다(null) — 억지 판정 금지', () => {
      expect(check({ conveyorMeta: { rollers: 1, rollerPitch: 900, length: 6000 } })).toBeNull();
    });
  });

  describe('지배 입력이 없으면 지어내지 않고 거부한다', () => {
    it.each([
      ['금형 구배', { moldMeta: { blockW: 300 } }, 'draftDeg'],
      ['버킷 굴착력', { bucketMeta: { width: 1500 } }, 'breakoutForceKN'],
      ['송전탑 풍하중', { towerMeta: { legs: 4 } }, 'basicWindSpeedMs'],
    ])('%s → needInputs 로 무엇이 필요한지 말한다', (_l, asm, want) => {
      const r = check(asm);
      expect(r?.ok).toBe(false);
      expect(r?.needInputs?.map((x) => x.name)).toContain(want);
    });

    it('송전탑은 자중만 보고 "안전"이라 하지 않는다 — 지배 하중은 풍·장력이다', () => {
      const r = check({ towerMeta: { legs: 4 } });
      expect(r?.needInputs?.map((x) => x.name)).toContain('conductorTensionKN');
    });
  });
});
