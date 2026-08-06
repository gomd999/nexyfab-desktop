/**
 * ifcExport 검증 (W5-H, 260721).
 *
 * 결정적 검증 2단:
 *  1) selfCheckIfc — 구조 파서 수준(필수 엔티티·참조 무결성·정점 수 일치). 의미론 아님 명시.
 *  2) 기존 ifcImport.ifcToNexyfabAssembly 라운드트립 — 실형상 복원(260807) 후 임포터는
 *     IfcFacetedBrep 를 AABB 박스가 아니라 정확 표면 메시(exact_surface_mesh)+수밀 체적으로
 *     방출한다. 체적·AABB·배치(0.1mm 반올림 정밀도)·클래스 집계를 검증.
 */
import { describe, it, expect } from 'vitest';
import { writeIfcText, selfCheckIfc, pseudoGuid } from './ifcExport';
import { ifcToNexyfabAssembly } from './ifcImport';
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

describe('writeIfcText — 구조 자기검사(selfCheckIfc)', () => {
  it('박스 — 필수 엔티티 전부·참조 무결성·루프 정점 수=융합 정점 8 일치', () => {
    const w = writeIfcText(BOX, { name: 'rt-box' });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.stats.breps).toBe(1);
    expect(w.stats.faces).toBe(6);
    expect(w.stats.brepPoints).toBe(8);
    const c = selfCheckIfc(w.text, { brepPoints: 8 });
    expect(c.errors).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.stats.loopPoints).toBe(8);
    expect(c.stats.faces).toBe(6);
    expect(c.stats.refsChecked).toBeGreaterThan(30);
  });

  it('STEP 실수 리터럴 규약 — 브렙 좌표 점은 소수점 포함(20. 형태)', () => {
    const w = writeIfcText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.text).toContain('IFCCARTESIANPOINT((20.,30.,40.))');
    expect(w.text).toContain(`FILE_SCHEMA(('IFC2X3'));`);
  });

  it('의사-GUID — 22자·IFC 알파벳·결정적(같은 시드=같은 값)·파일에 비-RFC4122 명시', () => {
    const g1 = pseudoGuid('seed-a');
    const g2 = pseudoGuid('seed-a');
    const g3 = pseudoGuid('seed-b');
    expect(g1).toHaveLength(22);
    expect(g1).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(g1).toBe(g2);
    expect(g1).not.toBe(g3);
    const w = writeIfcText(BOX);
    if (w.ok) expect(w.text).toContain('not RFC4122');
  });

  it('자기검사는 손상(엔티티 삭제=깨진 참조)을 실제로 잡는다 — 검사기 무력화 방지', () => {
    const w = writeIfcText(BOX);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    // IFCCLOSEDSHELL 행 제거 → FACETEDBREP 참조가 깨져야 함
    const broken = w.text.split('\n').filter((l) => !l.includes('IFCCLOSEDSHELL')).join('\n');
    const c = selfCheckIfc(broken);
    expect(c.ok).toBe(false);
    expect(c.errors.join(' ')).toContain('IFCCLOSEDSHELL');
  });
});

