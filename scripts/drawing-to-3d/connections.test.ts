/**
 * connections.test.ts — **체결부 강도·접촉 선언**(PBAS 0.7.3 이식 ②, 260803).
 *
 * ## 왜 이식했나
 * 간섭·부유·자유도까지 봤지만 **부재를 잇는 것 자체가 버티나**는 못 봤다.
 * 부재가 멀쩡해도 핀이 전단으로 잘리면 설계는 실패다.
 *
 * ## 이 파일이 지키는 것
 * ① **손으로 풀리는 값과 맞는다.** τ=F/A · σ=32M/πd³ · L10=(C/P)^p 는 검산된다.
 * ② **미검토를 통과로 세지 않는다.** 제원을 안 적을수록 통과율이 오르면 정확히 거꾸로다.
 * ③ **다른 질문은 따로 답한다.** 체결부 불합격이 `designOk`(조립 성립)에 섞이지 않는다.
 * ④ **면제 규칙은 한 곳에만.** 억지 끼워맞춤 선언은 `pairExempt` 안에서만 판단한다.
 */

import { describe, expect, it } from 'vitest';
import { analyzeConnections, checkConnection, connectorType, declaredContacts } from './connections.mjs';
import { buildAssembly, pairExempt } from './assembly.mjs';

type Chk = {
  type: string; status: string; pass: boolean | null; minimumSafetyFactor: number; governedBy: string;
  shearMPa: number; bearingMPa: number | null; bendingMPa: number; tearoutMPa: number | null;
  boltShearMPa: number; momentShearPerBoltN: number; directMPa: number; equivalentMPa: number;
  l10Mrev: number; l10Hours: number; note: string;
  requiredInputs?: string[]; requiredForFullQualification?: string[];
};
const check = checkConnection as unknown as (c: unknown, o?: unknown) => Chk;
const analyze = analyzeConnections as unknown as (a: unknown) => null | {
  checks: Chk[]; counts: Record<string, number>; allPass: boolean; note: string;
};
const contacts = declaredContacts as unknown as (a: unknown) => null | { contacts: Array<Record<string, unknown>>; errors: string[]; note: string };
const build = buildAssembly as unknown as (a: unknown, o?: unknown) => Record<string, unknown>;
const exempt = pairExempt as unknown as (a: unknown, b: unknown, ba: unknown, bb: unknown) => string | null;

const box = (min: number[], max: number[]) => ({ min, max });

