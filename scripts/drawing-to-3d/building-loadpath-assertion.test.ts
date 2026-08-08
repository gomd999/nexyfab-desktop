/**
 * N-6/W2-4(260808b) — 건축 load_path 자동 assertion: 형상→하중경로 추출을
 * **독립 불변식**으로 교차검증한다(추출 코드 재구현 없이 — 기하·하중표에서
 * 따라 나오는 관계가 깨지면 추출이 표류한 것).
 *   1. 층 비례: Pu(지배기둥) = perFloorPu × floors (정확 항등, 두 층수 실측)
 *   2. 활하중 항등: L_kN = 슬래브 면적 × 용도 활하중(사무실 2.5 kN/m²)
 *   3. 조합 하한: perFloorPu ≥ 1.2·(슬래브 D/m²)+1.6·L 의 분담면적분
 *      (보·기둥 자중이 더해지므로 상회해야 정상 — 하회=추출 누락)
 *   4. 변이 실증: 베이 축소 → 분담면적·perFloorPu 감소
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- runtime .mjs, no declarations */
import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { loadPathCheck } from './load-path.mjs';

const build = buildAssemblyTemplate as unknown as (d: string, t: string, p: Record<string, unknown>) => any;
const check = loadPathCheck as unknown as (asm: any) => any;

describe('building load_path cross-assertions (W2-4)', () => {
  it('dominant-column Pu scales exactly with floors (extraction is per-floor consistent)', () => {
    const r10 = check(build('building', 'hi_rise_tower', {}));
    const r5 = check(build('building', 'hi_rise_tower', { floors: 5 }));
    const c10 = r10.columns[0], c5 = r5.columns[0];
    expect(c10.Pu_kN).toBeCloseTo(c10.perFloorPu_kN * 10, 1);
    expect(c5.Pu_kN).toBeCloseTo(c5.perFloorPu_kN * 5, 1);
    expect(c10.perFloorPu_kN).toBeCloseTo(c5.perFloorPu_kN, 1); // 층당 하중은 층수 무관
  });

  it('live load identity: L_kN = slab area × office live (KDS 2.5 kN/m²)', () => {
    const r = check(build('building', 'hi_rise_tower', {}));
    expect(r.loads.usage.live_kNm2).toBe(2.5);
    expect(r.loads.slab.L_kN).toBeCloseTo(r.loads.slab.areaM2 * 2.5, 1);
  });

  it('per-floor Pu lower bound: exceeds tributary slab-only U2 combo (self-weights must add, never drop)', () => {
    const r = check(build('building', 'hi_rise_tower', {}));
    const trib = (8000 * 8000) / 1e6; // 지배기둥 분담 8×8m — 템플릿 베이 기하
    const slabD_perM2 = r.loads.slab.D_kN / r.loads.slab.areaM2;
    const slabOnlyU2 = (1.2 * slabD_perM2 + 1.6 * 2.5) * trib;
    expect(r.columns[0].perFloorPu_kN).toBeGreaterThan(slabOnlyU2);      // 자중 누락 검출
    expect(r.columns[0].perFloorPu_kN).toBeLessThan(slabOnlyU2 * 1.6);  // 과대 산출 sanity
  });

  it('mutation: shrinking bays reduces tributary load (extraction follows geometry)', () => {
    const wide = check(build('building', 'hi_rise_tower', {}));
    const narrow = check(build('building', 'hi_rise_tower', { bayX: 6000, bayY: 6000 }));
    expect(narrow.columns[0].perFloorPu_kN).toBeLessThan(wide.columns[0].perFloorPu_kN * 0.75);
  });
});
