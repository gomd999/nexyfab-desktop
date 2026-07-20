/**
 * satExport 라운드트립 검증 (W5-H, 260721).
 *
 * 결정적 판정 = 본 익스포트 출력 → 기존 satImport(실 B-rep 평면 다면체 재구성, W5-G)
 * 재임포트 → 정점집합·부피·표면적·CG 1e-6 일치. 기대값은 전부 해석적 리터럴
 * (박스 20×30×40=24000 · L-프리즘 (60·20+20·20)·20=32000 ≠ AABB 48000).
 */
import { describe, it, expect } from 'vitest';
import { weldTriangleSoup, validateClosedPolyMesh, writeSatText, type PolyMesh } from './satExport';
import { parseSatBodies, satToNexyfabAssembly } from './satImport';

type V3 = [number, number, number];

// ── 픽스처(리터럴 정의 — 기대값의 근거) ──
const BOX_VERTS: V3[] = [
  [0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0],
  [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40],
];
// 외향 일관(부호부피 +24000·6)
const BOX_FACES = [
  [0, 3, 2, 1], [4, 5, 6, 7],
  [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
];
const BOX: PolyMesh = { verts: BOX_VERTS, faces: BOX_FACES };

// L-프리즘: 풋프린트 (0,0)(60,0)(60,20)(20,20)(20,40)(0,40)·높이 20 — 비볼록 페이스 포함
const LP: Array<[number, number]> = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 40], [0, 40]];
const L_VERTS: V3[] = [...LP.map(([x, y]) => [x, y, 0] as V3), ...LP.map(([x, y]) => [x, y, 20] as V3)];
const L_FACES = [
  [5, 4, 3, 2, 1, 0], [6, 7, 8, 9, 10, 11],
  ...LP.map((_, i) => { const j = (i + 1) % 6; return [i, j, j + 6, i + 6]; }),
];
const LPRISM: PolyMesh = { verts: L_VERTS, faces: L_FACES };

function expectVertSetEqual(got: Array<[number, number, number]>, want: V3[], tol = 1e-6) {
  expect(got).toHaveLength(want.length);
  for (const w of want) {
    const hit = got.some((g) => Math.abs(g[0] - w[0]) <= tol && Math.abs(g[1] - w[1]) <= tol && Math.abs(g[2] - w[2]) <= tol);
    expect(hit, `소스 정점 ${w} 이(가) 재임포트 결과에 없음`).toBe(true);
  }
}

describe('writeSatText → satImport 라운드트립 (결정적 검증)', () => {
  it('박스 20×30×40 — 정점·부피 24000·표면적 5200·CG(10,15,20) 1e-6 일치', () => {
    const w = writeSatText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.stats.bodies).toBe(1);
    expect(Math.abs(w.stats.volume - 24000)).toBeLessThan(1e-6);
    const r = parseSatBodies(w.text);
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly, `재구성 실패 사유: ${r.bodies?.[0]?.fallbackReason}`).toBeTruthy();
    expectVertSetEqual(poly.verts, BOX_VERTS);
    expect(poly.faces).toHaveLength(6);
    expect(Math.abs(poly.volume - 24000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.area - 5200)).toBeLessThan(1e-6); // 2(600+1200+800)
    expect(Math.abs(poly.cg[0] - 10)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[1] - 15)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[2] - 20)).toBeLessThan(1e-6);
  });

  it('L-프리즘(비볼록) — 부피 32000(AABB 48000 아님)·CG(25,15,10) 1e-6 일치', () => {
    const w = writeSatText(LPRISM);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = parseSatBodies(w.text);
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly, `재구성 실패 사유: ${r.bodies?.[0]?.fallbackReason}`).toBeTruthy();
    expectVertSetEqual(poly.verts, L_VERTS);
    expect(poly.faces).toHaveLength(8);
    expect(Math.abs(poly.volume - 32000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.area - 7200)).toBeLessThan(1e-6); // 2·1600 + 둘레200·20
    expect(Math.abs(poly.cg[0] - 25)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[1] - 15)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[2] - 10)).toBeLessThan(1e-6);
    // AABB 근사가 아니라는 판정: 다면체 부피 < AABB 부피
    const a = r.bodies![0].aabb!;
    expect((a.max[0] - a.min[0]) * (a.max[1] - a.min[1]) * (a.max[2] - a.min[2])).toBeCloseTo(48000, 6);
  });

  it('전체 체인 satToNexyfabAssembly — fidelity=brep-polyhedron(근사 아님)', () => {
    const w = writeSatText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = satToNexyfabAssembly(w.text, { name: 'rt-box' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('brep-polyhedron');
    expect(r.assembly!.importedApprox).toBeUndefined();
    const prm = r.assembly!.parts[0].params as unknown as { volumeMm3: number };
    expect(prm.volumeMm3).toBeCloseTo(24000, 5);
  });

  it('단위 unitMm=25.4 — 임포터가 inch→mm 환산해 부피 24000·25.4³', () => {
    const w = writeSatText(BOX, { unitMm: 25.4 });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const p = parseSatBodies(w.text);
    expect(p.unitMm).toBe(25.4);
    const r = satToNexyfabAssembly(w.text, { name: 'rt-inch' });
    expect(r.ok).toBe(true);
    const prm = r.assembly!.parts[0].params as unknown as { volumeMm3: number };
    expect(prm.volumeMm3).toBeCloseTo(24000 * 25.4 ** 3, 2);
  });

  it('분리 2바디(박스 2개) — body 2개·각각 다면체 재구성', () => {
    const verts: V3[] = [...BOX_VERTS, ...BOX_VERTS.map(([x, y, z]) => [x + 100, y, z] as V3)];
    const faces = [...BOX_FACES, ...BOX_FACES.map((f) => f.map((v) => v + 8))];
    const w = writeSatText({ verts, faces });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.stats.bodies).toBe(2);
    const r = parseSatBodies(w.text);
    expect(r.ok).toBe(true);
    expect(r.bodies).toHaveLength(2);
    for (const b of r.bodies!) {
      expect(b.poly, `재구성 실패: ${b.fallbackReason}`).toBeTruthy();
      expect(Math.abs(b.poly!.volume - 24000)).toBeLessThan(1e-6);
    }
    // 두 번째 바디의 정점은 +100 이동본
    const allX = r.bodies!.flatMap((b) => b.poly!.verts.map((v) => v[0]));
    expect(Math.max(...allX)).toBeCloseTo(120, 9);
  });

  it('내향 일관 방향 입력(전 페이스 반전)도 외향 정규화 후 동일 부피', () => {
    const w = writeSatText({ verts: BOX_VERTS, faces: BOX_FACES.map((f) => [...f].reverse()) });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = parseSatBodies(w.text);
    expect(Math.abs(r.bodies![0].poly!.volume - 24000)).toBeLessThan(1e-6);
  });
});

