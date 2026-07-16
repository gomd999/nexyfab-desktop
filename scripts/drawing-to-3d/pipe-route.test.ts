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

describe('pipeObstacleCheck — 원통 인식 + 접속 끝점 자동 허용 (위시빌더 260717)', () => {
  const tankRound = { label: 'coag', min: [50, 120, 150], max: [610, 680, 1350], round: 'z' };
  it('접속 끝점(장비 근방)은 자동 허용', () => {
    const v = pipeObstacleCheck([{ label: 'out', pts: [[610, 400, 1085], [900, 400, 1085]], d: 26 }], [tankRound]);
    expect(v).toEqual([]);
  });
  it('AABB 모서리 스침은 원통 인식으로 오탐 제거', () => {
    // 세그먼트가 env 모서리(x640, y435)를 지나지만 반경상 여유 — round:z 처리로 통과
    const v = pipeObstacleCheck([{ label: 'hdr', pts: [[640, 435, 900], [640, 435, 1400]], d: 22 }], [tankRound]);
    expect(v).toEqual([]);
  });
  it('실제 반경 침투는 플래그', () => {
    const v = pipeObstacleCheck([{ label: 'bad', pts: [[330, -100, 800], [330, 900, 800]], d: 26 }], [tankRound]);
    expect(v.length).toBeGreaterThan(0);
  });
});

import { supportCheck } from './support-check.mjs';

describe('supportCheck — 지지 체인(연결≠지지)', () => {
  const deck = { label: 'deck', min: [0, 0, 142], max: [1900, 800, 151], base: true };
  it('데크에 얹힌 장비 → supported', () => {
    const r = supportCheck([deck, { label: 'pump', min: [400, 300, 150], max: [600, 500, 400] }]);
    expect(r.floating).toEqual([]);
  });
  it('허공 장비 → floating (배관 연결만으론 지지 아님)', () => {
    const r = supportCheck([deck, { label: 'ro', min: [600, 230, 990], max: [1700, 630, 1130] }]);
    expect(r.floating).toEqual(['ro']);
  });
  it('크로스 빔 경유 전파', () => {
    const beam = { label: 'beam', min: [895, 0, 940], max: [945, 800, 990], base: true };
    const r = supportCheck([deck, beam, { label: 'ro', min: [600, 230, 964], max: [1700, 630, 1130] }]);
    expect(r.floating).toEqual([]);
  });
  it('스트랩 부피 겹침 = 체결', () => {
    const strap = { label: 'strap', min: [1858, 290, 190], max: [1890, 340, 950], base: true };
    const r = supportCheck([strap, { label: 'panel', min: [1790, 260, 300], max: [1890, 580, 920] }]);
    expect(r.floating).toEqual([]);
  });
  it('ghost(옵션 마커)는 검사 제외', () => {
    const r = supportCheck([deck, { label: 'tray', min: [100, 100, 1290], max: [400, 300, 1490], ghost: true }]);
    expect(r.floating).toEqual([]);
  });
});

import { pipeCrossCheck } from './pipe-route.mjs';

describe('pipeCrossCheck — 배관 상호 교차(크로스 커넥션)', () => {
  it('서로 다른 라인의 직교 관통 → 플래그', () => {
    const v = pipeCrossCheck([
      { label: 'A', pts: [[760, 0, 812], [760, 0, 262], [760, 700, 262]], d: 26 },
      { label: 'B', pts: [[600, 0, 500], [900, 0, 500]], d: 26 },
    ]);
    expect(v.length).toBeGreaterThan(0);
  });
  it('라이저 끝 → 헤더 접속(의도된 티)은 허용', () => {
    const v = pipeCrossCheck([
      { label: 'riser', pts: [[1180, 300, 1166], [1180, 300, 1400]], d: 20 },
      { label: 'header', pts: [[1180, 150, 1400], [1180, 710, 1400]], d: 20 },
    ]);
    expect(v).toEqual([]);
  });
  it('평행 레인 30mm 이격(d26)은 통과', () => {
    const v = pipeCrossCheck([
      { label: 'A', pts: [[880, 110, 812], [880, 110, 262]], d: 26 },
      { label: 'B', pts: [[880, 140, 842], [880, 140, 228]], d: 26 },
    ]);
    expect(v).toEqual([]);
  });
});
