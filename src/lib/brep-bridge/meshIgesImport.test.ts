/**
 * meshIgesImport 폐형 테스트(W5-G, 260721) — 충실도 플래그 고정 + 수치 검증.
 *  - IGES: 좌표 AABB box 근사 → fidelity='aabb-approximation' 이 기계 판독 가능해야 한다.
 *  - STL: 메시 실체적(발산정리) → 워터타이트=mesh-exact / 열린 메시=mesh-open-approximation.
 */
import { describe, it, expect } from 'vitest';
import { igesToNexyfabAssembly, stlToNexyfabAssembly } from './meshIgesImport';

// ── IGES 80-col 픽스처 빌더(116 POINT) ──
function igesLine(data: string, sec: string, seq: number): string {
  return data.padEnd(64, ' ') + ''.padEnd(8, ' ') + sec + String(seq).padStart(7, ' ');
}
function igesPLine(data: string, de: number, seq: number): string {
  return data.padEnd(64, ' ') + String(de).padStart(8, ' ') + 'P' + String(seq).padStart(7, ' ');
}
function igesDPair(type: number, seq: number): string[] {
  const f = (v: number) => String(v).padStart(8, ' ');
  const l1 = f(type) + f(seq) + f(0) + f(0) + f(0) + f(0) + f(0) + f(0) + f(0) + 'D' + String(seq).padStart(7, ' ');
  const l2 = f(type) + f(0) + f(0) + f(1) + f(0) + ''.padEnd(32, ' ') + 'D' + String(seq + 1).padStart(7, ' ');
  return [l1, l2];
}
function igesOfPoints(pts: Array<[number, number, number]>): string {
  const dSec = pts.flatMap((_, i) => igesDPair(116, i * 2 + 1));
  const pSec = pts.map((p, i) => igesPLine(`116,${p[0]}.,${p[1]}.,${p[2]}.;`, i * 2 + 1, i + 1));
  return [igesLine('w5g fixture', 'S', 1), igesLine('1H,,1H;', 'G', 1), ...dSec, ...pSec, igesLine(`S1G1D${dSec.length}P${pSec.length}`, 'T', 1)].join('\n');
}

describe('igesToNexyfabAssembly — AABB 근사 명시 플래그', () => {
  it('POINT 4점(20×30×40 대각) → box 근사 + fidelity=aabb-approximation 고정', () => {
    const r = igesToNexyfabAssembly(igesOfPoints([[0, 0, 0], [20, 30, 40], [20, 0, 0], [0, 30, 40]]), { name: 'igesBox' });
    expect(r.ok).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(20, 6);
    expect(p.params.depth).toBeCloseTo(30, 6);
    expect(p.params.height).toBeCloseTo(40, 6);
    expect(r.assembly!.importedApprox).toBe(true);
    expect(r.assembly!.fidelity).toBe('aabb-approximation'); // 기계 판독 — 조용한 박스 근사 금지
    expect(p.fidelity).toBe('aabb-approximation');
    expect(r.assembly!.note).toContain('원기하 아님');
    expect(r.stats!.points).toBe(4);
  });
});

// ── STL ascii 사면체(0,0,0)(10,0,0)(0,10,0)(0,0,10): V=1000/6, A=150+50√3 ──
function stlTetra(dropLast = false): Buffer {
  const v: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
  const tris: number[][] = dropLast ? [[0, 2, 1], [0, 1, 3], [0, 3, 2]] : [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const body = tris.map((t) => [
    ' facet normal 0 0 0', '  outer loop',
    ...t.map((i) => `   vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}`),
    '  endloop', ' endfacet',
  ].join('\n')).join('\n');
  return Buffer.from(`solid tetra\n${body}\nendsolid tetra\n`, 'latin1');
}

describe('stlToNexyfabAssembly — 메시 실체적 충실도', () => {
  it('워터타이트 사면체 → fidelity=mesh-exact · 부피 1000/6 · 표면적 150+50√3', () => {
    const r = stlToNexyfabAssembly(stlTetra(), { name: 'tetra' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('mesh-exact');
    expect(r.assembly!.parts[0].fidelity).toBe('mesh-exact');
    const prm = r.assembly!.parts[0].params as unknown as { volumeMm3: number; areaMm2: number };
    expect(prm.volumeMm3).toBeCloseTo(1000 / 6, 2); // 방출 반올림 2자리
    expect(prm.areaMm2).toBeCloseTo(150 + 50 * Math.sqrt(3), 2);
  });

  it('페이스 결손(열린 메시) → fidelity=mesh-open-approximation 명시', () => {
    // 4면 유지 조건(파서 최소 4tris)을 지키며 한 면을 중복으로 대체해 열린 엣지 유발
    const v: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
    const tris = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [0, 3, 2]];
    const body = tris.map((t) => [
      ' facet normal 0 0 0', '  outer loop',
      ...t.map((i) => `   vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}`),
      '  endloop', ' endfacet',
    ].join('\n')).join('\n');
    const r = stlToNexyfabAssembly(Buffer.from(`solid t\n${body}\nendsolid t\n`, 'latin1'), { name: 'open' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('mesh-open-approximation');
    expect(r.assembly!.note).toContain('열린 메시');
  });
});
