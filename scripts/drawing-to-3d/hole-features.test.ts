/**
 * T1 구멍류 제조 피처 어휘 회귀(260719) — cbore·csink·tap·blind·키홈·오링 홈.
 * 생성≠검증: 폐형 체적 ↔ SCAD 실렌더 ↔ STEP 재임포트 3면 정합(A1 사상) + 게이트 거부.
 */
import { describe, it, expect } from 'vitest';
import { gate, holeFeature, parseThread, toOpenScad } from './reconstruct.mjs';
import { buildAssembly } from './assembly.mjs';
import { partVolume } from './structural.mjs';
import { renderStl } from './verify.mjs';
import { stlVolume } from './interference-refine.mjs';
import { intentToStep, ensureReplicad } from './to-step.mjs';
import { partSheets as _ps } from './part-sheets.mjs';

const partSheets = _ps as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;

const PLATE = {
  width: 200, depth: 120, thickness: 20,
  holes: [
    { x: 30, y: 30, d: 10 },
    { x: 30, y: 90, d: 8, kind: 'cbore', cbDia: 14, cbDepth: 8 },
    { x: 100, y: 30, d: 8, kind: 'csink', csDia: 16 },
    { x: 100, y: 90, d: 6, kind: 'tap', thread: 'M6', depth: 15 },
    { x: 170, y: 60, d: 12, depth: 12 },
  ],
};
const SHAFT = { diameter: 40, length: 120, keyway: { w: 12, depth: 5, length: 60 }, oringGrooves: [{ z: 10, w: 4, depth: 2.5 }, { z: 100, w: 4, depth: 2.5 }] };

async function stepVol(composeIntent: unknown) {
  const st = await intentToStep(composeIntent);
  const rc = await ensureReplicad();
  const shp = await rc.importSTEP(new Blob([st.step]));
  const m = shp.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const v = m.vertices, tri = m.triangles;
  let vol6 = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    vol6 += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return Math.abs(vol6 / 6);
}

describe('T1 구멍류 제조 피처', () => {
  it('holeFeature 파생: 탭=하경(M6→4.917)·싱크 깊이(90°=(D−d)/2)·라벨 표기', () => {
    expect(parseThread('M6')?.minor).toBeCloseTo(4.917, 3);
    expect(parseThread('M7')).toBeNull(); // 목록 외=정직 거부
    const cs = holeFeature({ x: 0, y: 0, d: 8, kind: 'csink', csDia: 16 }, 20);
    expect(cs.cs.depth).toBeCloseTo(4, 6);
    expect(cs.label).toContain('⌵');
    const tap = holeFeature({ x: 0, y: 0, d: 6, kind: 'tap', thread: 'M6', depth: 15 }, 20);
    expect(tap.drillD).toBeCloseTo(4.917, 3);
    expect(tap.label).toBe('M6×15');
  });
  it('게이트: cbDia≤d·비표준 나사·블라인드 관통 초과=거부', () => {
    const bad = (holes: unknown[]) => gate({ type: 'plate_with_holes', ...PLATE, holes });
    expect(bad([{ x: 30, y: 30, d: 10, kind: 'cbore', cbDia: 8, cbDepth: 5 }]).join(' ')).toContain('cbDia');
    expect(bad([{ x: 30, y: 30, d: 6, kind: 'tap', thread: 'M7' }]).join(' ')).toContain('비표준');
    expect(bad([{ x: 30, y: 30, d: 10, depth: 25 }]).join(' ')).toContain('depth');
    expect(gate({ type: 'plate_with_holes', ...PLATE })).toEqual([]);
  });
  it('플레이트 5피처: 폐형 체적 ↔ SCAD 실렌더 ↔ STEP 재임포트 정합(±1%)', async () => {
    const analytic = partVolume('plate_with_holes', PLATE);
    const scad = stlVolume(await renderStl(toOpenScad({ type: 'plate_with_holes', ...PLATE })));
    const asm = { parts: [{ id: 'p', type: 'plate_with_holes', params: PLATE, at: { tx: 0, ty: 0, tz: 0 } }] };
    const built = buildAssembly(asm);
    expect(built.ok).toBe(true);
    const step = await stepVol(built.composeIntent);
    expect(Math.abs(scad - analytic) / analytic, `analytic=${analytic} scad=${scad}`).toBeLessThan(0.01);
    expect(Math.abs(step - analytic) / analytic, `analytic=${analytic} step=${step}`).toBeLessThan(0.01);
  }, 120_000);
  it('축 키홈+오링 홈: 폐형(원호 절단 정확식·원환) ↔ SCAD ↔ STEP 정합(±1%)', async () => {
    const analytic = partVolume('cylinder', SHAFT);
    const plain = (Math.PI / 4) * 40 ** 2 * 120;
    expect(analytic).toBeLessThan(plain); // 홈들이 실제 공제됨
    const asm = { parts: [{ id: 's', type: 'cylinder', params: SHAFT, at: { tx: 0, ty: 0, tz: 0 } }] };
    const built = buildAssembly(asm);
    expect(built.ok).toBe(true);
    const scad = stlVolume(await renderStl(built.openscad));
    const step = await stepVol(built.composeIntent);
    expect(Math.abs(scad - analytic) / analytic, `analytic=${analytic} scad=${scad}`).toBeLessThan(0.01);
    expect(Math.abs(step - analytic) / analytic, `analytic=${analytic} step=${step}`).toBeLessThan(0.01);
  }, 120_000);
  it('구멍표: 동일 규격 그룹 N×표기 + 탭/보어 기호 — 부품도 시트 연동', () => {
    const asm = { parts: [{ id: 'p', type: 'plate_with_holes', params: PLATE, at: { tx: 0, ty: 0, tz: 0 } }] };
    const html = partSheets(asm, { title: 't1' });
    expect(html).toContain('구멍 규격');
    expect(html).toContain('M6×15');
    expect(html).toContain('⌴⌀14×8');
    expect(html).toContain('⌵⌀16');
  });
});
