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
  it('불량 경로는 피처 대신 errors 반환(조용한 생성 금지 — normalize:false 원시 게이트)', () => {
    const { features, errors } = routeFeatures([[0, 0, 0], [50, 50, 0]], { d: 26, normalize: false });
    expect(features).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
  it('기본(normalize)은 대각 입력을 축분해로 정상화하되 adjustments 로 정직 보고', () => {
    const { features, errors, adjustments } = routeFeatures([[0, 0, 0], [50, 50, 0]], { d: 26 });
    expect(errors).toEqual([]);
    expect(features.length).toBeGreaterThan(0);
    expect(adjustments.some((a) => a.includes('대각'))).toBe(true);
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

// ── 위시빌더 교훈 일반화 배치 (2026-07-17): #3 게이트 비우회화 · #4 부재별 장애물 ·
//    #5 면접촉 매립 제안 · #6 배관 어셈블리 승격 ────────────────────────────────
import { normalizeRoute, portPoint, autoRoutePipes } from './pipe-route.mjs';

describe('routeGate — 백트랙(역주행) 거부 (#3)', () => {
  it('같은 축 역방향 연속 세그먼트 = 자기 배관 관통 거부', () => {
    const e = routeGate([[0, 0, 0], [200, 0, 0], [100, 0, 0]], { d: 26 });
    expect(e.some((m) => m.includes('역주행'))).toBe(true);
  });
});

describe('normalizeRoute — 수동 경로 정규화 (#3, routeGate 우회 함정의 코드화)', () => {
  it('대각 세그먼트를 축순차로 분해하고 endAxis 축을 마지막(축방향 진입)으로', () => {
    const { pts, adjustments } = normalizeRoute([[0, 0, 0], [300, 200, 0]], { endAxis: 'y+' });
    expect(adjustments.length).toBeGreaterThan(0);
    // 마지막 세그먼트는 y축 이동(스텁 축방향 진입 엘보)
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    expect(Math.abs(b[1] - a[1])).toBeGreaterThan(0);
    expect(Math.abs(b[0] - a[0])).toBeLessThan(1e-6);
    expect(routeGate(pts, { d: 26 })).toEqual([]);
  });
  it('중복 waypoint 제거 + 동일축 연속 병합', () => {
    const { pts } = normalizeRoute([[0, 0, 0], [0, 0, 0], [100, 0, 0], [250, 0, 0], [250, 0, 300]]);
    expect(pts).toEqual([[0, 0, 0], [250, 0, 0], [250, 0, 300]]);
  });
  it('routeFeatures 기본 normalize — 대각 입력도 축분해 후 생성(오렌더 대신 정상화)', () => {
    const { features, errors, adjustments } = routeFeatures([[0, 0, 0], [300, 0, 200]], { d: 26 });
    expect(errors).toEqual([]);
    expect(adjustments.length).toBeGreaterThan(0);
    expect(features.filter((f) => f.kind === 'cylinder')).toHaveLength(2);
  });
});

describe('pipeObstacleCheck — y축 원통 장애물 (#4 부재별 장애물 일반화)', () => {
  const roY = { label: 'ro1', min: [600, 100, 900], max: [800, 1100, 1100], round: 'y' };
  it('반경 밖 모서리 스침은 통과', () => {
    const v = pipeObstacleCheck([{ label: 'ln', pts: [[790, -200, 1090], [790, -60, 1090]], d: 20 }], [roY]);
    expect(v).toEqual([]);
  });
  it('축심 관통은 플래그', () => {
    const v = pipeObstacleCheck([{ label: 'bad', pts: [[500, 600, 1000], [900, 600, 1000]], d: 20 }], [roY]);
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('supportCheck — 면접촉 매립 제안 (#5)', () => {
  const deck = { label: 'deck', min: [0, 0, 0], max: [1000, 800, 150], base: true };
  it('0겹침 면접촉 → 지지는 OK, 매립 제안 반환', () => {
    const r = supportCheck([deck, { label: 'pump', min: [200, 200, 150], max: [400, 400, 350] }]);
    expect(r.floating).toEqual([]);
    expect(r.faceContacts).toHaveLength(1);
    expect(r.faceContacts[0]).toMatchObject({ part: 'pump', on: 'deck' });
    expect(r.faceContacts[0].suggestTzMm).toBeLessThan(0);
  });
  it('이미 매립(부피 겹침)된 부품은 제안 없음', () => {
    const r = supportCheck([deck, { label: 'pump', min: [200, 200, 148], max: [400, 400, 350] }]);
    expect(r.faceContacts).toEqual([]);
  });
});

describe('autoRoutePipes — 배관 자동 라우터 (#6)', () => {
  const a = { label: 'a', min: [0, 0, 0], max: [400, 400, 400] };
  const b = { label: 'b', min: [800, 0, 0], max: [1200, 400, 400] };
  it('마주보는 포트 직결 — 게이트·관통·교차 전부 클린', () => {
    const { routes, features, errors } = autoRoutePipes([{ id: 'feed1', from: 'a.x+', to: 'b.x-', d: 26, col: '#2563eb' }], [a, b]);
    expect(errors).toEqual([]);
    expect(routes).toHaveLength(1);
    expect(pipeObstacleCheck(routes, [a, b])).toEqual([]);
    // 스텁(관+플랜지)×2 + 세그먼트
    expect(features.filter((f) => f.kind === 'cylinder').length).toBeGreaterThanOrEqual(5);
    expect(features.every((f) => !f._col || f._col === '#2563eb')).toBe(true);
  });
  it('사이 장비를 오버헤드 코리도로 회피', () => {
    const mid = { label: 'mid', min: [500, 0, 0], max: [700, 400, 600] };
    const { routes, errors } = autoRoutePipes([{ id: 'feed1', from: 'a.x+', to: 'b.x-', d: 26 }], [a, mid, b]);
    expect(errors).toEqual([]);
    expect(pipeObstacleCheck(routes, [a, mid, b])).toEqual([]);
    // 코리도 상승 — 최고 z 가 장비 위
    expect(Math.max(...routes[0].pts.map((p) => p[2]))).toBeGreaterThan(600);
  });
  it('두 라인 교차 회피 — 기라우팅 배관과 교차하는 후보는 버린다', () => {
    const c = { label: 'c', min: [0, 800, 0], max: [400, 1200, 400] };
    const d2 = { label: 'd', min: [800, 800, 0], max: [1200, 1200, 400] };
    const { routes, errors } = autoRoutePipes([
      { id: 'p1', from: 'a.y+', to: 'd.y-', d: 26 },
      { id: 'p2', from: 'c.x+', to: 'b.x-', d: 26 },
    ], [a, b, c, d2]);
    expect(errors).toEqual([]);
    expect(pipeCrossCheck(routes)).toEqual([]);
  });
  it('없는 부품 참조는 정직한 에러', () => {
    const { routes, errors } = autoRoutePipes([{ id: 'p1', from: 'a.x+', to: 'ghost.x-' }], [a, b]);
    expect(routes).toEqual([]);
    expect(errors[0]).toContain('ghost');
  });
  it('마주보는 포트 좁은 간격+z 오프셋 — 면 중간분할 조그 폴백(260717 예시 배터리)', () => {
    // 포트 간격 100mm(스텁 40×2 후 팁 간격 20 < 엘보 후퇴 24)·z 375 오프셋 —
    // 리드 순열은 백트랙/초단 세그먼트로 전멸하던 배치: 면 조그가 정공법 경로를 낸다
    const pump = { label: 'pump', min: [900, 350, 100], max: [1200, 550, 350] };
    const vessel = { label: 'vessel', min: [1300, 350, 100], max: [1500, 550, 1100] };
    const { routes, errors } = autoRoutePipes([{ id: 'p_hp', from: 'pump.x+', to: 'vessel.x-', d: 20 }], [pump, vessel]);
    expect(errors).toEqual([]);
    expect(routes).toHaveLength(1);
    // 경로가 면에서 면까지 — 중간 x 분할점 존재(1250 부근), 세그먼트 전부 ≥ 엘보 후퇴
    const xs = routes[0].pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(1200);
    expect(Math.max(...xs)).toBe(1300);
    expect(pipeObstacleCheck(routes, [pump, vessel])).toEqual([]);
  });
});

describe('portPoint', () => {
  it('면 중심 + 축', () => {
    const it_ = { min: [0, 0, 0], max: [100, 200, 300] };
    expect(portPoint(it_, 'x+')).toEqual({ p: [100, 100, 150], axis: 'x+' });
    expect(portPoint(it_, 'z-')).toEqual({ p: [50, 100, 0], axis: 'z-' });
  });
});

import { buildAssembly, obstaclesFromAssembly, roundAxisOf } from './assembly.mjs';

describe('buildAssembly — 설계 타당성 그물 제품 배선 (#2·#6 통합)', () => {
  it('부유 부품 감지 + designOk=false', () => {
    const built = buildAssembly({
      name: 't', parts: [
        { id: 'base', type: 'box', params: { width: 500, depth: 500, height: 100 } },
        { id: 'floater', type: 'box', params: { width: 200, depth: 200, height: 100 }, at: { tx: 150, ty: 150, tz: 500 } },
      ],
    });
    expect(built.ok).toBe(true);
    expect(built.support.floating).toEqual(['floater']);
    expect(built.designOk).toBe(false);
  });
  it('pipes[] 승격 — 라우팅·검사·GA/SCAD 포함, designOk=true', () => {
    const built = buildAssembly({
      name: 'skid', parts: [
        { id: 'a', type: 'box', params: { width: 400, depth: 400, height: 400 }, service: 'feed' },
        { id: 'b', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 800 } },
      ],
      pipes: [{ id: 'feed1', from: 'a.x+', to: 'b.x-', d: 26, service: 'feed' }],
    });
    expect(built.ok).toBe(true);
    expect(built.pipes.errors).toEqual([]);
    expect(built.pipes.routes).toHaveLength(1);
    expect(built.pipes.obstacleViolations).toEqual([]);
    expect(built.pipes.crossViolations).toEqual([]);
    expect(built.designOk).toBe(true);
    expect(built.openscad).toContain('pipes (auto-routed)');
    // 계통색 GA — 배관 피처가 feed 색으로 composeIntent 에 포함
    expect(built.composeIntent.features.some((f) => f._col === '#2563eb' && f.kind === 'cylinder' && !f.diameterHole)).toBe(true);
  });
  it('슬리브 재분류 — 벽(passable) 관통=명세·designOk 유지, 위반 아님 (비기계 일반화)', () => {
    const built = buildAssembly({
      name: 'unit', parts: [
        { id: 'floor', type: 'box', params: { width: 4000, depth: 3000, height: 100 }, role: 'floor' },
        { id: 'wall_mid', type: 'box', params: { width: 150, depth: 3000, height: 2400 }, at: { tx: 1900, tz: 100 }, role: 'wall' },
        { id: 'fx_a', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 400, ty: 1300, tz: 100 } },
        { id: 'fx_b', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 3200, ty: 1300, tz: 100 } },
      ],
      pipes: [{ id: 'ln1', from: 'fx_a.x+', to: 'fx_b.x-', d: 50, service: 'drain' }],
    });
    expect(built.ok).toBe(true);
    expect(built.pipes.errors).toEqual([]);
    expect(built.pipes.obstacleViolations).toEqual([]);
    expect(built.pipes.sleeves.map((s) => s.through)).toContain('wall_mid');
    expect(built.designOk).toBe(true);
  });
  it('obstaclesFromAssembly — 원통 부품은 round 태그(부재별 장애물, #4)', () => {
    const obs = obstaclesFromAssembly({
      parts: [
        { id: 'vessel', type: 'cylinder', params: { diameter: 200, length: 1000 } },
        { id: 'ro', type: 'tube', params: { outerDia: 200, innerDia: 180, length: 1000 }, at: { ry: 90 } },
        { id: 'frame', type: 'box', params: { width: 100, depth: 100, height: 100 } },
      ],
    });
    expect(obs.find((o) => o.label === 'vessel').round).toBe('z');
    expect(obs.find((o) => o.label === 'ro').round).toBe('x');
    expect(obs.find((o) => o.label === 'frame').round).toBeUndefined();
    expect(roundAxisOf({ type: 'cylinder', at: { rx: -90 } })).toBe('y');
  });
});

import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { computeBOQ } from './boq.mjs';
import { mepDrainageCheck } from './interior-check.mjs';

describe('제안 배치 — BOQ 배관 물량·rc_frame 입상관·DFU 폐루프·가구 장애물', () => {
  it('rc_frame 우수 입상관: 층 슬래브 관통 = 층수만큼 슬리브 명세(위치·높이 포함)·designOk', () => {
    const built = buildAssembly(buildAssemblyTemplate('building', 'rc_frame', { floors: 3, baysX: 2, baysY: 2 }));
    expect(built.pipes.errors).toEqual([]);
    expect(built.pipes.sleeves.map((s) => s.through)).toEqual(['slab_f1', 'slab_f2', 'slab_f3']);
    expect(built.pipes.sleeves.every((s) => Number.isFinite(s.heightMm))).toBe(true);
    expect(built.designOk).toBe(true);
  });
  it('computeBOQ piping: 라우트 길이=결정론 물량(계통별 m·엘보·슬리브)', () => {
    const b = computeBOQ(buildAssemblyTemplate('interior', 'studio_unit', {}));
    expect(b.piping).not.toBeNull();
    expect(b.piping.totalM).toBeGreaterThan(5);
    expect(b.piping.byService.drain.lines).toBe(3);
    expect(b.piping.byService.supply.lines).toBe(1);
    expect(b.piping.sleeves).toBeGreaterThan(0);
  });
  it('mepDrainageCheck: 기구 DFU→소요 DN 대 계획 DN 폐루프(KDS 31 30 25)', () => {
    const m = mepDrainageCheck(buildAssemblyTemplate('interior', 'studio_unit', {}));
    const toilet = m.lines.find((l) => l.line === 'drain_toilet');
    expect(toilet).toMatchObject({ fixture: '대변기_6L', requiredDN: 50, plannedDN: 75, verdict: 'PASS' });
    expect(m.stack).toMatchObject({ requiredDN: 50, plannedDN: 100, verdict: 'PASS' });
  });
  it('customFurniture = 배관 장애물 — 드래그 가구를 넣어도 재라우팅으로 위반 0', () => {
    const built = buildAssembly(buildAssemblyTemplate('interior', 'studio_unit', { customFurniture: [{ kind: 'sofa', x: 2200, y: 3300 }] }));
    expect(built.pipes.errors).toEqual([]);
    expect(built.pipes.obstacleViolations).toEqual([]);
    expect(built.designOk).toBe(true);
  });
});

import { landscapeCheck } from './landscape-check.mjs';
import { runCalculator } from '../engineering-core/registry.mjs';
import { ga2dDrawing, fmtLen, pickScale, staLabel, packageStamp, packageConsistencyCheck, structuralReport } from './package.mjs';
import { partCG } from './structural.mjs';
import { verifyClaims, verifyAlignmentClaims } from './intent-match.mjs';

describe('요청 정합(intent-match) — 결정론 판정부 (AI 추출 없이 폐형)', () => {
  const table = {
    parts: [
      { id: 'top', type: 'box', params: { width: 1200, depth: 700, height: 30 }, at: { tz: 700 }, role: 'table' },
      ...[[0, 0], [1150, 0], [0, 650], [1150, 650]].map(([x, y], i) => ({ id: `leg${i + 1}`, type: 'box', params: { width: 50, depth: 50, height: 700 }, at: { tx: x, ty: y }, role: 'column' })),
    ],
  };
  it('count·dimension·relation MATCH — 테이블(다리4·높이730·상판 on 다리)', () => {
    const r = verifyClaims([
      { kind: 'count', text: '다리 4개', part: '다리', count: 4 },
      { kind: 'dimension', text: '높이 730', part: '상판', value: 730, unit: 'mm', dim: 'max' },
      { kind: 'relation', text: '상판이 다리 위에', part: '상판', part2: '다리', relation: 'on' },
    ], table);
    // 높이 730: 상판 max 엔벨로프 z = 700+30=730 ✓
    expect(r.results.map((q) => q.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);
  });
  it('MISMATCH 노출 — 다리 3개 요구 vs 4개 생성 · 검증불가=UNVERIFIABLE(억지 판정 금지)', () => {
    const r = verifyClaims([
      { kind: 'count', text: '다리 3개', part: '다리', count: 3 },
      { kind: 'exists', text: '서랍', part: '서랍' },
      { kind: 'dimension', text: '?', part: '상판' }, // 값 없음
    ], table);
    expect(r.results[0].verdict).toBe('MISMATCH');
    expect(r.results[1].verdict).toBe('MISMATCH'); // 존재 요구 미충족은 명확한 불일치
    expect(r.results[2].verdict).toBe('UNVERIFIABLE');
    expect(r.mismatched).toBe(2);
  });
  it('문/창 수량 = wall_with_openings 개구 기준(sill 0/양수)', () => {
    const unit = buildAssemblyTemplate('interior', 'studio_unit', {});
    const r = verifyClaims([
      { kind: 'count', text: '문 2개', part: '문', count: 2 }, // 현관 1+욕실 1
      { kind: 'count', text: '창 1개', part: '창', count: 1 },
    ], unit);
    expect(r.results[0].verdict).toBe('MATCH');
    expect(r.results[1].verdict).toBe('MATCH');
  });
  it('선형 대조 — 연장·곡선 R·암거 존재', () => {
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { curves: [{ ip: 1, R: 30000 }], structures: [{ sta: 60000, type: 'culvert' }] });
    const r = verifyAlignmentClaims([
      { kind: 'dimension', text: '연장 220m', part: '연장', value: 220, unit: 'm' },
      { kind: 'dimension', text: 'R 30m', part: '반경', value: 30, unit: 'm' },
      { kind: 'exists', text: '암거', part: '암거' },
    ], asm.alignment);
    expect(r.results.map((q) => q.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);
    const bad = verifyAlignmentClaims([{ kind: 'dimension', text: '연장 500m', part: '연장', value: 500, unit: 'm' }], asm.alignment);
    expect(bad.results[0].verdict).toBe('MISMATCH');
  });
  it('KW_MAP 도메인 확장 — 옹벽·수납장·계단 대상어가 role/id 로 매칭', () => {
    const asm = {
      parts: [
        { id: 'stem1', type: 'box', params: { width: 300, depth: 5000, height: 3000 }, at: {}, role: 'retaining' },
        { id: 'cab1', type: 'box', params: { width: 600, depth: 350, height: 900 }, at: {}, role: 'cabinet' },
        { id: 'tread1', type: 'box', params: { width: 900, depth: 280, height: 40 }, at: {}, role: 'stair' },
        { id: 'tread2', type: 'box', params: { width: 900, depth: 280, height: 40 }, at: { tz: 180 }, role: 'stair' },
      ],
    };
    const r = verifyClaims([
      { kind: 'exists', text: '옹벽', part: '옹벽' },
      { kind: 'exists', text: '수납장', part: '수납장' },
      { kind: 'count', text: '디딤판 2개', part: '계단', count: 2 },
    ], asm);
    expect(r.results.map((q) => q.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);
  });
});

import { obbOverlap, boxPartsInterference } from './obb2d.mjs';
import { buildElements, chainAt, intersectSegment, groundFromContours } from './alignment-geom.mjs';

describe('무결성 규약 0단계 — OBB-SAT·chainage 요소열 (폐형 앵커)', () => {
  it('SAT: 분리·정확 접촉 0·관통 깊이·회전쌍', () => {
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [200, 0], h: [50, 50], deg: 45 }).overlap).toBe(false);
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [100, 0], h: [50, 50], deg: 0 }).overlap).toBe(false); // 정확 접촉=간섭 아님
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [60, 0], h: [50, 50], deg: 0 })).toMatchObject({ overlap: true, depthMm: 40 });
    expect(obbOverlap({ c: [0, 0], h: [100, 10], deg: 0 }, { c: [0, 50], h: [100, 10], deg: 45 }).overlap).toBe(true);
  });
  it('boxPartsInterference: 회전 box 쌍 실풋프린트 — AABB 과탐 제거', () => {
    // 45° 회전한 긴 벽 두 개, 법선 방향 이격 400·√2/2=565.7mm > 폭합 100 — 실풋프린트 분리.
    // (AABB 는 대각 팽창으로 크게 겹침 → 구 방식이면 오탐)
    const a = { type: 'box', params: { width: 100, depth: 4000, height: 500 }, at: { tx: 0, ty: 0, rz: 45 } };
    const b = { type: 'box', params: { width: 100, depth: 4000, height: 500 }, at: { tx: 400, ty: 400, rz: 45 } };
    expect(boxPartsInterference(a, b)).toMatchObject({ overlap: false });
    // 대조: 겹치게 좁히면 관통 검출
    const c = { type: 'box', params: { width: 100, depth: 4000, height: 500 }, at: { tx: 50, ty: 50, rz: 45 } };
    expect(boxPartsInterference(a, c).overlap).toBe(true);
  });
  it('요소열 90° 곡선 R=1000: TL=1000·L=πR/2·총연장 폐형·접선 연속', () => {
    const r = buildElements([[0, 0], [5000, 0], [5000, 5000]], [{ ip: 1, R: 1000 }], { baseW: 100 });
    expect(r.ok).toBe(true);
    const arc = r.elements.find((e) => e.type === 'arc');
    expect(Math.round(arc.TL)).toBe(1000);
    expect(Math.abs(arc.len - (Math.PI / 2) * 1000)).toBeLessThan(0.001);
    expect(Math.abs(r.totalMm - (4000 + arc.len + 4000))).toBeLessThan(0.001);
    // 접선 연속(BC 극한): ε=0.001mm
    const d1 = chainAt(r.elements, arc.BCmm - 0.001).dir, d2 = chainAt(r.elements, arc.BCmm + 0.001).dir;
    const ang = Math.abs(Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1])) * 180 / Math.PI;
    expect(ang).toBeLessThan(0.01);
  });
  it('교차 폐형: 직선부 + 원호(원·선분 판별식) — chainage 정확', () => {
    const r = buildElements([[0, 0], [5000, 0], [5000, 5000]], [{ ip: 1, R: 1000 }], {});
    expect(intersectSegment(r.elements, [2000, -500], [2000, 500])).toMatchObject([{ sMm: 2000 }]);
    const ix = intersectSegment(r.elements, [3000, 900], [6000, 900]);
    expect(ix).toHaveLength(1);
    // 폐형: x=4000+√(R²−100²), 호상 각도 → s=BC+R·(90°−asin(100/R)... 수치 5470.7
    expect(Math.abs(ix[0].sMm - 5470.7)).toBeLessThan(0.5);
  });
  it('후속⑥ 클로소이드: Fresnel 폐형(A·L·TS/SC/CS/ST)·폐합 자기검증·τs 게이트·cw 대칭', () => {
    const r = buildElements([[0, 0], [10000, 0], [10000 + 10000 * Math.cos(Math.PI / 3), 10000 * Math.sin(Math.PI / 3)]], [{ ip: 1, R: 1000, Ls: 500 }], {});
    expect(r.ok).toBe(true);
    const ct = r.curveTable[0];
    expect(Math.round(ct.A)).toBe(707); // A=√(R·Ls)=√500000
    expect(Math.abs(ct.Lmm - (2 * 500 + 1000 * (Math.PI / 3 - 0.5)))).toBeLessThan(1); // 2Ls+R(Δ−2τs), 이산 길이오차<1mm
    expect(ct.SCmm - ct.TSmm).toBeCloseTo(500, -1);
    expect(ct.STmm - ct.CSmm).toBeCloseTo(500, -1);
    // 접선 이산각 ≤0.5°(명시 공차) — SC/CS 경계
    const ang = (a, b) => Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) * 180 / Math.PI;
    for (const sm of [ct.SCmm, ct.CSmm]) {
      const d1 = chainAt(r.elements, sm - 0.5).dir, d2 = chainAt(r.elements, sm + 0.5).dir;
      expect(ang(d1, d2)).toBeLessThan(0.5);
    }
    // cw 대칭
    const r2 = buildElements([[0, 0], [10000, 0], [10000 + 10000 * Math.cos(-Math.PI / 3), 10000 * Math.sin(-Math.PI / 3)]], [{ ip: 1, R: 1000, Ls: 500 }], {});
    expect(r2.ok).toBe(true);
    expect(Math.abs(r2.curveTable[0].Lmm - ct.Lmm)).toBeLessThan(0.5);
    // τs>30° 게이트
    expect(buildElements([[0, 0], [10000, 0], [10000, 10000]], [{ ip: 1, R: 500, Ls: 600 }], {}).ok).toBe(false);
    // 템플릿 E2E: 간섭 0
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { leg1: 60000, leg2: 60000, deflectionDeg: 45, curves: [{ ip: 1, R: 20000, Ls: 8000 }] });
    const built = buildAssembly(asm);
    expect(built.ok).toBe(true);
    expect(built.interferences).toEqual([]);
  });
  it('사전 게이트: TL 초과·교각>90° 정직 거부', () => {
    expect(buildElements([[0, 0], [1500, 0], [1500, 1500]], [{ ip: 1, R: 2000 }], {}).ok).toBe(false);
    expect(buildElements([[0, 0], [5000, 0], [1000, -100]], [{ ip: 1, R: 500 }], {}).ok).toBe(false); // 교각 > 90°
  });
  it('1단계 곡선 템플릿: R30m — TL·CL 폐형·OBB 전수 0·곡선표·진짜 원호·DXF ARC', () => {
    const c = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { curves: [{ ip: 1, R: 30000 }] });
    const ct = c.alignment.curveTable[0];
    expect(Math.round(ct.TLmm)).toBe(Math.round(30000 * Math.tan((15 * Math.PI) / 180)));
    expect(Math.abs(ct.Lmm - 30000 * (30 * Math.PI) / 180)).toBeLessThan(0.001);
    expect(Math.abs(ct.BCmm + ct.Lmm - ct.ECmm)).toBeLessThan(1e-6); // 원값 자기정합
    const built = buildAssembly(c);
    expect(built.ok).toBe(true);
    expect(built.interferences).toEqual([]); // 현 마이터 트림 → OBB 겹침 0
    const html = ga2dDrawing(c, { title: 'c', domain: 'civil' });
    expect(html).toMatch(/<path d="M [\d. ]+A /); // 평면=진짜 원호
    expect(html).toContain('곡선표');
  });
  it('3단계 지반선 파생: 교차 폐형·모순 거부·외삽 금지 (§1-3)', () => {
    const { elements } = buildElements([[0, 0], [100000, 0]], []);
    const g = groundFromContours(elements, [
      { elevM: 12, pts: [[20000, -5000], [20000, 5000]] },
      { elevM: 8, pts: [[70000, -5000], [70000, 5000]] },
    ]);
    expect(g.ground).toMatchObject([{ staMm: 20000, elevMm: 12000 }, { staMm: 70000, elevMm: 8000 }]);
    expect(g.note).toContain('외삽 없음');
    // 모순(같은 STA 상이 표고) = 평균 금지·거부
    const bad = groundFromContours(elements, [
      { elevM: 10, pts: [[50000, -1000], [50000, 1000]] },
      { elevM: 20, pts: [[50200, -1000], [50200, 1000]] },
    ]);
    expect(bad.ground).toBeNull();
    expect(bad.errors[0]).toContain('모순');
    // 교차 <2 = 미생성
    expect(groundFromContours(elements, [{ elevM: 10, pts: [[50000, -1000], [50000, 1000]] }]).ground).toBeNull();
  });
  it('4단계 토공·유토: 평균단면법 폐형 + mass_haul 연계 + 미입력 정직 생략 (§1-4)', () => {
    const contours = [
      { elevM: 12, pts: [[20000, -50000], [20000, 50000]] },
      { elevM: 10, pts: [[60000, -50000], [60000, 50000]] },
      { elevM: 8, pts: [[100000, -50000], [100000, 50000]] },
    ];
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { contours, earthwork: { formationElevM: 6, widthM: 3, slopeN: 1.5 } });
    const html = ga2dDrawing(asm, { title: 'e', domain: 'civil' });
    expect(html).toContain('토공량');
    expect(html).toContain('유토곡선');
    // 폐형 검증: 구간1(20~60m) A1=6·3+1.5·36=72, A2=4·3+1.5·16=36 → V=(72+36)/2·40=2160m³
    // 구간2(60~100m) A2=36, A3=2·3+1.5·4=12 → V=(36+12)/2·40=960 → 총 절토 3120
    expect(html).toContain('3120.0');
    const omitted = ga2dDrawing(buildAssemblyTemplate('civil', 'retaining_wall_alignment', { contours }), { title: 'e2', domain: 'civil' });
    expect(omitted).toContain('입력 필요 — earthwork');
  });
  it('정확도 감사 1: partCG 회전 반영 — rz90 벽·45° 세그먼트 폐형', () => {
    expect(partCG({ type: 'box', params: { width: 6000, depth: 150, height: 2700 }, at: { rz: 90 } }).map(Math.round)).toEqual([-75, 3000, 1350]);
    const c45 = partCG({ type: 'box', params: { width: 2000, depth: 100000, height: 400 }, at: { rz: -45 } });
    expect(Math.round(c45[0])).toBe(Math.round((1000 + 50000) * Math.SQRT1_2)); // R(−45)·(1000,50000)
    expect(Math.round(c45[1])).toBe(Math.round((50000 - 1000) * Math.SQRT1_2));
  });
  it('정확도 감사 2: cw(우향) 호 직격 교차 폐형 앵커 s5050/x5044', () => {
    const r = buildElements([[0, 0], [5000, 0], [5000 + 5000 * Math.cos(-Math.PI / 6), 5000 * Math.sin(-Math.PI / 6)]], [{ ip: 1, R: 1000 }], {});
    const ix = intersectSegment(r.elements, [4600, -50], [5400, -50]);
    expect(ix).toHaveLength(1);
    expect(Math.abs(ix[0].sMm - 5050)).toBeLessThan(2);
    expect(Math.abs(ix[0].x - 5044)).toBeLessThan(2);
  });
  it('정확도 감사 3: BOM 그룹 양자화 — 1.3km 선형 72부품이 소수 그룹으로', () => {
    const big = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips: [[0, 0], [500000, 0], [900000, 300000], [1200000, 300000]], curves: [{ ip: 1, R: 150000 }, { ip: 2, R: 100000 }] });
    const html = ga2dDrawing(big, { title: 't', domain: 'civil' });
    const rows = (html.match(/<tbody>(.*?)<\/tbody>/s)?.[1].match(/<tr>/g) ?? []).length;
    expect(rows).toBeLessThan(20); // 이전: 70행(그룹화 무력)
  });
  it('정확도 감사 4·5: 선형 구조=연속기초 정직 리포트 · 종단 기준면 이중 축 경고', () => {
    const contours = [{ elevM: 12, pts: [[20000, -50000], [20000, 50000]] }, { elevM: 8, pts: [[100000, -50000], [100000, 50000]] }];
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { contours });
    const st = structuralReport(asm, { title: 't' });
    expect(st).toContain('m당 자중');
    expect(st).toContain('4점 강체 반력·코너 전도 모델은 부적합');
    const ga = ga2dDrawing(asm, { title: 't', domain: 'civil' });
    expect(ga).toContain('기준면 불일치');
  });
  it('잔여① 옹벽 안정 시트: soil 미입력=정직 게이트 / 입력=XS 동일 단면 FS 자동(KDS 11 80 05)', () => {
    const base = { profileDesign: [{ staMm: 0, elevMm: 3000 }, { staMm: 110000, elevMm: 4500 }, { staMm: 220000, elevMm: 2500 }] };
    const noSoil = ga2dDrawing(buildAssemblyTemplate('civil', 'retaining_wall_alignment', base), { title: 't', domain: 'civil' });
    expect(noSoil).toContain('지반 정수 입력 필요');
    const withSoil = ga2dDrawing(buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ...base, soil: { gammaBackfill: 19, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 300 } }), { title: 't', domain: 'civil' });
    expect(withSoil).toContain('옹벽 안정 검토 (대표 3단면');
    expect(withSoil).toContain('전도 FS');
    // H=3m 단면 PASS · H=4.5m 단면은 B=2m 로 실제 미달 — FAIL 이 찍혀야 정직
    expect((withSoil.match(/>PASS<\/b>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(withSoil).toContain('FAIL');
  });
  it('잔여④ 배관 티 계상: 끝점이 타 라인 세그먼트 위 접속=티(이경=이경 티)', () => {
    const built = buildAssembly({
      name: 'tee', parts: [
        { id: 'a', type: 'box', params: { width: 400, depth: 400, height: 400 } },
        { id: 'b', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 1200 } },
        { id: 'c', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 500, ty: 1000 } },
      ],
      pipes: [
        { id: 'main', from: 'a.x+', to: 'b.x-', d: 50, service: 'feed' },
        { id: 'branch', from: 'c.y-', to: [800, 200, 200], d: 25, service: 'feed' }, // 본관 위 원시좌표 접속
      ],
    });
    expect(built.pipes.errors).toEqual([]);
    const b2 = computeBOQ({
      name: 'tee', parts: [
        { id: 'a', type: 'box', params: { width: 400, depth: 400, height: 400 } },
        { id: 'b', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 1200 } },
        { id: 'c', type: 'box', params: { width: 400, depth: 400, height: 400 }, at: { tx: 500, ty: 1000 } },
      ],
      pipes: [
        { id: 'main', from: 'a.x+', to: 'b.x-', d: 50, service: 'feed' },
        { id: 'branch', from: 'c.y-', to: [800, 200, 200], d: 25, service: 'feed' },
      ],
    });
    expect(b2.piping.tees).toBe(1);
    expect(b2.piping.reducingTees).toBe(1); // d50↔d25 이경
  });
  it('5단계 도면집: 시트 레지스트리·목록표·윈도 무결·REV — 역방향 게이트 all-ok (§2)', () => {
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {
      ips: [[0, 0], [500000, 0], [900000, 300000], [1200000, 300000]],
      curves: [{ ip: 1, R: 150000 }, { ip: 2, R: 100000 }],
      structures: [{ sta: 250000, type: 'culvert', params: { cover: 1.5, gammaSoil: 19, K: 0.5 } }],
    });
    const built = buildAssembly(asm);
    expect(built.interferences).toEqual([]);
    const html = ga2dDrawing(asm, { title: 'd', domain: 'civil' });
    const dwgs = [...html.matchAll(/data-dwg="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dwgs).size).toBe(dwgs.length); // 도번 유일
    expect(html).toContain('도면 목록표');
    expect(html).toContain('일반주기');
    expect(html).toContain('box_culvert_frame'); // 일람 체인
    expect(html).toContain('KDS'); // 일반주기 = 실행 계산기 refs 만
    const files = [{ name: 'GA_2D_drawing.html', content: packageStamp(html, { rev: 'r5test00', massKg: built.structural.totalMassKg, env: [1, 1, 1], parts: asm.parts.length }) }];
    const cons = packageConsistencyCheck(files, { rev: 'r5test00', massKg: 0, env: [0, 0, 0], parts: 0 }, { alignment: asm.alignment });
    for (const c of cons.checks.filter((q) => ['도번 유일성', '목록표 매수=실시트(GA 본시트 +1)', '상세 시트 윈도 무결(틈·겹침 0)', 'REV 스탬프 채움'].includes(q.metric))) {
      expect(c.pass).toBe(true);
    }
  });
  // §G 무작위 기하 감사 — 결정론 PRNG(시드 재현), 불변식: 게이트 통과·Σ요소장=총연장·
  // 접선 연속·곡선표 원값 자기정합 (100케이스) + 실빌드 OBB 간섭 0 (10케이스)
  it('무작위 선형 100케이스 기하 불변식 + 10케이스 실빌드 간섭 0', () => {
    let seed = 0x9e3779b9;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let k = 0; k < 100; k++) {
      const nIp = 3 + Math.floor(rnd() * 4);
      const ips = [[0, 0]];
      let brg = 0;
      for (let i = 1; i < nIp; i++) {
        if (i > 1) brg += (rnd() - 0.5) * (Math.PI / 1.6); // ±56°
        const leg = 30000 + rnd() * 170000;
        const [px, py] = ips[i - 1];
        ips.push([px + Math.cos(brg) * leg, py + Math.sin(brg) * leg]);
      }
      const curves = [];
      for (let i = 1; i < nIp - 1; i++) {
        if (rnd() < 0.6) {
          const legA = Math.hypot(ips[i][0] - ips[i - 1][0], ips[i][1] - ips[i - 1][1]);
          const legB = Math.hypot(ips[i + 1][0] - ips[i][0], ips[i + 1][1] - ips[i][1]);
          const b1 = Math.atan2(ips[i][1] - ips[i - 1][1], ips[i][0] - ips[i - 1][0]);
          const b2 = Math.atan2(ips[i + 1][1] - ips[i][1], ips[i + 1][0] - ips[i][0]);
          let d = Math.abs(b2 - b1); if (d > Math.PI) d = 2 * Math.PI - d;
          if (d < 0.02) continue;
          const R = Math.max(4000, (0.3 * Math.min(legA, legB)) / Math.tan(d / 2));
          curves.push({ ip: i, R });
        }
      }
      const r = buildElements(ips, curves, { minR: 4000, baseW: 2000 });
      if (!r.ok) continue; // 게이트 거부는 정당(무작위 조합) — 통과 케이스만 불변식 검사
      const sum = r.elements.reduce((s, e) => s + e.len, 0);
      expect(Math.abs(sum - r.totalMm)).toBeLessThan(1e-6);
      // 접선 연속은 호 경계(BC·EC)만 — 곡선 없는 IP 는 의도된 꺾임(불연속이 정상)
      for (const e of r.elements.filter((q) => q.type === 'arc')) {
        for (const j of [e.BCmm, e.ECmm]) {
          if (j <= 1e-6 || j >= r.totalMm - 1e-6) continue;
          const d1 = chainAt(r.elements, j - 0.001).dir, d2 = chainAt(r.elements, j + 0.001).dir;
          const ang = Math.abs(Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1])) * 180 / Math.PI;
          expect(ang).toBeLessThan(0.01);
        }
      }
      for (const ct of r.curveTable) expect(Math.abs(ct.BCmm + ct.Lmm - ct.ECmm)).toBeLessThan(1e-6);
      if (k < 10) {
        const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips, curves });
        if (asm.parts.length && asm.parts.length <= 600) {
          const built = buildAssembly(asm);
          expect(built.ok).toBe(true);
          expect(built.interferences).toEqual([]);
        }
      }
    }
  });
});

