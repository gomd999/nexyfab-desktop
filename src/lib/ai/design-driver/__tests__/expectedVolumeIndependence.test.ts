/**
 * expectedVolume 의 **독립성**이 검사의 전부라는 것을 고정한다 (260728, §6-1).
 *
 * 인수인계 260727 §6 은 모델의 기하/산술 오류 축을 ★단일 최대 병목으로 지목하고 접근 (b)
 * 를 제안했다: "계획 단계에서 loop 면적을 결정론으로 계산해 제시하고 모델은 그걸 쓰게 한다".
 * 이 테스트는 **그 제안이 왜 안전하지 않은지**를 수치로 남긴다.
 *
 * geometryGate 가 잡는 것은 산술 오류가 아니라 **"그린 루프 ≠ 의도한 형상"** 이다.
 * measured 는 루프에서 나오고 expected 는 모델의 의도(브리프 치수)에서 나오므로, 둘이
 * 갈리면 루프가 잘못됐다는 뜻이다. expected 를 루프에서 계산해 주는 순간 두 값은 같은
 * 출처가 되어 비교가 항등식이 되고 — 잘못 그린 부품이 통과한다.
 *
 * 재현 케이스는 a4-11(채널 플랜지 실측 45 vs 청구 50)의 **실패 모양을 재구성**한 것이다
 * (같은 브리프가 아니라 같은 종류의 오류 — 치수는 이 테스트용으로 고른 값).
 */
import { describe, it, expect } from 'vitest';
import { buildPartGeometry, geometryGate } from '../geometryGate';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { PlanPart } from '../types';

const D = 200; // 압출 깊이 mm
// U 채널: 웹 100 폭 · 두께 10 · 플랜지 높이 h
const channelLoop = (h: number) => [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: h }, { x: 90, y: h },
  { x: 90, y: 10 }, { x: 10, y: 10 }, { x: 10, y: h }, { x: 0, y: h },
];
// 손계산: 웹 100×10 + 플랜지 2×(h−10)×10
const area = (h: number) => 100 * 10 + 2 * (h - 10) * 10;

const INTENDED_H = 50; // 브리프가 요구한 플랜지 높이
const DRAWN_H = 45;    // 모델이 실제로 그린 높이 (a4-11 이 낸 바로 그 오류)
const INTENT_VOLUME = area(INTENDED_H) * D; // 360000
const LOOP_VOLUME = area(DRAWN_H) * D;      // 340000

/** 플랜지 h 인 채널의 파라메트릭 분해 — 브리프 치수로 쓴다(루프를 보지 않는다). */
const decomp = (h: number) => ({
  depthMm: D,
  terms: [
    { shape: 'rect' as const, widthMm: 100, heightMm: 10 },        // 웹
    { shape: 'rect' as const, widthMm: 10, heightMm: h - 10 },     // 플랜지 ×2
    { shape: 'rect' as const, widthMm: 10, heightMm: h - 10 },
  ],
});

const part = (expectedMm3: number): PlanPart => ({
  partId: 'channel',
  name: 'U-Channel',
  material: 'AL6061',
  process: 'cnc',
  bodies: [{
    bodyId: 'main',
    feature: { kind: 'extrude', loop: channelLoop(DRAWN_H), depth: D, direction: 'one_sided', mode: 'add' } satisfies ExtrudeFeature,
  }],
  expectedVolume: { valueMm3: expectedMm3, basis: `채널 프로파일 면적 × 깊이 ${D} mm — 테셀레이션 없음` },
});