describe('weldTriangleSoup → 라운드트립 (삼각 수프 경로)', () => {
  it('박스 삼각 수프(12tri·36정점) → 융합 8정점 → SAT → 부피 24000 1e-6', () => {
    const positions: number[] = [];
    for (const f of BOX_FACES) {
      // 팬 삼각화(사각→삼각 2)
      for (let k = 1; k + 1 < f.length; k++) {
        for (const vi of [f[0], f[k], f[k + 1]]) positions.push(...BOX_VERTS[vi]);
      }
    }
    const { mesh, droppedDegenerate } = weldTriangleSoup(positions);
    expect(droppedDegenerate).toBe(0);
    expect(mesh.verts).toHaveLength(8);
    expect(mesh.faces).toHaveLength(12);
    const w = writeSatText(mesh);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = parseSatBodies(w.text);
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly, `재구성 실패: ${r.bodies?.[0]?.fallbackReason}`).toBeTruthy();
    expectVertSetEqual(poly.verts, BOX_VERTS);
    expect(Math.abs(poly.volume - 24000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[0] - 10)).toBeLessThan(1e-6);
  });
});

describe('정직 거부(날조 금지) — 근사 방출 없이 사유와 함께 실패', () => {
  it('개방 메시(페이스 1개 제거) → ok:false + 개방 엣지 사유', () => {
    const w = writeSatText({ verts: BOX_VERTS, faces: BOX_FACES.slice(0, 5) });
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.error).toContain('개방 엣지');
  });

  it('비평면 페이스(정점 오염) → ok:false + 비평면 사유', () => {
    const bad = BOX_VERTS.map((v) => [...v] as V3);
    bad[6] = [20, 30, 45]; // 사각 페이스 3개가 비평면화
    const w = writeSatText({ verts: bad, faces: BOX_FACES });
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.error).toContain('비평면');
  });

  it('방향 비일관(한 페이스만 반전=유향 엣지 중복) → ok:false', () => {
    const faces = BOX_FACES.map((f, i) => (i === 0 ? [...f].reverse() : f));
    const w = writeSatText({ verts: BOX_VERTS, faces });
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.error).toContain('유향 엣지');
  });

  it('validateClosedPolyMesh — 퇴화 페이스(면적 0) 거부', () => {
    const v = validateClosedPolyMesh({ verts: BOX_VERTS, faces: [[0, 1, 1], ...BOX_FACES.slice(1)] });
    expect('error' in v).toBe(true);
  });
});
