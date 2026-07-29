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
import { buildAssemblyTemplate as _bt, listAssemblyTemplates as listTemplates } from './domain-assemblies.mjs';

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

describe('mech 판정 깊이 확장 (260729) — 미사용 선언값의 자기정합', () => {
  // 전수 실측: mech 판정 평균이 템플릿당 1.1개였다. 메타에는 쓰이지 않는 선언값이
  // 많았고 대부분 **정의식으로 대조 가능**했다. 평균 1.1 → 2.4 (오탐 0).
  const check = mechCheck as unknown as (a: unknown) => {
    ok: boolean; checks?: Record<string, { pass: boolean | null; detail: string[] }>;
  } | null;

  describe('기어열 — 정의식 대조', () => {
    it('피치원 지름 = 모듈 × 잇수 (d = m·z)', () => {
      const bad = check({ gearMeta: { module: 3, teeth: [20, 40], pitchDias: [60, 999] } });
      expect(bad?.checks?.pitchDia.pass).toBe(false);
      const ok = check({ gearMeta: { module: 3, teeth: [20, 40], pitchDias: [60, 120] } });
      expect(ok?.checks?.pitchDia.pass).toBe(true);
    });

    it('총 감속비 = 잇수비 연쇄곱', () => {
      expect(check({ gearMeta: { module: 3, teeth: [20, 40, 20, 60], totalRatio: 5 } })
        ?.checks?.totalRatio.pass).toBe(false);
      expect(check({ gearMeta: { module: 3, teeth: [20, 40, 20, 60], totalRatio: 3 } })
        ?.checks?.totalRatio.pass).toBe(true);
    });

    it('반올림 표기를 불일치로 잡지 않는다 — 선언 자릿수로 대조', () => {
      // 1000/3 = 333.333… 인데 제원표는 333.3 으로 적는다. 이걸 FAIL 로 내면 오탐이다.
      expect(check({ gearMeta: { module: 3, teeth: [20, 40, 20, 60], totalRatio: 3, outputPer1000rpm: 333.3 } })
        ?.checks?.outputRpm.pass).toBe(true);
      expect(check({ gearMeta: { module: 3, teeth: [20, 40, 20, 60], totalRatio: 3, outputPer1000rpm: 400 } })
        ?.checks?.outputRpm.pass).toBe(false);
    });
  });

  describe('하드 기하 추가', () => {
    it('열교환기 동체 외경 > 내경', () => {
      expect(check({ hxMeta: { tubePitch: 25, tubeOD: 19, shellOD: 600, shellID: 620 } })
        ?.checks?.shell.pass).toBe(false);
    });
    it('펌프 축 높이 ≥ 볼류트 반경 — 미달이면 볼류트가 바닥을 파고든다', () => {
      expect(check({ pumpMeta: { voluteDia: 480, suctionDia: 150, dischargeDia: 100, axisH: 100 } })
        ?.checks?.axisClearance.pass).toBe(false);
      expect(check({ pumpMeta: { voluteDia: 480, suctionDia: 150, dischargeDia: 100, axisH: 360 } })
        ?.checks?.axisClearance.pass).toBe(true);
    });
  });

  describe('선언 수량 ↔ 실제 부품 수', () => {
    it('프로펠러 날 수가 실제 블레이드 부품 수와 다르면 걸린다', () => {
      const asm = {
        propellerMeta: { diameter: 800, hubDia: 144, blades: 5 },
        parts: [{ id: 'blade_1' }, { id: 'blade_2' }, { id: 'blade_3' }],
      };
      expect(check(asm)?.checks?.bladeCount.pass).toBe(false);
      expect(check(asm)?.checks?.bladeCount.detail.join(' ')).toContain('선언 5 vs 실제 부품 3');
    });

    it('단위가 다른 선언에는 붙이지 않는다 — conveyor legs 는 벤트 조 수다', () => {
      // 실측으로 걸렀다: legs=5 인데 부품은 leg_N_1·leg_N_2·legtie_N 15개.
      // 부품을 세어 비교하면 오탐이 된다.
      const r = check(tpl('mech', 'conveyor', {}));
      expect(Object.keys(r?.checks ?? {})).not.toContain('legCount');
      expect(Object.keys(r?.checks ?? {})).toContain('rollerCount'); // 단위가 맞는 것은 검사한다
    });
  });

  it('출하 mech 템플릿 — 오탐 0(전도 2건은 실측 확인된 진짜 신호)', () => {
    let total = 0, judged = 0;
    const failedKeys: string[] = [];
    for (const t of (listTemplates as unknown as (d: string) => { id: string }[])('mech')) {
      const r = check(tpl('mech', t.id, {}));
      if (!r || r.ok === false) continue;
      const ks = Object.entries(r.checks ?? {});
      judged += 1; total += ks.length;
      for (const [k, c] of ks) if (c.pass === false) failedKeys.push(`${t.id}.${k}`);
    }
    // ⚠ 260729b: 전도 검토를 배선하자 four_bar·robot_arm 이 걸렸다. **오탐이 아니다** —
    //   좌표로 확인했다: four_bar CG y=88.4 vs 지지 y∈[-20,20] · robot_arm CG x=332.5 vs
    //   지지 x∈[-170,170]. 팔·링크가 뻗은 자세라 무게중심이 베이스 밖으로 나간다.
    //   실제 장비는 앵커로 고정하므로 검토 문구가 그 사실을 함께 밝힌다.
    expect(failedKeys.sort()).toEqual(['four_bar.staticTipover', 'robot_arm.staticTipover']);
    expect(total / judged).toBeGreaterThan(2);
  });
});