describe('대축척 도면 코어 — km급 토목·조경·건축 (260717)', () => {
  it('fmtLen 자동 단위: mm→m→km', () => {
    expect(fmtLen(6300)).toBe('6300');
    expect(fmtLen(85000)).toBe('85m');
    expect(fmtLen(1250000)).toBe('1.25km');
  });
  it('pickScale 표준 축척 자동 선정(A3 지면 기준)', () => {
    expect(pickScale(6300, 2800)).toBe(50);
    expect(pickScale(500000, 3000)).toBe(5000);
  });
  it('staLabel 0+000 형식', () => {
    expect(staLabel(50000)).toBe('0+050');
    expect(staLabel(1250000)).toBe('1+250');
  });
  it('옹벽 500m 연장: 게이트 통과 + GA에 SCALE·STA·자동 단위·선형 평면', () => {
    const run = buildAssemblyTemplate('civil', 'retaining_wall_run', { length: 500000 });
    const built = buildAssembly(run);
    expect(built.ok).toBe(true);
    expect(built.designOk).toBe(true);
    const html = ga2dDrawing(run, { title: 'run', domain: 'civil' });
    expect(html).toContain('SCALE 1:2500');
    expect(html).toContain('STA 0+050');
    expect(html).toContain('500m');
    expect(html).toContain('선형 평면도');
  });
  it('① 선형 어휘: IP 폴리라인 옹벽 — 회전 세그먼트 간섭 0·designOk·연장 정합', () => {
    const al = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {});
    const built = buildAssembly(al);
    expect(built.ok).toBe(true);
    expect(built.interferences).toEqual([]);
    expect(built.designOk).toBe(true);
    expect(Math.round(al.alignment.totalMm / 1000)).toBe(220); // leg1 120m + leg2 100m
    const html = ga2dDrawing(al, { title: 'a', domain: 'civil' });
    expect(html).toContain('선형 평면도');
    expect(html).toContain('IP1');
    expect(html).toContain('Δ=30.0°');
  });
  it('② 종단면도: 계획고(형상 파생 기본)+지반선 입력 원칙 명시', () => {
    const al = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {});
    const html = ga2dDrawing(al, { title: 'a', domain: 'civil' });
    expect(html).toContain('종단면도');
    expect(html).toContain('종 10× 왜곡');
    expect(html).toContain('지반선=입력 시 표기');
  });
  it('③ 시트 분할: 1.3km 선형 → 상세 시트+MATCH LINE STA', () => {
    const big = buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips: [[0, 0], [500000, 0], [900000, 300000], [1200000, 300000]] });
    expect(buildAssembly(big).designOk).toBe(true);
    const html = ga2dDrawing(big, { title: 'b', domain: 'civil' });
    expect(html).toMatch(/시트 1\/\d/);
    expect(html).toContain('MATCH LINE STA');
  });
  it('④ 부지 경계·등고: 입력 시만 부지 계획도(면적·EL 라벨)', () => {
    const site = buildAssemblyTemplate('landscape', 'timber_deck', {});
    const plain = ga2dDrawing(site, { title: 'd', domain: 'landscape' });
    expect(plain).not.toContain('부지 계획도'); // 미입력=미표기(지형 지어내지 않음)
    site.siteBoundary = [[-2000, -2000], [16000, -2000], [16000, 10000], [-2000, 10000]];
    site.contours = [{ elevM: 10, pts: [[-2000, 0], [16000, 2000]] }];
    const html = ga2dDrawing(site, { title: 'd', domain: 'landscape' });
    expect(html).toContain('부지 계획도');
    expect(html).toContain('대지경계선');
    expect(html).toContain('EL.10.0');
  });
  it('다부품(rc_frame 90부품) BOM 그룹화 — 수량 열·행 수 간축', () => {
    const rc = buildAssemblyTemplate('building', 'rc_frame', { floors: 3, baysX: 3, baysY: 2 });
    expect(rc.parts.length).toBeGreaterThan(40);
    const html = ga2dDrawing(rc, { title: 'rc', domain: 'building' });
    const rows = (html.match(/<tbody>(.*?)<\/tbody>/s)?.[1].match(/<tr>/g) ?? []).length;
    expect(rows).toBeLessThan(10);
    expect(html).toContain('수량');
  });
});

