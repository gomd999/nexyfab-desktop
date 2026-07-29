/**
 * RC 골조 배근 선언 (260729).
 *
 * 5분야 전수 평가에서 **유일하게 남은 진짜 "판정 0개"** 가 rc_frame 이었다.
 * 보·기둥·기초가 전부 verdict "INPUT(beamAs/colAst/footing)" 이고 checks:null —
 * 단면력(Mu·Vu)은 산출됐는데 **배근이 선언되지 않아** 강도 판정을 하나도 못 했다.
 *
 * 원인: 철근이 오직 `params`(호출자)로만 들어왔는데 패키지 경로는 verifyParams 를
 * 비운 채 부른다. 단면(300×600)을 선언하면서 배근을 선언하지 않는 것은 RC 설계로서
 * 미완이다 — buildingSMART IFC 4.3 공식 커버리지 샘플에도 reinforcing-stirrup·
 * reinforcing-assembly 가 들어 있다.
 *
 * ⚠ 값을 지어내지 않는다. 어셈블리가 rcMeta 로 **선언한 것만** 쓰고, 호출자 params 가
 * 있으면 그쪽이 우선한다(현장 조건이 템플릿을 이긴다).
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { loadPathCheck } from './load-path.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type LP = {
  beams: { verdict: string; checks: Record<string, { pass: boolean }> | null }[];
  columns: { verdict: string; checks: Record<string, { pass: boolean }> | null }[];
  footing: { verdict: string };
};
const lp = (p?: unknown) =>
  (loadPathCheck as unknown as (a: unknown, p: unknown) => LP)(buildAssemblyTemplate('building', 'rc_frame', {}), p ?? {});

describe('템플릿이 배근을 선언한다', () => {
  it('rcMeta 가 표준 규격 조합으로 선언돼 있다', () => {
    const a = buildAssemblyTemplate('building', 'rc_frame', {}) as unknown as { rcMeta: Record<string, number> };
    expect(a.rcMeta).toEqual({ beamAs: 2000, beamAv: 142, beamS: 150, colAst: 3000 });
  });

  it('호출자 인자 없이도 강도가 판정된다 — 종전엔 INPUT 게이트였다', () => {
    const r = lp();
    expect(r.beams[0].verdict).toBe('PASS');
    expect(r.columns[0].verdict).toBe('PASS');
    expect(r.beams[0].checks).not.toBeNull();
  });

  it('전단까지 판정된다 — 스터럽을 선언했기 때문', () => {
    // 인장철근만 선언하면 전단이 FAIL 이다(Vc 만으로 부족). 스터럽 선언이 있어야 완결된다.
    expect(lp().beams[0].checks!.shear.pass).toBe(true);
    expect(lp({ beamAv: 0, beamS: 0 }).beams[0].checks!.shear.pass).toBe(false);
  });

  it('기초는 여전히 INPUT — 선언하지 않은 것을 판정한 척하지 않는다', () => {
    expect(lp().footing.verdict).toContain('INPUT');
  });
});

describe('선언 우선순위 — 현장 조건이 템플릿을 이긴다', () => {
  it('호출자 params 가 rcMeta 를 덮는다', () => {
    const base = lp().beams[0].checks!.flexure as unknown as { phiMn_kNm: number };
    const over = lp({ beamAs: 500 }).beams[0].checks!.flexure as unknown as { phiMn_kNm: number };
    expect(over.phiMn_kNm).toBeLessThan(base.phiMn_kNm);
  });

  it('rcMeta 가 없는 어셈블리는 종전대로 INPUT — 회귀 없음', () => {
    const other = buildAssemblyTemplate('building', 'commercial_massing', {}) as unknown as { rcMeta?: unknown };
    expect(other.rcMeta).toBeUndefined();
  });
});

describe('판정 0개가 해소된다', () => {
  it('rc_frame 이 더 이상 "판정한 항목 0개"가 아니다', () => {
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => {
      judged: number; evidenceSufficient: boolean; ok: boolean; unavailable?: string[];
    })(buildAssemblyTemplate('building', 'rc_frame', {}), {});
    expect(v.judged).toBeGreaterThan(0);
    expect(v.evidenceSufficient).toBe(true);
    expect(v.unavailable?.join(' ') ?? '').not.toContain('판정한 항목이 0개');
    // 지진·풍 미실시 고지는 그대로 남는다(별개 사안).
    expect(v.unavailable?.join(' ')).toContain('지진 검토');
  });
});
