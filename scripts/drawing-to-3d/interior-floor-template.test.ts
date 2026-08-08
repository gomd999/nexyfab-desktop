/**
 * D-L3 — 층 전체 인테리어: yaw-180 유닛 인스턴싱, 층 단위 피난 BFS(문 개구),
 * 통로폭 100% 커버리지, 간섭 0, 변이(문 봉쇄→도달불가 검출).
 */
import { describe, expect, it } from 'vitest';
import { buildInteriorFloor, buildInteriorFloorIR } from './interior-floor-template.mjs';
import { interiorCheck, passageWidthCheck } from './interior-check.mjs';
import { buildAssembly } from './assembly.mjs';

describe('interior floor template (D-L3)', () => {
  it('4x2 units: zero interference, floor-scale egress reaches every cell', () => {
    const r = buildInteriorFloor({ unitsPerSide: 4 });
    expect(r.ok).toBe(true);
    const built = buildAssembly({ name: 'f', domain: 'interior', parts: r.assembly!.parts });
    expect((built.interferences ?? []).length).toBe(0);
    const chk = interiorCheck(r.assembly, { travelLimitMm: 40000 }) as {
      ok: boolean; travel: { pass: boolean; maxTravelM: number; unreachableCells: number };
    };
    expect(chk.ok).toBe(true);
    expect(chk.travel.pass).toBe(true);
    expect(chk.travel.unreachableCells).toBe(0);
    expect(chk.travel.maxTravelM).toBeGreaterThan(10);
    expect(chk.travel.maxTravelM).toBeLessThan(20);
  });

  it('passage width at door width (900) covers 100%; corridor param is enforced at build', () => {
    const r = buildInteriorFloor({ unitsPerSide: 4 });
    const pw = passageWidthCheck(r.assembly, { minWidthMm: 900 }) as { pass: boolean; coverage: number };
    expect(pw.pass).toBe(true);
    expect(pw.coverage).toBe(1);
    expect(() => buildInteriorFloorIR({ corridorW: 1000 })).toThrow();
  });

  it('mutation: sealing one unit door strands that unit (unreachable cells detected)', () => {
    const r = buildInteriorFloor({ unitsPerSide: 3 });
    // unitS[1] 복도벽의 문 개구 제거 → 그 유닛은 고립되어야 한다
    const wallPart = r.assembly!.parts.find((p: { id: string }) => p.id === 'unitS[1]/corr_wall')! as
      { params: { openings: unknown[] } };
    wallPart.params = { ...wallPart.params, openings: [] };
    const chk = interiorCheck(r.assembly, { travelLimitMm: 40000 }) as {
      travel: { unreachableCells: number; unreachableM2: number };
    };
    expect(chk.travel.unreachableCells).toBeGreaterThan(0);
    expect(chk.travel.unreachableM2).toBeGreaterThan(15); // ≈ 유닛 면적대
  });
});