describe('잔여 제안 3건 — 통기 하한·구배 검증·관수 체인', () => {
  it('drainage_vent segment=vent: 신정통기 하한(1/2 초과·DN32↑) — DN100 스택 → DN65', () => {
    const r = runCalculator('drainage_vent', { segment: 'vent', ventKind: 'stack_vent', drainDN: 100, plannedDN: 65 });
    expect(r.checks.sizing.requiredDN).toBe(65);
    expect(r.verdict).toBe('PASS');
    // 표 4.3-1 매트릭스 보류를 정직 고지
    expect(r.notes.join(' ')).toContain('표 4.3-1');
  });
  it('drainage_vent vent(individual): 12 m 이상이면 한 단계 업(§4.3(2))', () => {
    const r = runCalculator('drainage_vent', { segment: 'vent', ventKind: 'individual', drainDN: 50, ventLen_m: 15, plannedDN: 32 });
    expect(r.checks.sizing.requiredDN).toBe(40); // 1/2 이상=DN32 → 12m 업 → DN40
    expect(r.verdict).toBe('FAIL');
  });
  it('mepDrainageCheck: 통기 PASS + 구배(표 4.1-1) 소요 낙차 산출·도식 무구배=CHECK', () => {
    const m = mepDrainageCheck(buildAssemblyTemplate('interior', 'studio_unit', {}));
    expect(m.vent).toMatchObject({ requiredDN: 65, plannedDN: 65, verdict: 'PASS' });
    const sl = m.lines.find((l) => l.line === 'drain_toilet')?.slope;
    expect(sl.requiredDropMm).toBeGreaterThan(0);
    expect(['PASS', 'CHECK']).toContain(sl.verdict);
  });
  it('파고라 관수 체인: 유량 미입력=정직 INPUT_GATE, 입력 시 pump_head 전양정·동력', () => {
    const pg = buildAssemblyTemplate('landscape', 'pergola', {});
    const built = buildAssembly(pg);
    expect(built.pipes.errors).toEqual([]);
    expect(built.designOk).toBe(true);
    const gate = landscapeCheck(pg, {});
    expect(gate.irrigation.needInputs).toBeTruthy();
    expect(gate.irrigation.derived.staticHead_m).toBeGreaterThan(2);
    const run = landscapeCheck(pg, { irrigationQ_Lmin: 30, pumpEfficiency: 0.6 });
    expect(run.irrigation.head.total_m).toBeGreaterThan(run.irrigation.head.static_m);
    expect(run.irrigation.power.shaftPower_kW).toBeGreaterThan(0);
  });
});

describe('인테리어 MEP — 기계 배관 어휘의 도메인 적용(욕실·주방 급배수)', () => {
  for (const t of ['studio_unit', 'apartment_unit', 'three_room_unit']) {
    it(`${t}: 전 라인 라우팅 완주 · 위반 0 · designOk`, () => {
      const built = buildAssembly(buildAssemblyTemplate('interior', t, {}));
      expect(built.ok).toBe(true);
      expect(built.pipes.errors).toEqual([]);
      expect(built.pipes.obstacleViolations).toEqual([]);
      expect(built.pipes.crossViolations).toEqual([]);
      expect(built.pipes.routes.length).toBeGreaterThanOrEqual(4);
      expect(built.designOk).toBe(true);
      // 계통색: 배수(#92400e)·급수(#0284c7) 피처가 GA 3D intent 에 포함
      const cols = new Set(built.composeIntent.features.map((f) => f._col));
      expect(cols.has('#92400e')).toBe(true);
      expect(cols.has('#0284c7')).toBe(true);
    });
  }
});
