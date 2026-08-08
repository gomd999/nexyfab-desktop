/**
 * N1 — 계층 어셈블리 IR 전개기: 동형성(패턴 곱=전개 수), 변환 합성 정확성
 * (yaw 합성=레거시 단일 배치와 좌표 동일), 레거시 소비자 호환(buildAssembly
 * 직접 소비), fail-closed 거부(순환·rx/ry 인스턴스 회전·미정의 ref·상한).
 */
import { describe, expect, it } from 'vitest';
import { expandHierarchy, gateHierarchy, hierarchyCounts } from './hierarchy-ir.mjs';
import { buildAssembly, placedAabb } from './assembly.mjs';

const box = (id: string, w: number, d: number, h: number, at: Record<string, number> = {}, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at, material: 'steel', role: 'frame', ...extra });

/** 미니 타워: 코어(1) + 기준층(슬래브+기둥 2×2 그리드) ×5층 */
function miniTower() {
  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: 'mini_tower', domain: 'building', kind: 'tower',
    definitions: [
      { defId: 'column', system: 'structure', parts: [box('col', 400, 400, 3000)] },
      {
        defId: 'typical_floor', system: 'structure',
        parts: [box('slab', 8000, 8000, 200, { tz: 3000 })],
        children: [
          { ref: 'column', id: 'cols', pattern: { kind: 'grid', nx: 2, ny: 2, dx: 7600, dy: 7600 } },
        ],
      },
    ],
    root: [
      { ref: 'typical_floor', id: 'floor', pattern: { kind: 'linear', count: 5, dz: 3200 } },
    ],
  };
}

describe('hierarchy IR — isomorphism & expansion', () => {
  it('expands the mini tower: 5 floors x (1 slab + 4 columns) = 25 parts', () => {
    const r = expandHierarchy(miniTower());
    expect(r.ok).toBe(true);
    expect(r.parts).toHaveLength(25);
    expect(r.hierarchy!.counts).toEqual({ typical_floor: 5, column: 20 });
    // 패턴 곱 = hierarchyCounts = 실제 전개 수 (동형성)
    const counts = hierarchyCounts(miniTower());
    const columns = r.parts!.filter(p => p._occ.leaf === 'col');
    expect(columns).toHaveLength(counts.get('column')!);
    // 층 인스턴싱: 3층 슬래브 z = 3000(로컬) + 2*3200
    const slab2 = r.parts!.find(p => p.id === 'floor[2]/slab')!;
    expect(slab2.at.tz).toBe(3000 + 2 * 3200);
    // 발생 경로가 고유하다
    expect(new Set(r.parts!.map(p => p.id)).size).toBe(25);
    // system 태그가 정의에서 전파된다
    expect(slab2.system).toBe('structure');
  });

  it('yaw composition equals a manually-placed legacy part (placedAabb identical)', () => {
    const ir = {
      schema: 'nexyfab.assembly-hierarchy.v1', name: 'yaw', domain: 'mech',
      definitions: [{ defId: 'arm', parts: [box('bar', 1000, 100, 50, { tx: 200, ty: 30, rz: 15 })] }],
      root: [{ ref: 'arm', id: 'a', at: { tx: 500, ty: -200, tz: 40, rz: 30 } }],
    };
    const r = expandHierarchy(ir);
    expect(r.ok).toBe(true);
    const got = r.parts![0];
    // 수동 합성: 위치 = T_i + Rz(30°)·[200,30,0], yaw = 30+15
    const th = (30 * Math.PI) / 180;
    const ex = 500 + 200 * Math.cos(th) - 30 * Math.sin(th);
    const ey = -200 + 200 * Math.sin(th) + 30 * Math.cos(th);
    expect(got.at.tx).toBeCloseTo(ex, 9);
    expect(got.at.ty).toBeCloseTo(ey, 9);
    expect(got.at.tz).toBe(40);
    expect(got.at.rz).toBeCloseTo(45, 9);
    const manual = { ...box('bar', 1000, 100, 50), at: { tx: ex, ty: ey, tz: 40, rz: 45 } };
    expect(placedAabb(got as never)).toEqual(placedAabb(manual as never));
  });

  it('circular pattern places instances on the yaw circle', () => {
    const ir = {
      schema: 'nexyfab.assembly-hierarchy.v1', name: 'circ', domain: 'mech',
      definitions: [{ defId: 'leg', parts: [box('leg', 100, 100, 500)] }],
      root: [{ ref: 'leg', id: 'legs', at: { tx: 1000, ty: 0 }, pattern: { kind: 'circular', count: 4, cx: 0, cy: 0 } }],
    };
    const r = expandHierarchy(ir);
    expect(r.ok).toBe(true);
    expect(r.parts).toHaveLength(4);
    const p1 = r.parts!.find(p => p.id.includes('[1]'))!;
    expect(p1.at.tx).toBeCloseTo(0, 6);
    expect(p1.at.ty).toBeCloseTo(1000, 6);
    expect(p1.at.rz).toBeCloseTo(90, 6);
  });

  it('legacy consumer compatibility: buildAssembly consumes the expansion directly', () => {
    const r = expandHierarchy(miniTower());
    const built = buildAssembly({ name: r.name, domain: r.domain, parts: r.parts });
    expect(built.ok).toBe(true);
    // 기둥은 슬래브 아래 배치라 층 내 간섭 0이어야 한다
    expect((built.interferences ?? []).length).toBe(0);
  });
});

describe('hierarchy IR — fail-closed refusals', () => {
  it('rejects cycles, unknown refs, and rx/ry instance rotation', () => {
    const cyc = {
      schema: 'nexyfab.assembly-hierarchy.v1', name: 'c', domain: 'mech',
      definitions: [
        { defId: 'a', children: [{ ref: 'b', id: 'b' }] },
        { defId: 'b', children: [{ ref: 'a', id: 'a' }] },
      ],
      root: [{ ref: 'a', id: 'r' }],
    };
    expect(gateHierarchy(cyc).some(e => e.includes('순환'))).toBe(true);
    expect(gateHierarchy({ ...cyc, root: [{ ref: 'nope', id: 'x' }] }).some(e => e.includes('미정의'))).toBe(true);
    const tilted = {
      schema: 'nexyfab.assembly-hierarchy.v1', name: 't', domain: 'mech',
      definitions: [{ defId: 'a', parts: [box('p', 1, 1, 1)] }],
      root: [{ ref: 'a', id: 'x', at: { rx: 10 } }],
    };
    expect(gateHierarchy(tilted).some(e => e.includes('yaw'))).toBe(true);
    expect(expandHierarchy(tilted).ok).toBe(false);
  });

  it('honest refusal at the part-count cap', () => {
    const big = {
      schema: 'nexyfab.assembly-hierarchy.v1', name: 'big', domain: 'mech',
      definitions: [{ defId: 'a', parts: [box('p', 1, 1, 1)] }],
      root: [{ ref: 'a', id: 'x', pattern: { kind: 'grid', nx: 100, ny: 100, dx: 2, dy: 2 } }],
    };
    const r = expandHierarchy(big, { maxParts: 5000 });
    expect(r.ok).toBe(false);
    expect(r.gateErrors!.join(' ')).toContain('상한');
  });
});
