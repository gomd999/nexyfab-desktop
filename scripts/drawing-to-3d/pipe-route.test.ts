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
import { ga2dDrawing, fmtLen, pickScale, staLabel } from './package.mjs';

import { obbOverlap, boxPartsInterference } from './obb2d.mjs';
import { buildElements, chainAt, intersectSegment } from './alignment-geom.mjs';

describe('무결성 규약 0단계 — OBB-SAT·chainage 요소열 (폐형 앵커)', () => {
  it('SAT: 분리·정확 접촉 0·관통 깊이·회전쌍', () => {
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [200, 0], h: [50, 50], deg: 45 }).overlap).toBe(false);
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [100, 0], h: [50, 50], deg: 0 }).overlap).toBe(false); // 정확 접촉=간섭 아님
    expect(obbOverlap({ c: [0, 0], h: [50, 50], deg: 0 }, { c: [60, 0], h: [50, 50], deg: 0 })).toMatchObject({ overlap: true, depthMm: 40 });
    expect(obbOverlap({ c: [0, 0], h: [100, 10], deg: 0 }, { c: [0, 50], h: [100, 10], deg: 45 }).overlap).toBe(true);
  });
  it('boxPartsInterference: 회전 box 쌍 실풋프린트 — AABB 과탐 제거', () => {
    // 45° 회전한 긴 벽 두 개 — AABB는 크게 겹치지만 실풋프린트는 분리
    const a = { type: 'box', params: { width: 100, depth: 4000, height: 500 }, at: { tx: 0, ty: 0, rz: 45 } };
    const b = { type: 'box', params: { width: 100, depth: 4000, height: 500 }, at: { tx: 400, ty: -400, rz: 45 } };
    expect(boxPartsInterference(a, b)).toMatchObject({ overlap: false });
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
  it('사전 게이트: TL 초과·교각>90° 정직 거부', () => {
    expect(buildElements([[0, 0], [1500, 0], [1500, 1500]], [{ ip: 1, R: 2000 }], {}).ok).toBe(false);
    expect(buildElements([[0, 0], [5000, 0], [1000, -100]], [{ ip: 1, R: 500 }], {}).ok).toBe(false); // 교각 > 90°
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