describe('expectedVolume 은 루프와 독립이어야 한다 (§6-1 접근 (b) 의 위험)', () => {
  it('사전 확인: 그린 루프의 실측 부피는 의도한 부피와 다르다', () => {
    const geo = buildPartGeometry(part(INTENT_VOLUME));
    expect(LOOP_VOLUME).not.toBe(INTENT_VOLUME);
    expect(geo.totalVolumeMm3).toBeCloseTo(LOOP_VOLUME, 6);
  });

  it('의도(브리프 치수)에서 나온 expectedVolume 은 잘못 그린 루프를 잡는다 — 현재 동작', () => {
    const res = geometryGate(part(INTENT_VOLUME), buildPartGeometry(part(INTENT_VOLUME)));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('deviates from theoretical');
    // 게이트가 두 값을 모두 보고하므로 사용자는 어느 쪽이 틀렸는지 추적할 수 있다
    expect(res.metrics.expectedVolumeMm3).toBe(INTENT_VOLUME);
    expect(res.metrics.totalVolumeMm3).toBeCloseTo(LOOP_VOLUME, 6);
  });

  it('★루프에서 유도한 값을 모델이 인용하면 같은 결함 부품이 통과한다 — 접근 (b) 를 쓰면 안 되는 이유', () => {
    // "엔진이 계산, 모델은 인용" 을 그대로 구현하면 expected 는 정확히 이 값이 된다.
    const res = geometryGate(part(LOOP_VOLUME), buildPartGeometry(part(LOOP_VOLUME)));
    expect(res.pass).toBe(true); // ← 플랜지가 45 인 채로 통과한다
    expect(res.metrics.volumeRelError).toBeLessThan(1e-9);
    // 즉 이 배선은 게이트를 항등식으로 만든다: 검사가 사라진 것을 "개선"으로 착각하게 된다.
  });
});

/**
 * 채택한 해법: 모델은 **분해**(브리프 치수로 쓴 두 번째 진술)를 주고 산술은 엔진이 한다.
 * 산술 부담은 사라지지만 두 출처는 여전히 독립이므로 검사가 살아 있다.
 */
describe('분해(decomposition) — 산술은 엔진이, 의도는 모델이', () => {
  const withDecomp = (h: number, valueMm3?: number): PlanPart => {
    const p = part(0);
    return {
      ...p,
      expectedVolume: {
        basis: `브리프 치수로 선언한 채널 단면(플랜지 ${h}) × 깊이 ${D} mm`,
        decomposition: decomp(h),
        ...(valueMm3 !== undefined ? { valueMm3 } : {}),
      },
    };
  };

  it('★valueMm3 없이 분해만 줘도 잘못 그린 루프를 그대로 잡는다 — 모델은 산술을 전혀 안 한다', () => {
    const p = withDecomp(INTENDED_H); // 의도 = 플랜지 50, 그린 루프 = 45
    const res = geometryGate(p, buildPartGeometry(p));
    expect(res.pass).toBe(false);
    expect(res.metrics.decompositionVolumeMm3).toBe(INTENT_VOLUME);
    expect(res.reason).toContain('deviates from theoretical');
    // 근거가 notes 에 남아 "왜 360000인가"를 사람이 추적할 수 있다
    expect(res.notes.join(' ')).toContain('decomposition:');
  });

  it('의도대로 그린 부품은 분해만으로 통과한다 (과탐 0)', () => {
    const p = withDecomp(DRAWN_H); // 분해도 45 = 실제로 그린 것
    const res = geometryGate(p, buildPartGeometry(p));
    expect(res.pass).toBe(true);
    expect(res.metrics.decompositionVolumeMm3).toBe(LOOP_VOLUME);
  });

  it('산술 오류는 기하 오류와 **다른 문장**으로 보고된다 — 어디를 고칠지 알 수 있게', () => {
    // 분해는 맞게 썼는데(플랜지 45 = 그린 것) 숫자를 손으로 잘못 적은 경우.
    const p = withDecomp(DRAWN_H, 999999);
    const res = geometryGate(p, buildPartGeometry(p));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('arithmetic error in the stated theory');
    expect(res.reason).not.toContain('deviates from theoretical');
    expect(res.metrics.volumeArithmeticRelError).toBeGreaterThan(0);
  });

  it('분해가 성립하지 않으면(부호 조합 오류) 부피 0 부품으로 통과시키지 않고 거부한다', () => {
    const p = part(0);
    const bad: PlanPart = {
      ...p,
      expectedVolume: {
        basis: '부호를 잘못 쓴 분해',
        decomposition: { depthMm: D, terms: [{ shape: 'rect', widthMm: 10, heightMm: 10, sign: -1 }] },
      },
    };
    const res = geometryGate(bad, buildPartGeometry(bad));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('decomposition');
  });
});

