/**
 * igesExport 검증 (W5-H, 260721).
 *
 * 정직 범위: 폴리라인 와이어프레임(106 form 12) — B-Rep 아님(파일 S섹션에도 선언).
 * 결정적 검증 2단:
 *  1) 자기 임포터(meshIgesImport.igesToNexyfabAssembly) 라운드트립 — AABB·점수 일치.
 *  2) 테스트 로컬 80컬럼 파서로 P섹션 좌표 전수 재파싱 — 소스 정점 좌표 전수 일치.
 */
import { describe, it, expect } from 'vitest';
import { writeIgesText } from './igesExport';
import { igesToNexyfabAssembly } from './meshIgesImport';
import type { PolyMesh } from './satExport';

type V3 = [number, number, number];

const BOX_VERTS: V3[] = [
  [0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0],
  [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40],
];
const BOX_FACES = [
  [0, 3, 2, 1], [4, 5, 6, 7],
  [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
];
const BOX: PolyMesh = { verts: BOX_VERTS, faces: BOX_FACES };

const LP: Array<[number, number]> = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 40], [0, 40]];
const L_VERTS: V3[] = [...LP.map(([x, y]) => [x, y, 0] as V3), ...LP.map(([x, y]) => [x, y, 20] as V3)];
const L_FACES = [
  [5, 4, 3, 2, 1, 0], [6, 7, 8, 9, 10, 11],
  ...LP.map((_, i) => { const j = (i + 1) % 6; return [i, j, j + 6, i + 6]; }),
];

/** 테스트 로컬 IGES P섹션 파서(임포터와 독립 구현) — DE별 좌표 튜플 복원 */
function parsePSectionTuples(text: string): number[][][] {
  const byDe = new Map<number, string>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length < 73 || raw[72] !== 'P') continue;
    const de = parseInt(raw.slice(64, 72), 10);
    byDe.set(de, (byDe.get(de) ?? '') + raw.slice(0, 64));
  }
  const out: number[][][] = [];
  for (const s of [...byDe.keys()].sort((a, b) => a - b).map((k) => byDe.get(k)!)) {
    const nums = s.split(/[,;]/).map((t) => parseFloat(t)).filter((v) => Number.isFinite(v));
    // [106, IP, N, x1,y1,z1, ...]
    expect(nums[0]).toBe(106);
    expect(nums[1]).toBe(2);
    const n = nums[2];
    const tuples: number[][] = [];
    for (let k = 0; k < n; k++) tuples.push([nums[3 + k * 3], nums[4 + k * 3], nums[5 + k * 3]]);
    expect(tuples).toHaveLength(n);
    out.push(tuples);
  }
  return out;
}

describe('writeIgesText — 구조·정직 선언', () => {
  it('전 행 80컬럼·섹션 문자 S/G/D/P/T·T 카운트 정합', () => {
    const w = writeIgesText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const lines = w.text.split('\n').filter((l) => l.length > 0);
    const counts: Record<string, number> = {};
    for (const ln of lines) {
      expect(ln).toHaveLength(80);
      const sec = ln[72];
      expect('SGDPT').toContain(sec);
      counts[sec] = (counts[sec] ?? 0) + 1;
    }
    const t = lines[lines.length - 1];
    expect(t[72]).toBe('T');
    expect(parseInt(t.slice(1, 8), 10)).toBe(counts.S);
    expect(parseInt(t.slice(9, 16), 10)).toBe(counts.G);
    expect(parseInt(t.slice(17, 24), 10)).toBe(counts.D);
    expect(parseInt(t.slice(25, 32), 10)).toBe(counts.P);
    // D 섹션 = 엔티티당 2행 = 페이스 6개 → 12행
    expect(counts.D).toBe(12);
  });

  it('S섹션에 폴리라인/비-B-Rep 정직 선언·서피스 엔티티(114/128/144) 미방출', () => {
    const w = writeIgesText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.text).toContain('POLYLINE WIREFRAME');
    expect(w.text).toContain('NOT a B-Rep');
    // D 섹션 엔티티 타입은 106 뿐
    for (const ln of w.text.split('\n')) {
      if (ln.length === 80 && ln[72] === 'D') {
        const type = parseInt(ln.slice(0, 8), 10);
        expect(type).toBe(106);
      }
    }
  });
});

