/**
 * A-L2 — 모듈형 컨베이어 라인: 중첩 정의 전개, 모듈 경계 연속성(레일·롤러 피치,
 * 변이 실증), 말단 봉합, 간섭 0(눕힌 원통 = OBB 경로).
 */
import { describe, expect, it } from 'vitest';
import { buildMachineLine, buildMachineLineIR, gateMachineLine } from './machine-line-template.mjs';
import { buildAssembly } from './assembly.mjs';

describe('machine line template (A-L2)', () => {
  it('4 modules: closed-form counts, gates pass, zero interference', () => {
    const r = buildMachineLine({ modules: 4 });
    expect(r.gateErrors).toEqual([]);
    expect(r.ok).toBe(true);
    // 모듈당: 레그2+레일2+롤러8=12 ×4 + 말단레그2 + 구동부1 = 51
    expect(r.expanded!.parts!).toHaveLength(51);
    const built = buildAssembly({ name: r.expanded!.name, domain: 'mech', parts: r.expanded!.parts });
    expect(built.ok).toBe(true);
    expect((built.interferences ?? []).length).toBe(0);
  });

  it('mutation: a shifted module breaks BOTH rail continuity and cross-boundary roller pitch', () => {
    const r = buildMachineLine({ modules: 3 });
    for (const part of r.expanded!.parts!) {
      if (part.id.startsWith('mod[1]/')) (part as { at: { tx: number } }).at.tx += 40;
    }
    const errs = gateMachineLine(r.ir, r.expanded!);
    expect(errs.some((e: string) => e.includes('rail_continuity'))).toBe(true);
    expect(errs.some((e: string) => e.includes('roller_pitch'))).toBe(true);
  });

  it('honest refusals: pitch must divide module length', () => {
    expect(() => buildMachineLineIR({ moduleLen: 2000, rollerPitch: 300 })).toThrow();
    expect(() => buildMachineLineIR({ modules: 0 })).toThrow();
  });
});
