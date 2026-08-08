/**
 * OBB 3D SAT (C-L3 선행) — 회전 규약 일치(placedCorners 동일 수학), 피치 장부재
 * AABB 과탐 제거, buildAssembly 통합(진짜 관통은 잡고 가짜는 통과).
 */
import { describe, expect, it } from 'vitest';
import { obbFromPart, obbOverlap, rotationMatrix } from './obb.mjs';
import { placedCorners, buildAssembly } from './assembly.mjs';
import { partAabb } from './reconstruct.mjs';

const boxPart = (id: string, w: number, d: number, h: number, at: Record<string, number>) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at });

describe('OBB 3D SAT', () => {
  it('rotation matrix matches the house placedCorners convention (X→Y→Z world axes)', () => {
    const part = boxPart('p', 100, 40, 20, { tx: 7, ty: -3, tz: 11, rx: 20, ry: -35, rz: 50 });
    const corners = placedCorners(part as never);
    const obb = obbFromPart(partAabb({ type: 'box', width: 100, depth: 40, height: 20 }), part.at) as unknown as { c: number[]; e: number[]; R: number[][] };
    // OBB 중심 = 코너 평균, 각 코너는 중심 ± R·(±e) 여야 한다
    const mean = corners.reduce((acc: number[], c: number[]) => [acc[0]! + c[0]! / 8, acc[1]! + c[1]! / 8, acc[2]! + c[2]! / 8], [0, 0, 0]);
    expect(mean[0]).toBeCloseTo(obb.c[0], 6);
    expect(mean[1]).toBeCloseTo(obb.c[1], 6);
    expect(mean[2]).toBeCloseTo(obb.c[2], 6);
    // 임의 코너 하나가 OBB 정점 집합에 존재
    const verts: number[][] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      verts.push([0, 1, 2].map(r => obb.c[r]! + obb.R[r]![0]! * obb.e[0]! * sx + obb.R[r]![1]! * obb.e[1]! * sy + obb.R[r]![2]! * obb.e[2]! * sz));
    }
    for (const corner of corners) {
      expect(verts.some(vv => Math.hypot(vv[0]! - corner[0]!, vv[1]! - corner[1]!, vv[2]! - corner[2]!) < 1e-6)).toBe(true);
    }
  });

  it('pitched 30m girder over a bearing: world-AABB overlaps, OBB separates', () => {
    // 3% 경사 거더(ry≈-1.72°): x 0..30000, 시점 z=1000 에서 상승. 월드 AABB 는
    // z 1000..~1900+girderH 쐐기 전체를 덮어 x=25000 의 z=1500 베어링과 "겹침".
    const slopeDeg = Math.atan(0.03) * 180 / Math.PI;
    const girder = boxPart('g', 30000, 700, 1800, { tx: 0, ty: 0, tz: 1000, ry: -slopeDeg });
    const bearing = boxPart('b', 500, 500, 200, { tx: 25000, ty: 100, tz: 1450 });
    const A = obbFromPart(partAabb({ type: 'box', width: 30000, depth: 700, height: 1800 }), girder.at);
    const B = obbFromPart(partAabb({ type: 'box', width: 500, depth: 500, height: 200 }), bearing.at);
    // 거더 하면 z @x=25000 ≈ 1000 + 25000·0.03 = 1750 > 베어링 상면 1650 → 실분리
    expect(obbOverlap(A, B).overlap).toBe(false);
    // 반면 월드 AABB(placedCorners min/max)는 겹친다 — 과탐이 실재함을 증명
    const gc = placedCorners(girder as never);
    const gminZ = Math.min(...gc.map((c: number[]) => c[2]!));
    expect(gminZ).toBeLessThan(1650); // AABB 하면이 베어링 상면 아래
  });

  it('genuine penetration is still detected with SAT depth', () => {
    const slopeDeg = Math.atan(0.03) * 180 / Math.PI;
    const A = obbFromPart(partAabb({ type: 'box', width: 30000, depth: 700, height: 1800 }), { tx: 0, ty: 0, tz: 1000, ry: -slopeDeg });
    // 베어링을 거더 하면 경로 안으로 300mm 침투시킨다: 하면 z@25000≈1750 → top 2050
    const B = obbFromPart(partAabb({ type: 'box', width: 500, depth: 500, height: 200 }), { tx: 25000, ty: 100, tz: 1850 });
    const r = obbOverlap(A, B);
    expect(r.overlap).toBe(true);
    expect(r.depth).toBeGreaterThan(50);
    expect(r.depth).toBeLessThan(400);
  });

  it('buildAssembly: pitched non-box member (i_girder) no longer false-flags', () => {
    const slopeDeg = Math.atan(0.03) * 180 / Math.PI;
    const parts = [
      { id: 'g', type: 'i_girder', params: { length: 30000, topW: 600, botW: 700, topT: 80, botT: 80, webH: 1640, webT: 20 }, at: { tz: 1000, ry: -slopeDeg }, material: 'steel', role: 'girder' },
      { id: 'b', type: 'box', params: { width: 500, depth: 500, height: 200 }, at: { tx: 25000, ty: 100, tz: 1450 }, material: 'steel', role: 'bearing' },
    ];
    const r = buildAssembly({ name: 'graded', domain: 'bridge', parts });
    expect(r.ok).toBe(true);
    expect((r.interferences ?? []).length).toBe(0);
  });
});