describe('정적 전도 — 있는 계산이 판정에 닿는다 (260729b, P1-5)', () => {
  const chk = (id: string, p: unknown = {}) =>
    (_mc as unknown as (a: unknown, p: unknown) => { checks?: Record<string, {
      pass: boolean | null; labelKo?: string; detail?: string[]; needInputs?: { name: string }[] }> } | null)(
      (_bt as unknown as (d: string, i: string, p: unknown) => unknown)('mech', id, {}), p);

  it('전 기계 템플릿에 전도 검토가 붙는다 — 메타 유무와 무관하다', () => {
    for (const id of ['tower_crane', 'conveyor', 'gear_train', 'mold_cavity']) {
      expect(chk(id)?.checks?.staticTipover, id).toBeDefined();
    }
    // ⚠ 적용 검사가 없는 것(배관 부속)에는 붙이지 않는다 — 「검증 없음」과 「통과」의 구별.
    expect(chk('flanged_fitting')).toBeNull();
  });

  it('무게중심이 지지 밖이면 **얼마나** 벗어났는지 적는다', () => {
    // edgeDistMm 은 밖으로 나가도 0 으로 잘려 「경계」와 「크게 벗어남」이 같은 값이 된다.
    const d = chk('robot_arm')?.checks?.staticTipover;
    expect(d?.pass).toBe(false);
    expect(d?.detail?.join(' ')).toMatch(/X 16[0-9.]+mm 벗어났다/);
    // 앵커 고정 장비면 해당 없음이라는 사실도 함께 적는다 — 과탐으로 읽히지 않게.
    expect(d?.detail?.join(' ')).toContain('앵커로 고정하는 장비');
  });

  it('지진 전도는 판정하지 않는다 — seismicG 0.5 는 코드가 채운 가정이다', () => {
    const s = chk('conveyor')?.checks?.seismicTipover;
    expect(s?.pass).toBeNull();
    expect(s?.needInputs?.[0].name).toBe('seismicG');
    expect(s?.detail?.join(' ')).toContain('지어내면');
  });

  it('지반가속도를 선언하면 그때 판정한다', () => {
    const s = chk('conveyor', { seismicG: 0.22 })?.checks?.seismicTipover;
    expect(typeof s?.pass).toBe('boolean');
    expect(s?.labelKo).toContain('0.22g');
  });

  it('지지점을 못 잡으면 「판정 불가」 — 통과가 아니다', () => {
    const d = chk('machine_line')?.checks?.staticTipover;
    expect(d?.pass).toBeNull();
    expect(d?.detail?.join(' ')).toContain('판정하지 못했다');
  });
});