/**
 * §7-1 — 불일치를 **어느 축인지** 말한다.
 * bench v1 실측에서 U-채널 2건이 정확히 같은 배수(7/3)로 틀렸다: 모델이 안쪽 포켓 높이를
 * '플랜지높이−벽두께'가 아니라 '벽두께'로 그린다. 부피 비율 하나로는 그게 안 보인다.
 */
describe('불일치 국소화 — 깊이 축 / 단면 축을 갈라 말한다 (§7-1)', () => {
  // 실측 재현: 외곽 100×50 에서 포켓을 80×10 으로 파버린 루프(= b-04 가 낸 바로 그 실수)
  const WRONG_POCKET_LOOP = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 90, y: 50 },
    { x: 90, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 50 }, { x: 0, y: 50 },
  ]; // 면적 = 5000 − 80×10 = 4200 → ×200 = 840000 (실측치와 동일)

  const channelPart = (loop: Array<{ x: number; y: number }>, depth: number): PlanPart => ({
    partId: 'channel', name: 'U-Channel', material: 'SS400', process: 'cnc',
    bodies: [{ bodyId: 'main', feature: { kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add' } satisfies ExtrudeFeature }],
    expectedVolume: {
      basis: '브리프 치수: 웹 100×10 + 플랜지 2×10×40, × 깊이 200',
      decomposition: decomp(INTENDED_H), // 1800 mm² × 200 = 360000
    },
  });

  it('단면이 틀린 경우: 실측 부피뿐 아니라 그린 면적·외곽까지 사유에 나온다', () => {
    const p = channelPart(WRONG_POCKET_LOOP, D);
    const res = geometryGate(p, buildPartGeometry(p));
    expect(res.pass).toBe(false);
    expect(res.metrics.totalVolumeMm3).toBeCloseTo(840000, 6); // bench v1 실측치 재현
    expect(res.metrics.drawnAreaMm2).toBeCloseTo(4200, 6);
    expect(res.metrics.declaredAreaMm2).toBeCloseTo(1800, 6);
    expect(res.reason).toContain('cross-section area');
    expect(res.reason).toContain('outer extent 100×50');
    expect(res.reason).not.toContain('extrude depth:'); // 깊이는 맞다 — 틀렸다고 말하지 않는다
  });

  it('깊이가 틀린 경우: 단면이 아니라 깊이를 지목한다', () => {
    // 루프는 의도대로(플랜지 50), 깊이만 200 대신 100 으로 그렸다
    const correctLoop = channelLoop(INTENDED_H);
    const p = channelPart(correctLoop, 100);
    const res = geometryGate(p, buildPartGeometry(p));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('extrude depth: you drew 100 mm but declared 200 mm');
    expect(res.reason).not.toContain('cross-section area');
  });

  it('깊이·단면 둘 다 맞는데 부피가 다르면 그 사실을 말한다 (루프 자체를 의심하라)', () => {
    // 자기교차 "나비" 루프: shoelace 면적은 상쇄돼 선언과 같아 보이지만 메시 부피는 다르다.
    const p = channelPart(channelLoop(INTENDED_H), D);
    const geo = buildPartGeometry(p);
    // 부피만 인위적으로 어긋나게 해 세 번째 분기를 태운다(빌드는 정상 경로 그대로).
    const res = geometryGate(p, { ...geo, totalVolumeMm3: geo.totalVolumeMm3 * 1.5 });
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('both match your decomposition');
  });
});
