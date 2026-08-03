/**
 * kinematics.test.ts — **구속 야코비안 자유도**(PBAS 0.7.3 이식 ③, 260803).
 *
 * ## 왜 이식했나
 * `mobility.mjs` 의 Kutzbach 는 **치수를 안 본다.** 링크와 쌍을 셀 뿐이라 「몇 개가 여분
 * 구속인지」·「지금 자세가 특이 자세에 가까운지」를 못 말한다. 야코비안은 배치를 넣어 **푼다**.
 *
 * ## 이 파일이 지키는 것
 * ① **손으로 아는 기구와 맞는다.** 4절·슬라이더크랭크·평행사변형 M=1, 6축 로봇팔 M=6.
 * ② **수치 랭크가 정직하다.** 랭크는 min(행,열) 을 못 넘고, 공차 근처면 그렇다고 말한다.
 * ③ **안 잰 것과 0 을 구분한다.** joints 선언이 없으면 `null`.
 * ④ **두 방법을 덮어쓰지 않는다.** buildAssembly 는 Kutzbach 와 야코비안을 나란히 낸다.
 */

import { describe, expect, it } from 'vitest';
import { allowedTwists, constraintRows, rankDiagnostics, solveMobility } from './kinematics.mjs';

type Sol = {
  mobility: number | null; rank: number; rows: number; redundant: number; links: number;
  totalDof: number; conditionNumber: number | null; illConditioned: boolean;
  borderline: number; rankCertain: boolean; errors: string[]; note: string;
  perJoint: Array<{ type: string; allowedDof: number; constraintRows: number }>;
};
const solve = solveMobility as unknown as (a: unknown, o?: unknown) => Sol | null;
const twists = allowedTwists as unknown as (j: unknown) => number[][];
const rows = constraintRows as unknown as (a: number[][], d?: number) => number[][];
const diag = rankDiagnostics as unknown as (r: number[][], o?: unknown) => {
  rank: number; conditionNumber: number; borderline: number; tolerance: number; largest: number;
};

const rev = (a: string, b: string, axis: string, atMm: number[]) => ({ type: 'revolute', axis, between: [a, b], atMm });
/** 첫 부품을 접지로 둔 어셈블리. */
const asm = (ids: string[], joints: unknown[]) => ({
  parts: ids.map((id, i) => ({ id, ...(i === 0 ? { role: 'frame' } : {}) })),
  joints,
});

