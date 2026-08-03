/**
 * corridor-sweep.test.ts — **코리더**(갭 빈칸 ③)와 **파라미터 스윕**(빈칸 ④ 대체) (260803).
 *
 * ## 두 빈칸을 어떻게 닫았나
 * ③ 코리더  : 횡단면을 선형 따라 스윕. 물량은 폐형과 대조하고, 곡선 현 근사 오차는
 *              **값으로**(`maxChordSagMm`) 낸다 — 「근사입니다」만 쓰면 얼마나 틀렸는지 모른다.
 * ④ 데이터 트리: 노드 그래프를 만들지 않았다. 그 효용의 핵심인 **변형 배열 생성**을
 *              템플릿 파라미터 스윕으로 낸다 — 파라미터가 전부 min/max·enum 을 갖고 있어
 *              **타입 검증까지 우리가 한다**(노드 그래프는 그걸 사용자에게 떠넘긴다).
 *
 * ⚠ 코리더는 **템플릿 카탈로그에 넣지 않았다.** 카탈로그는 「전 종이 소비자에게 판정을
 *   전달한다」를 계약으로 갖는데 도로 기하구조 판정은 KDS 도로설계기준 영역이라 못 지킨다.
 *   면제를 선언해 남기는 대신 **MCP 도구로 노출**했다 — 계약이 없는 자리에 둔다.
 */

import { describe, expect, it } from 'vitest';
import { buildCorridor } from './corridor.mjs';
import { sweepTemplate, SWEEP_MAX } from './sweep.mjs';
import { buildAssembly } from './assembly.mjs';
import { listAssemblyTemplates } from './domain-assemblies.mjs';

type Corr = {
  parts: Array<{ id: string; type: string }>;
  alignmentErrors?: string[];
  corridorMeta: { lengthMm: number; volumeM3: number; maxChordSagMm: number; stations: number; stationTable: Array<{ superPct: number }> };
};
const corr = buildCorridor as unknown as (s: unknown) => Corr;
const ROAD = { id: 'road', points: [[-3500, 0], [3500, 0], [3500, -300], [-3500, -300]] };
const base = (over: Record<string, unknown> = {}) => corr({
  ips: [[0, 0], [100000, 0], [160000, 60000]], curves: [{ ip: 1, R: 200000 }],
  sections: [ROAD], stepMm: 5000, ...over,
});

describe('★코리더 — 물량은 폐형과 대조한다', () => {
  it('부피 = 단면적 × 연장 (폭 7000 × 두께 300)', () => {
    const r = base();
    expect(r.corridorMeta.volumeM3).toBeCloseTo(7000 * 300 * r.corridorMeta.lengthMm / 1e9, 3);
  });

  it('★현 근사 오차를 값으로 낸다 — step 을 줄이면 준다(sag ∝ step²)', () => {
    const a = base({ stepMm: 10000 }).corridorMeta.maxChordSagMm;
    const b = base({ stepMm: 5000 }).corridorMeta.maxChordSagMm;
    const c = base({ stepMm: 1000 }).corridorMeta.maxChordSagMm;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(b / a).toBeCloseTo(0.25, 1); // step 절반 → sag 1/4
  });

  it('직선만이면 근사 오차가 0 이다 — 없는 오차를 지어내지 않는다', () => {
    const r = corr({ ips: [[0, 0], [100000, 0]], sections: [ROAD], stepMm: 5000 });
    expect(r.corridorMeta.maxChordSagMm).toBe(0);
  });

  it('★인접 구간을 간섭으로 세지 않는다 — 실물은 한 몸이다', () => {
    const b = buildAssembly(base() as never) as unknown as { interferences: unknown[]; designOk: boolean; contacts: Array<{ note: string }> };
    expect(b.interferences).toEqual([]);
    expect(b.designOk).toBe(true);
    expect(b.contacts.filter((c) => c.note.startsWith('연속 부재')).length).toBeGreaterThan(0);
  });

  it('★편경사는 선언한 구간만 반영한다 — 미선언을 표준값으로 채우지 않는다', () => {
    expect(base().corridorMeta.stationTable.every((s) => s.superPct === 0)).toBe(true);
    const t = base({ superelevation: [{ sta: 0, pct: 0 }, { sta: 176000, pct: 6 }] }).corridorMeta.stationTable;
    expect(t[t.length - 1].superPct).toBeCloseTo(6, 0);
  });

  it('선형·단면이 없으면 거부한다 — 기본값을 지어내지 않는다', () => {
    expect(corr({ sections: [ROAD] }).alignmentErrors?.join(' ')).toMatch(/ips/);
    expect(corr({ ips: [[0, 0], [1000, 0]] }).alignmentErrors?.join(' ')).toMatch(/sections/);
  });

  it('★템플릿 카탈로그에는 없다 — 판정 계약을 못 지키는 것을 넣지 않는다', () => {
    const ids = (listAssemblyTemplates as unknown as () => Array<{ id: string }>)().map((t) => t.id);
    expect(ids).not.toContain('road_corridor');
  });
});