describe('★① 손으로 풀리는 값과 맞는다', () => {
  it('핀 전단 τ=F/(n·πd²/4) — ⌀20 · 50kN · 단전단 = 159.15 MPa', () => {
    const r = check({ type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100 });
    expect(r.shearMPa).toBeCloseTo(50000 / (Math.PI * 400 / 4), 6);
    expect(r.shearMPa).toBeCloseTo(159.155, 3);
    expect(r.minimumSafetyFactor).toBeCloseTo(100 / 159.155, 4);
    expect(r.pass, '안전율 0.63 이면 불합격이다').toBe(false);
    expect(r.governedBy).toBe('shear');
  });

  it('핀 복전단은 응력이 절반이다 — shearPlanes 가 실제로 먹는다', () => {
    const one = check({ type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100 });
    const two = check({ type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100, shearPlanes: 2 });
    expect(two.shearMPa).toBeCloseTo(one.shearMPa / 2, 6);
  });

  it('핀 휨 σ=32M/πd³ — ⌀20 · 200N·m = 254.6 MPa', () => {
    const r = check({ type: 'pin', pinDiameterMm: 20, forceN: 1, momentNm: 200, allowableShearMPa: 100 });
    expect(r.bendingMPa).toBeCloseTo(32 * 200 * 1000 / (Math.PI * 8000), 6);
    expect(r.bendingMPa).toBeCloseTo(254.648, 3);
  });

  it('핀 지압·연단찢김 — σb=F/(d·t) · σt=F/(2·t·(e−d/2))', () => {
    const r = check({ type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100,
      bearingThicknessMm: 10, allowableBearingMPa: 300, edgeDistanceMm: 30 });
    expect(r.bearingMPa!).toBeCloseTo(50000 / 200, 6);
    expect(r.tearoutMPa!, '리거먼트 = 30 − 10 = 20').toBeCloseTo(50000 / (2 * 10 * 20), 6);
    expect(r.status, '필수 제원이 다 있으면 완전검토').toBe('solved');
  });

  it('볼트군 직접전단 — 4×M16 · 80kN = 99.47 MPa', () => {
    const r = check({ type: 'bolt-group', boltCount: 4, boltDiameterMm: 16, forceN: 80000, allowableBoltShearMPa: 240 });
    expect(r.boltShearMPa).toBeCloseTo(20000 / (Math.PI * 256 / 4), 6);
    expect(r.boltShearMPa).toBeCloseTo(99.472, 3);
  });

  /** 탄성 볼트군: 가장 먼 볼트가 지배한다. R=√2·100=141.42 · ΣR²=4·20000. */
  it('볼트군 모멘트 분담 = M·rmax/ΣR² — ±100 정사각 4볼트 · 2kN·m = 3535.5 N', () => {
    const r = check({ type: 'bolt-group', boltDiameterMm: 16, allowableBoltShearMPa: 240, forceN: 0, momentNm: 2000,
      bolts: [{ xMm: -100, yMm: -100 }, { xMm: 100, yMm: -100 }, { xMm: 100, yMm: 100 }, { xMm: -100, yMm: 100 }] });
    expect(r.momentShearPerBoltN).toBeCloseTo(2000 * 1000 * Math.hypot(100, 100) / (4 * 20000), 3);
    expect(r.momentShearPerBoltN).toBeCloseTo(3535.53, 2);
  });

  it('용접 목 응력 σ=F/(L·a) — 400×5 · 100kN = 50 MPa', () => {
    const r = check({ type: 'weld-group', weldLengthMm: 400, weldThroatMm: 5, forceN: 100000, allowableWeldMPa: 120 });
    expect(r.directMPa).toBeCloseTo(50, 6);
    expect(r.minimumSafetyFactor).toBeCloseTo(2.4, 6);
    expect(r.pass).toBe(true);
  });

  it('베어링 L10=(C/P)^p — C25kN·P5kN·볼 = 125 Mrev · 1000rpm = 2083.3 h', () => {
    const r = check({ type: 'bearing', dynamicLoadRatingN: 25000, speedRpm: 1000, forceN: 5000, requiredLifeHours: 2000 });
    expect(r.l10Mrev).toBeCloseTo(125, 6);
    expect(r.l10Hours).toBeCloseTo(125e6 / 60000, 3);
    expect(r.pass, '요구 2000h < 수명 2083h').toBe(true);
  });

  /**
   * ⚠ **수명비에 응력 안전율을 걸면 안 된다.** 응력 SF 2 는 「허용의 절반만 쓴다」,
   *   수명비 2 는 「요구수명의 두 배를 산다」 — 다른 개념이다. L10 은 이미 신뢰도 90%를
   *   품고 있어 이중으로 깎인다. 실측: 수명 2083h/요구 2000h 인 정상 설계가 목표 2.0 에
   *   걸려 불합격으로 나왔다.
   */
  it('★수명비 목표는 응력 안전율과 분리돼 있다 — 기본 1, 따로 올릴 수 있다', () => {
    const base = { type: 'bearing', dynamicLoadRatingN: 25000, speedRpm: 1000, forceN: 5000, requiredLifeHours: 2000 };
    expect(check(base, { targetSafetyFactor: 5 }).pass, '응력 목표를 올려도 수명 판정은 안 바뀐다').toBe(true);
    expect(check({ ...base, targetLifeRatio: 2 }).pass, '수명비 목표를 올리면 바뀐다').toBe(false);
    expect(check(base).note).toMatch(/응력 안전율과 다른 개념/);
  });

  it('요구수명이 없으면 수명을 계산해 보여주되 판정은 하지 않는다', () => {
    const r = check({ type: 'bearing', dynamicLoadRatingN: 25000, speedRpm: 1000, forceN: 5000 });
    expect(r.l10Hours).toBeCloseTo(2083.33, 2);
    expect(r.status).toBe('pending');
    expect(r.pass).toBeNull();
  });

  it('롤러는 지수가 10/3 이라 같은 하중에서 수명이 더 길다', () => {
    const ball = check({ type: 'bearing', dynamicLoadRatingN: 25000, speedRpm: 1000, forceN: 5000 });
    const roller = check({ type: 'bearing', dynamicLoadRatingN: 25000, speedRpm: 1000, forceN: 5000, bearing: { elementType: 'roller', dynamicLoadRatingN: 25000, speedRpm: 1000 } });
    expect(roller.l10Mrev).toBeCloseTo(5 ** (10 / 3), 4);
    expect(roller.l10Mrev).toBeGreaterThan(ball.l10Mrev);
  });

  it.each([
    ['pin', 'pin'], ['pinned', 'pin'], ['clevis', 'pin'],
    ['bolted', 'bolt-group'], ['fastened', 'bolt-group'], ['flange', 'bolt-group'],
    ['welded', 'weld-group'], ['fillet', 'weld-group'], ['bearing', 'bearing'],
  ])('별칭 %s → %s', (input, expected) => expect(connectorType({ type: input })).toBe(expected));
});