describe('writeIfcText → 기존 ifcImport 라운드트립', () => {
  it('박스 — proxy 1건·정확 메시 체적 24000·AABB 20×30×40 at(0,0,0)·MILLI 단위(unitScale=1)', () => {
    const w = writeIfcText(BOX, { name: 'rt-box' });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = ifcToNexyfabAssembly(w.text, { name: 'rt' });
    expect(r.ok, r.error).toBe(true);
    expect(r.stats!.unitScale).toBe(1);
    expect(r.stats!.imported).toBe(1);
    expect(r.stats!.byClass.IFCBUILDINGELEMENTPROXY).toBe(1);
    const p = r.assembly!.parts[0];
    // 실형상 복원(260807): IfcFacetedBrep → 정확 표면 메시 + 수밀 체적(AABB 박스 근사 폐기)
    expect(p.type).toBe('mesh');
    expect(p.geometryEvidence).toBe('exact_surface_mesh');
    expect(p.meshVolumeExact).toBe(true);
    const m = p.params as { volumeMm3: number; aabb: { min: number[]; max: number[] }; openSurface: boolean };
    expect(m.openSurface).toBe(false);
    // 임포터 방출은 0.1mm 반올림(toFixed(1)) — 그 정밀도 기준으로 일치
    expect(m.volumeMm3).toBeCloseTo(24000, 1);
    expect(m.aabb.max[0]).toBeCloseTo(20, 6);
    expect(m.aabb.max[1]).toBeCloseTo(30, 6);
    expect(m.aabb.max[2]).toBeCloseTo(40, 6);
    expect(p.at.tx).toBeCloseTo(0, 6);
    expect(p.at.ty).toBeCloseTo(0, 6);
    expect(p.at.tz).toBeCloseTo(0, 6);
  });

  it('L-프리즘 — 정확 메시 체적 32000(AABB 48000 아님)·AABB 60×40×20', () => {
    const w = writeIfcText({ verts: L_VERTS, faces: L_FACES }, { name: 'rt-l' });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const c = selfCheckIfc(w.text, { brepPoints: 12 });
    expect(c.errors).toEqual([]);
    const r = ifcToNexyfabAssembly(w.text, { name: 'rt' });
    expect(r.ok, r.error).toBe(true);
    const p = r.assembly!.parts[0];
    // 실형상 복원(260807): 종전 AABB 근사(48000 과대)와 달리 L-프리즘 실부피 32000 을 정확 주장
    expect(p.type).toBe('mesh');
    expect(p.meshVolumeExact).toBe(true);
    const m = p.params as { volumeMm3: number; aabb: { min: number[]; max: number[] } };
    expect(m.volumeMm3).toBeCloseTo(32000, 1);
    expect(m.aabb.max[0]).toBeCloseTo(60, 6);
    expect(m.aabb.max[1]).toBeCloseTo(40, 6);
    expect(m.aabb.max[2]).toBeCloseTo(20, 6);
  });

  it('분리 2성분(박스 2개) — IfcFacetedBrep 2개·합성 AABB', () => {
    const verts: V3[] = [...BOX_VERTS, ...BOX_VERTS.map(([x, y, z]) => [x + 100, y, z] as V3)];
    const faces = [...BOX_FACES, ...BOX_FACES.map((f) => f.map((v) => v + 8))];
    const w = writeIfcText({ verts, faces });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.stats.breps).toBe(2);
    const c = selfCheckIfc(w.text, { brepPoints: 16 });
    expect(c.errors).toEqual([]);
    const r = ifcToNexyfabAssembly(w.text, { name: 'rt2' });
    expect(r.ok, r.error).toBe(true);
    const p = r.assembly!.parts[0];
    // 실형상 복원(260807): 2성분도 정확 메시 — 합성 체적 48000(24000×2)·합성 AABB 폭 120
    expect(p.type).toBe('mesh');
    expect(p.meshVolumeExact).toBe(true);
    const m = p.params as { volumeMm3: number; aabb: { min: number[]; max: number[] } };
    expect(m.volumeMm3).toBeCloseTo(48000, 1);
    expect(m.aabb.max[0]).toBeCloseTo(120, 6);
  });
});

describe('정직 거부(폐셸 요건)', () => {
  it('개방 메시(페이스 1개 제거) → ok:false + 사유', () => {
    const w = writeIfcText({ verts: BOX_VERTS, faces: BOX_FACES.slice(0, 5) });
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.error).toContain('폐셸');
    expect(w.error).toContain('개방 엣지');
  });

  it('비유한 좌표 → ok:false', () => {
    const verts = BOX_VERTS.map((v) => [...v] as V3);
    verts[3] = [0, Infinity, 0];
    const w = writeIfcText({ verts, faces: BOX_FACES });
    expect(w.ok).toBe(false);
  });
});