describe('writeIgesText → 자기 임포터 라운드트립', () => {
  it('박스 — AABB (0,0,0)~(20,30,40)·점수=6면×5점=30·aabb-approximation 명시', () => {
    const w = writeIgesText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.stats.entities).toBe(6);
    expect(w.stats.points).toBe(30);
    const r = igesToNexyfabAssembly(w.text, { name: 'rt-box' });
    expect(r.ok, r.error).toBe(true);
    expect(r.stats!.points).toBe(30);
    expect(r.stats!.entitiesUsed).toBe(6);
    expect(r.stats!.entitiesSkipped).toBe(0);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(20, 6);
    expect(p.params.depth).toBeCloseTo(30, 6);
    expect(p.params.height).toBeCloseTo(40, 6);
    expect(p.at).toEqual({ tx: 0, ty: 0, tz: 0 });
    // 임포터 스스로도 근사임을 명시해야 함(와이어프레임→AABB)
    expect(r.assembly!.fidelity).toBe('aabb-approximation');
    expect(r.assembly!.importedApprox).toBe(true);
  });

  it('L-프리즘 — AABB (60,40,20)·소수 좌표 보존', () => {
    // 오프셋은 소수 2자리 정밀값(임포터 part 방출이 0.01mm 반올림 — 그 이내 무손실 확인)
    const verts = L_VERTS.map(([x, y, z]) => [x + 0.25, y - 0.5, z + 1.5] as V3);
    const w = writeIgesText({ verts, faces: L_FACES });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = igesToNexyfabAssembly(w.text, { name: 'rt-l' });
    expect(r.ok, r.error).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(60, 6);
    expect(p.params.depth).toBeCloseTo(40, 6);
    expect(p.params.height).toBeCloseTo(20, 6);
    expect(p.at.tx).toBeCloseTo(0.25, 6);
    expect(p.at.ty).toBeCloseTo(-0.5, 6);
    expect(p.at.tz).toBeCloseTo(1.5, 6);
  });
});

describe('P섹션 좌표 전수 라운드트립(테스트 로컬 독립 파서)', () => {
  it('박스 — 페이스별 좌표 튜플이 소스 루프(폐합 반복점 포함)와 전수 일치', () => {
    const w = writeIgesText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const tuples = parsePSectionTuples(w.text);
    expect(tuples).toHaveLength(BOX_FACES.length);
    BOX_FACES.forEach((f, i) => {
      const want = [...f, f[0]].map((vi) => BOX_VERTS[vi]);
      expect(tuples[i]).toHaveLength(want.length);
      want.forEach((wv, k) => {
        expect(tuples[i][k][0]).toBeCloseTo(wv[0], 9);
        expect(tuples[i][k][1]).toBeCloseTo(wv[1], 9);
        expect(tuples[i][k][2]).toBeCloseTo(wv[2], 9);
      });
    });
  });

  it('비정수 좌표(0.1 등 이진 비정확값)도 무손실 왕복', () => {
    const verts = BOX_VERTS.map(([x, y, z]) => [x + 0.1, y + 0.2, z + 0.3] as V3);
    const w = writeIgesText({ verts, faces: BOX_FACES });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const tuples = parsePSectionTuples(w.text);
    // String(x)↔parseFloat 왕복은 배정도 무손실 — 완전 동일 비트 기대
    BOX_FACES.forEach((f, i) => {
      [...f, f[0]].forEach((vi, k) => {
        expect(tuples[i][k][0]).toBe(verts[vi][0]);
        expect(tuples[i][k][1]).toBe(verts[vi][1]);
        expect(tuples[i][k][2]).toBe(verts[vi][2]);
      });
    });
  });
});

describe('정직 거부', () => {
  it('페이스 0개 → ok:false', () => {
    const w = writeIgesText({ verts: BOX_VERTS, faces: [] });
    expect(w.ok).toBe(false);
  });

  it('비유한 좌표 → ok:false', () => {
    const verts = BOX_VERTS.map((v) => [...v] as V3);
    verts[0] = [NaN, 0, 0];
    const w = writeIgesText({ verts, faces: BOX_FACES });
    expect(w.ok).toBe(false);
  });
});