describe('★② 미검토를 통과로 세지 않는다', () => {
  it('하중 선언이 없으면 pending — pass 는 false 가 아니라 null 이다', () => {
    const r = check({ type: 'pin', pinDiameterMm: 20, allowableShearMPa: 100 });
    expect(r.status).toBe('pending');
    expect(r.pass, 'false 로 두면 「불합격」으로 읽힌다').toBeNull();
    expect(r.note).toMatch(/안 잰 것/);
  });

  it.each([
    ['pin', { type: 'pin', forceN: 1000 }, /pinDiameterMm/],
    ['bolt-group', { type: 'bolt-group', forceN: 1000 }, /boltDiameterMm/],
    ['weld-group', { type: 'weld-group', forceN: 1000, weld: {} }, /weldThroatMm/],
    ['bearing', { type: 'bearing', forceN: 1000, bearing: {} }, /dynamicLoadRatingN/],
  ])('%s: 필수 제원이 없으면 무엇이 필요한지 적는다', (_t, input, re) => {
    const r = check(input);
    expect(r.status).toBe('pending');
    expect(r.requiredInputs!.join('·')).toMatch(re);
  });

  it('일부만 있으면 conditional 이고 안 본 파괴모드를 적는다', () => {
    const r = check({ type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100 });
    expect(r.status).toBe('conditional');
    expect(r.requiredForFullQualification).toContain('bearingThicknessMm');
    expect(r.note, '「여유롭다」로 읽히면 안 된다').toMatch(/부분 검토/);
  });

  /** ⚠ 모멘트를 받는데 볼트 좌표가 없으면 **전단만 본 것**이다. 조용히 0 으로 두면 안 된다. */
  it('★모멘트가 있는데 볼트 좌표가 없으면 미검토로 신고한다', () => {
    const r = check({ type: 'bolt-group', boltCount: 4, boltDiameterMm: 16, forceN: 0, momentNm: 2000, allowableBoltShearMPa: 240 });
    expect(r.momentShearPerBoltN).toBe(0);
    expect(r.requiredForFullQualification!.join('·')).toMatch(/xMm\/yMm/);
  });

  it('검토식이 없는 종류는 unsupported — 통과도 불합격도 아니다', () => {
    const r = check({ type: 'bonded', forceN: 1000 });
    expect(r.status).toBe('unsupported');
    expect(r.pass).toBeNull();
    expect(r.note).toMatch(/안 본 것/);
  });

  it('★allPass 는 미검토를 세지 않는다 — 제원을 안 적을수록 통과율이 오르면 거꾸로다', () => {
    const a = analyze({ connections: [
      { id: 'ok', type: 'weld-group', weldLengthMm: 400, weldThroatMm: 5, forceN: 100000, allowableWeldMPa: 120 },
      { id: 'unknown', type: 'pin' },
    ] })!;
    expect(a.counts).toMatchObject({ total: 2, solved: 1, notChecked: 1, failed: 0 });
    expect(a.note).toMatch(/미검토는 통과가 아니다/);
  });

  it('connections 선언이 없으면 null — 「이상 없음」이 아니다', () => {
    expect(analyze({ parts: [] })).toBeNull();
    expect(analyze({ connections: [] })).toBeNull();
  });
});

