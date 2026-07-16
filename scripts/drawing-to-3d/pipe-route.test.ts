// @ts-nocheck — .mjs 모듈 대상 런타임 검증(타입 선언 없음)
import { describe, it, expect } from 'vitest';
import { routeGate, routeFeatures, stubFeatures, pipeObstacleCheck } from './pipe-route.mjs';
import { normalizeFeatures } from './compose.mjs';

describe('routeGate — 시공 불가 경로 거부', () => {
  it('정상 맨해튼 경로 통과', () => {
    expect(routeGate([[0, 0, 0], [100, 0, 0], [100, 0, 200]], { d: 26 })).toEqual([]);
  });
  it('대각 세그먼트 거부', () => {
    const e = routeGate([[0, 0, 0], [100, 100, 0]], { d: 26 });
    expect(e.some((m) => m.includes('대각'))).toBe(true);
  });
  it('중복 waypoint 거부', () => {
    const e = routeGate([[0, 0, 0], [0, 0, 0], [0, 0, 100]], { d: 26 });
    expect(e.some((m) => m.includes('중복'))).toBe(true);
  });
  it('엘보 후퇴 불가능한 초단 세그먼트 거부', () => {
    // 내부 세그먼트 20mm, d=26 → 양쪽 후퇴 30mm > 20mm
    const e = routeGate([[0, 0, 0], [100, 0, 0], [100, 20, 0], [100, 20, 200]], { d: 26 });
    expect(e.some((m) => m.includes('후퇴'))).toBe(true);
  });
});

describe('routeFeatures — OCCT 안전 배관 생성', () => {
  it('세그먼트 후퇴로 직교 파이프가 waypoint에서 직접 만나지 않는다(탄젠트 abort 방지)', () => {
    const { features, errors } = routeFeatures([[0, 0, 0], [100, 0, 0], [100, 0, 200]], { d: 26 });
    expect(errors).toEqual([]);
    const cyls = features.filter((f) => f.kind === 'cylinder');
    expect(cyls).toHaveLength(2);
    // 수평 세그먼트는 x=100(waypoint)까지 못 미치고 ret=15 후퇴
    const horiz = cyls.find((f) => f.at.rotate?.[1] === 90);
    expect(horiz.at.translate[0] + horiz.height).toBeLessThan(100 - 10);
    // 수직 세그먼트 시작도 z=0(waypoint)에서 ret만큼 위
    const vert = cyls.find((f) => !f.at.rotate);
    expect(vert.at.translate[2]).toBeGreaterThan(10);
    // 엘보는 스피어가 아닌 큐브
    expect(features.some((f) => f.kind === 'sphere')).toBe(false);
    expect(features.filter((f) => f.kind === 'box')).toHaveLength(1);
  });
  it('불량 경로는 피처 대신 errors 반환(조용한 생성 금지)', () => {
    const { features, errors } = routeFeatures([[0, 0, 0], [50, 50, 0]], { d: 26 });
    expect(features).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('stubFeatures', () => {
  it('축 방향별 관+플랜지 생성', () => {
    for (const axis of ['x+', 'x-', 'y+', 'y-', 'z+', 'z-']) {
      const F = stubFeatures([10, 20, 30], axis, 22);
      expect(F).toHaveLength(2);
      expect(F[1].diameter).toBe(38); // 플랜지 d+16
    }
  });
});

describe('pipeObstacleCheck — 장비 관통 검사', () => {
  const tank = { label: 'tank', min: [0, 0, 0], max: [500, 500, 1000] };
  it('장비를 관통하는 배관 플래그', () => {
    const v = pipeObstacleCheck([{ label: 'feed', pts: [[-100, 250, 500], [700, 250, 500]], d: 26 }], [tank]);
    expect(v).toHaveLength(1);
    expect(v[0].obstacle).toBe('tank');
  });
  it('접속 장비(allow)는 관통으로 안 봄', () => {
    const v = pipeObstacleCheck([{ label: 'feed', pts: [[-100, 250, 500], [700, 250, 500]], d: 26, allow: ['tank'] }], [tank]);
    expect(v).toEqual([]);
  });
  it('회피 경로는 위반 0', () => {
    const v = pipeObstacleCheck([{ label: 'feed', pts: [[-100, 250, 1100], [700, 250, 1100]], d: 26 }], [tank]);
    expect(v).toEqual([]);
  });
});

describe('normalizeFeatures — OCCT 견고화 새니타이즈', () => {
  it('완전 동일 피처 dedup(자기융합 abort 방지)', () => {
    const f = { kind: 'sphere', diameter: 34, op: 'add', at: { translate: [1, 2, 3] } };
    const intent = { features: [f, JSON.parse(JSON.stringify(f)), { kind: 'box', size: [10, 10, 10], op: 'add', at: { translate: [0, 0, 0] } }] };
    normalizeFeatures(intent);
    expect(intent.features).toHaveLength(2);
  });
  it('정확 외접 스피어 지름 축소(탄젠트 특이점 방지)', () => {
    const intent = {
      features: [
        { kind: 'sphere', diameter: 34, op: 'add', at: { translate: [0, 0, 0] } },
        { kind: 'sphere', diameter: 34, op: 'add', at: { translate: [0, 0, 34] } }, // 중심거리 34 = r+r
      ],
    };
    normalizeFeatures(intent);
    expect(intent.features[1].diameter).toBeLessThan(34);
    expect(intent.features[0].diameter).toBe(34);
  });
});