type Sweep = {
  ok: boolean; errors: string[]; total?: number; clamped?: string[];
  variants?: Array<{ params: Record<string, number>; designOk: boolean | null; massKg: number | null }>;
  summary?: { feasible: number; infeasible: number; lightestByMass: { params: Record<string, number>; massKg: number } | null };
};
const sweep = sweepTemplate as unknown as (s: unknown) => Sweep;

describe('★파라미터 스윕 — 데이터 트리 대체', () => {
  it('데카르트 곱을 전부 돌고 결과를 남긴다', () => {
    const r = sweep({ domain: 'civil', id: 'box_culvert', sweep: { innerWidth: { from: 2000, to: 4000, step: 1000 }, wallThk: [250, 350] } });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(6);
    expect(r.variants).toHaveLength(6);
    expect(r.summary!.feasible + r.summary!.infeasible).toBe(6);
  });

  it('from~to 끝값을 포함한다 — 부동소수 누적으로 마지막이 빠지면 안 된다', () => {
    const r = sweep({ domain: 'civil', id: 'box_culvert', sweep: { innerWidth: { from: 3000, to: 5000, step: 500 } } });
    expect(r.variants!.map((v) => v.params.innerWidth)).toEqual([3000, 3500, 4000, 4500, 5000]);
  });

  it('★범위 밖 값은 클램프하고 알린다 — 조용히 자르면 요청한 값이 돈 줄 안다', () => {
    const r = sweep({ domain: 'civil', id: 'box_culvert', sweep: { innerWidth: [500, 3000, 99999] } });
    expect(r.clamped!.join(' ')).toMatch(/500 → 800/);
    expect(r.clamped!.join(' ')).toMatch(/99999 → 8000/);
  });

  it('★상한을 넘으면 자르지 않고 거부한다 — 「상위 N개만」은 「전부 봤다」로 읽힌다', () => {
    const r = sweep({ domain: 'civil', id: 'box_culvert', sweep: { innerWidth: { from: 800, to: 8000, step: 50 } } });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/자르지 않고 거부/);
    expect(r.total).toBeGreaterThan(SWEEP_MAX);
  });

  it('없는 파라미터·없는 템플릿은 이름을 알려주며 거부한다', () => {
    expect(sweep({ domain: 'civil', id: 'box_culvert', sweep: { 없는것: [1] } }).errors[0]).toMatch(/파라미터가 아니다/);
    expect(sweep({ domain: 'mech', id: 'box_culvert', sweep: { innerWidth: [3000] } }).errors[0]).toMatch(/도메인이 다르다/);
  });

  it('★「최적」을 정하지 않는다 — 한 가지 기준임을 이름에 적는다', () => {
    const r = sweep({ domain: 'civil', id: 'box_culvert', sweep: { wallThk: [250, 350, 450] } });
    expect(r.summary!.lightestByMass).toBeTruthy();
    expect(r.summary!.lightestByMass!.params.wallThk, '얇을수록 가볍다').toBe(250);
    expect(Object.keys(r.summary!)).not.toContain('best');
  });

  it('불가능 조합도 결과에 남긴다 — 어디까지가 가능 영역인지가 답이다', () => {
    const r = sweep({ domain: 'mech', id: 'four_bar', sweep: { crank: { from: 100, to: 900, step: 200 } } });
    expect(r.variants!.length).toBe(5);
    // Grashof/조립 불가 조합이 섞여도 배열에서 빠지지 않는다
    expect(r.summary!.feasible + r.summary!.infeasible).toBe(5);
  });
});