describe('★③ 다른 질문은 따로 답한다', () => {
  const ASM = {
    parts: [
      { id: 'plate', type: 'box', params: { width: 200, depth: 200, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
      { id: 'post', type: 'box', params: { width: 60, depth: 60, height: 300 }, at: { tx: 70, ty: 70, tz: 20 } },
    ],
    connections: [{ id: 'j1', between: ['plate', 'post'], type: 'pin', pinDiameterMm: 20, forceN: 50000, allowableShearMPa: 100 }],
  };

  it('체결부 불합격이 designOk 를 끌어내리지 않는다 — 조립 성립과 하중 저항은 다른 질문이다', () => {
    const r = build(structuredClone(ASM)) as { designOk: boolean; connections: { counts: Record<string, number> } };
    expect(r.connections.counts.failed, '핀은 안전율 0.63 으로 불합격').toBe(1);
    expect(r.designOk, '그래도 조립 자체는 성립한다(간섭·부유 없음)').toBe(true);
  });

  it('선언이 없으면 connections 키 자체가 안 붙는다', () => {
    const r = build({ parts: ASM.parts }) as Record<string, unknown>;
    expect(r.connections).toBeUndefined();
    expect(r.declaredContacts).toBeUndefined();
  });

  /**
   * ⚠ `contacts` 는 이미 **기하로 판정한** zero-thickness 맞닿음이다. 선언 접촉을 같은
   *   이름으로 실으면 스프레드 순서에 따라 조용히 덮어쓴다(실제로 그럴 뻔했다).
   */
  it('★판정한 접촉(contacts)과 선언한 접촉(declaredContacts)이 안 섞인다', () => {
    const r = build({ ...structuredClone(ASM), contacts: [{ between: ['plate', 'post'], kind: 'sliding', mu: 0.3 }] }) as
      { contacts: unknown[]; declaredContacts: { contacts: Array<{ kind: string; frictionCoefficient: number }> } };
    expect(Array.isArray(r.contacts), '기하 판정 결과는 배열 그대로다').toBe(true);
    expect(r.declaredContacts.contacts[0]).toMatchObject({ kind: 'sliding', frictionCoefficient: 0.3 });
  });

  it('접촉 선언이 망가지면 버리고 사유를 남긴다 — 조용히 넘기지 않는다', () => {
    const d = contacts({ contacts: [{ between: ['a', 'b'], kind: 'welded-ish' }, { between: ['a', 'a'], kind: 'bonded' }] })!;
    expect(d.contacts).toHaveLength(0);
    expect(d.errors).toHaveLength(2);
    expect(d.note).toMatch(/선언이지 판정이 아니다/);
  });
});

describe('★④ 면제 규칙은 한 곳에만 — 억지 끼워맞춤', () => {
  const hub = { id: 'hub', type: 'box', pressFitWith: 'bush' };
  const bush = { id: 'bush', type: 'cylinder' };

  it('선언된 과영은 간섭이 아니다', () => {
    expect(exempt(hub, bush, box([0, 0, 0], [100, 100, 50]), box([99.9, 0, 0], [140, 100, 50])))
      .toMatch(/억지 끼워맞춤/);
  });

  /** ⚠ 선언만으로 무제한 면제하면 「끼워맞춤이라 적었으니 통과」로 총체적 오류를 덮는다. */
  it('★상한을 넘는 겹침은 선언해도 면제하지 않는다 — 과영은 부재 절반이 아니다', () => {
    expect(exempt(hub, bush, box([0, 0, 0], [100, 100, 50]), box([50, 0, 0], [140, 100, 50])))
      .toBeNull();
  });

  it('선언이 없으면 면제하지 않는다 — 우연히 겹친 남남을 묶지 않는다', () => {
    expect(exempt({ id: 'a', type: 'box' }, { id: 'b', type: 'box' },
      box([0, 0, 0], [100, 100, 50]), box([99.9, 0, 0], [140, 100, 50]))).toBeNull();
  });

  it('contacts 의 interference-fit 선언이 부품 속성으로 정규화된다 — 문법은 둘, 규칙은 하나', () => {
    const r = build({
      parts: [
        { id: 'hub', type: 'box', params: { width: 100, depth: 100, height: 50 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'shaft', type: 'box', params: { width: 40, depth: 100, height: 50 }, at: { tx: 99.5, ty: 0, tz: 0 } },
      ],
      contacts: [{ between: ['hub', 'shaft'], kind: 'interference-fit', interferenceMm: 0.5 }],
    }) as { interferences: unknown[]; assembly: { parts: Array<{ pressFitWith?: string }> } };
    expect(r.assembly.parts[0].pressFitWith).toBe('shaft');
    expect(r.interferences, '선언된 과영은 간섭으로 안 센다').toHaveLength(0);
  });
});