const FOUR_BAR = asm(['g', 'crank', 'coupler', 'rocker'], [
  rev('g', 'crank', 'z', [0, 0, 0]), rev('crank', 'coupler', 'z', [120, 0, 0]),
  rev('coupler', 'rocker', 'z', [350, 80, 0]), rev('rocker', 'g', 'z', [400, 0, 0]),
]);
/** 평행사변형: 같은 축·나란한 링크 둘. Kutzbach **공간식**이면 M=−2 라 하는 그 사례다. */
const PARALLELOGRAM = asm(['g', 'bar', 'l1', 'l2'], [
  rev('g', 'l1', 'z', [0, 0, 0]), rev('l1', 'bar', 'z', [0, 200, 0]),
  rev('g', 'l2', 'z', [300, 0, 0]), rev('l2', 'bar', 'z', [300, 200, 0]),
]);
const SLIDER_CRANK = asm(['g', 'crank', 'rod', 'slider'], [
  rev('g', 'crank', 'z', [0, 0, 0]), rev('crank', 'rod', 'z', [100, 0, 0]),
  rev('rod', 'slider', 'z', [400, 0, 0]), { type: 'prismatic', axis: 'x', between: ['slider', 'g'] },
]);
const ARM_IDS = ['base', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
const ROBOT_ARM = asm(ARM_IDS, ['z', 'y', 'y', 'x', 'y', 'x'].map((ax, i) => rev(ARM_IDS[i], ARM_IDS[i + 1], ax, [i * 100, 0, i * 80])));

describe('★① 손으로 아는 기구와 맞는다', () => {
  it.each([
    ['4절 링크', FOUR_BAR, 1],
    ['슬라이더-크랭크', SLIDER_CRANK, 1],
    ['평행사변형 링크', PARALLELOGRAM, 1],
    ['6축 직렬 로봇팔', ROBOT_ARM, 6],
  ])('%s 의 자유도 = %i', (_n, a, expected) => {
    expect(solve(a)?.mobility).toBe(expected);
  });

  it.each([
    ['fixed', 0, 0], ['revolute', 1, 1], ['prismatic', 1, 1], ['cylindrical', 2, 2],
    ['spherical', 3, 3], ['planar', 3, 3], ['screw', 1, 1], ['cam', 2, 2],
  ])('단일 %s 쌍: 허용 %i · 자유도 %i', (type, allowed, m) => {
    expect(twists({ type, axis: 'z', leadMmPerRev: 2 })).toHaveLength(allowed);
    expect(solve(asm(['g', 'a'], [{ type, axis: 'z', leadMmPerRev: 2, between: ['g', 'a'], atMm: [0, 0, 0] }]))?.mobility).toBe(m);
  });

  /**
   * ★평면 기구를 **공간 6자유도로** 풀면 면외 구속(tz·ωx·ωy)이 루프마다 3개 겹친다.
   *   이 3 이 「여분 구속」이고, Kutzbach 공간식이 M=−2 라 말하는 정체다.
   */
  it('평면 폐루프 하나 = 여분 구속 3 — Kutzbach 가 음수로만 말하던 것이 개수로 나온다', () => {
    for (const a of [FOUR_BAR, SLIDER_CRANK, PARALLELOGRAM]) {
      const s = solve(a)!;
      expect(s.redundant, '면외 3구속').toBe(3);
      expect(s.rank).toBe(17);
      expect(s.rows).toBe(20);
    }
  });

  it('직렬 기구는 여분 구속이 없다 — 폐루프가 없으니 겹칠 것도 없다', () => {
    expect(solve(ROBOT_ARM)!.redundant).toBe(0);
  });

  it('★운동쌍을 더 물리면 여분 구속이 늘고 자유도가 죽는다', () => {
    const over = { ...FOUR_BAR, joints: [...FOUR_BAR.joints, rev('g', 'coupler', 'z', [200, 40, 0])] };
    const s = solve(over)!;
    expect(s.mobility).toBe(0);
    expect(s.redundant).toBeGreaterThan(solve(FOUR_BAR)!.redundant);
  });
});

describe('★② 수치 랭크가 정직하다', () => {
  /**
   * ⚠ Gram 행렬(JᵀJ) 을 거치므로 **정밀도가 절반**이다 — 참값 0 인 특이값이 √eps·σmax 로
   *   뜬다. 공차를 eps·σmax 로 잡으면 노이즈를 세어 **랭크가 과대평가**된다.
   *   실측: 슬라이더-크랭크 rank 18(참값 17) → 자유도 0 으로 오답. 4절은 우연히 맞았다.
   */
  it('랭크는 행 수도 열 수도 넘지 않는다', () => {
    for (const a of [FOUR_BAR, SLIDER_CRANK, PARALLELOGRAM, ROBOT_ARM]) {
      const s = solve(a)!;
      expect(s.rank).toBeLessThanOrEqual(s.rows);
      expect(s.rank).toBeLessThanOrEqual(s.totalDof);
    }
  });

  it('공차는 최대 특이값에 상대적이다 — 크기를 1000배 해도 랭크가 같다', () => {
    const j = [[1, 0, 0], [0, 1, 0], [1, 1, 0]];
    expect(diag(j).rank).toBe(2);
    expect(diag(j.map((r) => r.map((v) => v * 1000))).rank, '절대공차면 여기서 갈린다').toBe(2);
    expect(diag(j.map((r) => r.map((v) => v * 1e-6))).rank).toBe(2);
  });

  it('★열이 행보다 많아도 「경계」로 오탐하지 않는다 — 뒤쪽은 구조적으로 0이다', () => {
    const s = solve(ROBOT_ARM)!;
    expect(s.totalDof, '미지수 36 > 구속행 30').toBeGreaterThan(s.rows);
    expect(s.borderline, '구조적 0을 세면 멀쩡한 로봇팔이 매번 불확정으로 보고된다').toBe(0);
    expect(s.rankCertain).toBe(true);
  });

  it('조건수가 나온다 — 특이 자세를 볼 수 있는 유일한 창이다', () => {
    expect(solve(FOUR_BAR)!.conditionNumber).toBeGreaterThan(0);
    expect(solve(FOUR_BAR)!.illConditioned).toBe(false);
    expect(diag([[1, 0], [0, 1e-5]]).conditionNumber).toBeGreaterThan(1e4);
  });

  /**
   * ⚠ **조건수에는 천장이 있다.** 살아남은 최소 특이값은 공차보다 크므로
   *   `cond < 1/(max(m,n)·√eps) ≈ 3e6`. 그래서 `illConditioned` 를 1e10 으로 잡으면
   *   **영원히 안 걸린다**(처음에 그렇게 써 놨다). 죽은 경보는 없는 경보보다 나쁘다 —
   *   「검사했는데 정상」으로 읽히기 때문이다. 임계는 공차 대비 상대치여야 한다.
   */
  it('★특이 자세에 가까우면 illConditioned 가 실제로 걸린다 — 죽은 플래그가 아니다', () => {
    // 로커를 0.1mm 까지 줄여 토글(특이) 자세로 몬다 — 실측 조건수 ≈ 4e4
    const toggle = asm(['g', 'crank', 'coupler', 'rocker'], [
      rev('g', 'crank', 'z', [0, 0, 0]), rev('crank', 'coupler', 'z', [120, 0, 0]),
      rev('coupler', 'rocker', 'z', [380, 0.1, 0]), rev('rocker', 'g', 'z', [400, 0, 0]),
    ]);
    const s = solve(toggle)!;
    expect(s.illConditioned, `조건수 ${s.conditionNumber}`).toBe(true);
    expect(s.note).toMatch(/특이 자세/);
    expect(solve(FOUR_BAR)!.illConditioned, '정상 자세는 안 걸린다').toBe(false);
  });

  /**
   * ★**더 짜부라뜨리면 자유도 자체가 틀린다.** 링크가 0.001mm 로 줄면 구속이 수치적으로
   *   무너져 M 이 1→2 로 튄다. 이걸 조용히 내면 「자유도 2 기구」로 읽힌다 —
   *   `borderline` 이 「랭크가 공차에 민감하다」고 말해 주는 것이 이 상황의 전부다.
   */
  it('★랭크가 무너지는 구간에서는 반드시 borderline 으로 신고한다', () => {
    const collapsed = asm(['g', 'crank', 'coupler', 'rocker'], [
      rev('g', 'crank', 'z', [0, 0, 0]), rev('crank', 'coupler', 'z', [120, 0, 0]),
      rev('coupler', 'rocker', 'z', [380, 0.001, 0]), rev('rocker', 'g', 'z', [400, 0, 0]),
    ]);
    const s = solve(collapsed)!;
    expect(s.mobility, '수치적으로 무너져 참값 1 에서 벗어난다').toBe(2);
    expect(s.borderline, '틀린 값을 조용히 내지 않는다').toBeGreaterThan(0);
    expect(s.rankCertain).toBe(false);
    expect(s.note).toMatch(/±1 흔들릴 수 있다/);
  });

  it('허용 트위스트의 여집합이 구속 행이다 — 개수가 6 으로 맞아떨어진다', () => {
    for (const t of ['fixed', 'revolute', 'cylindrical', 'spherical', 'planar']) {
      const a = twists({ type: t, axis: 'z' });
      expect(a.length + rows(a).length).toBe(6);
    }
  });
});

describe('★③ 안 잰 것과 0 을 구분한다', () => {
  it('joints 선언이 없으면 null — 「자유도 0」이 아니다', () => {
    expect(solve({ parts: [{ id: 'a' }] })).toBeNull();
    expect(solve({ parts: [{ id: 'a' }], joints: [] })).toBeNull();
  });

  it('선언이 망가졌으면 mobility=null 과 사유를 낸다 — 조용히 0 을 주지 않는다', () => {
    const s = solve({ parts: [], joints: [{ type: 'revolute', between: ['a', 'a'] }] })!;
    expect(s.mobility).toBeNull();
    expect(s.errors[0]).toMatch(/서로 달라야/);
    expect(s.note).toMatch(/0 이 아니다/);
  });

  it('전부 접지면 0 이라고 말하되 사유를 붙인다', () => {
    const s = solve(asm(['g', 'g2'], [{ type: 'revolute', axis: 'z', between: ['g', 'g2'], atMm: [0, 0, 0] }]),
      { ground: ['g', 'g2'] })!;
    expect(s.mobility).toBe(0);
    expect(s.note ?? '').toBeDefined();
  });

  /** ⚠ 값 하나만 주면 「확정된 자유도」로 읽힌다. 한계를 반드시 문장으로 붙인다. */
  it('note 가 선형화·순간 운동학이라는 한계를 말한다', () => {
    expect(solve(FOUR_BAR)!.note).toMatch(/선형화|순간/);
    expect(solve(FOUR_BAR)!.note).toMatch(/여분 구속 3개/);
  });
});

describe('★④ 두 방법을 덮어쓰지 않는다 — 이식만 하고 안 쓰면 무효다', async () => {
  const { buildAssembly } = await import('./assembly.mjs') as unknown as {
    buildAssembly: (a: unknown) => { mobility?: { mobility: number; formula: string; jacobian?: Sol } };
  };

  it('buildAssembly 가 Kutzbach 와 야코비안을 나란히 낸다', () => {
    const r = buildAssembly({
      parts: [
        { id: 'g', type: 'box', role: 'frame', params: { width: 500, depth: 60, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'crank', type: 'box', params: { width: 120, depth: 20, height: 12 }, at: { tx: 60, ty: 0, tz: 40 } },
        { id: 'coupler', type: 'box', params: { width: 260, depth: 20, height: 12 }, at: { tx: 240, ty: 0, tz: 60 } },
        { id: 'rocker', type: 'box', params: { width: 100, depth: 20, height: 12 }, at: { tx: 400, ty: 0, tz: 40 } },
      ],
      joints: FOUR_BAR.joints,
    });
    expect(r.mobility?.formula, 'Kutzbach 쪽은 그대로 남는다').toBeTruthy();
    expect(r.mobility?.jacobian?.mobility, '야코비안이 함께 붙는다').toBe(1);
    expect(r.mobility?.jacobian?.redundant).toBe(3);
  });

  it('joints 가 없으면 야코비안 키도 안 붙는다', () => {
    const r = buildAssembly({
      parts: [{ id: 'a', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 } }],
    });
    expect(r.mobility).toBeUndefined();
  });
});
