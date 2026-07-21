/**
 * civil/module.test.ts — 통합판 acceptance (새 스파인 + 기존 엔진).
 *
 * The civil DomainModule now runs each member through the REAL engineering-core
 * calculators (simple_beam / column_buckling / retaining_wall_stability /
 * slope_infinite) via engineAdapter — so a beam gets 휨·전단·처짐 (the pure-TS
 * re-derivation only did bending+deflection). The multi-member atomic package +
 * LLM planner (this session's new value) stay; the physics is the verified engine.
 *
 * These tests need the engineering-core .mjs engine (present at repo root).
 */
import { describe, it, expect } from 'vitest';
import { runDomainDriver } from '@/lib/domain-driver';
import { civilModule, steelBeamPlan, mixedStructurePlan } from '../module';

describe('통합 civil — spine drives the real engineering-core engine', () => {
  it('steel-beam → engine simple_beam verdict PASS with 휨·전단·처짐 detail', async () => {
    const res = await runDomainDriver({ id: 'steel-beam', params: { fixture: 'steel-beam' } }, civilModule);
    expect(res.ok, res.ok ? '' : res.refusal.reason).toBe(true);
    if (!res.ok) return;
    expect(res.domain).toBe('civil');
    const g = res.gates.find((x) => x.id === 'structural:B1')!;
    expect(g.pass).toBe(true);
    // The engine reports SHEAR (the pure-TS re-derivation lacked it) — completeness proof.
    expect(Object.keys(g.metrics).some((k) => k.startsWith('shear'))).toBe(true);
    const m = res.package.members[0]!;
    expect(m.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['bending', 'shear', 'deflection']));
    expect(res.package.disclaimer).toContain('engineering-core');
  });

  it('mixed-structure → beam + column + wall + slope all verified by the engine', async () => {
    const res = await runDomainDriver({ id: 'mixed-structure', params: { fixture: 'mixed-structure' } }, civilModule);
    expect(res.ok, res.ok ? '' : res.refusal.reason).toBe(true);
    if (!res.ok) return;
    expect(res.gates.every((g) => g.pass), res.gates.filter((g) => !g.pass).map((g) => g.id).join(',')).toBe(true);
    // retaining wall now brings sliding + bearing + eccentricity, not just overturning.
    const wall = res.package.members.find((mm) => mm.id === 'W1')!;
    const wallChecks = wall.checks.map((c) => c.id);
    expect(wallChecks).toEqual(expect.arrayContaining(['overturning', 'sliding', 'bearing']));
    expect(res.package.members.map((mm) => mm.kind)).toEqual(['beam', 'column', 'retaining-wall', 'slope']);
  });

  it('an over-stressed beam is REFUSED by the engine (bending demand > allowable)', async () => {
    const plan = steelBeamPlan();
    (plan.members[0] as { udlKNpm?: number }).udlKNpm = 200; // M huge → bending FAIL
    const res = await runDomainDriver({ id: 'over' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('structural:B1');
    expect(res.refusal.reason).toContain('bending'); // engine names the unmet check
  });

  it('a beam with NO load is REFUSED (엔진 하중 게이트 — 값 날조 금지)', async () => {
    const plan = steelBeamPlan();
    delete (plan.members[0] as { udlKNpm?: number }).udlKNpm; // no w, no P
    const res = await runDomainDriver({ id: 'no-load' }, { ...civilModule, plan: () => plan });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('structural:B1:input');
  });

  it('an unknown brief is REFUSED at the plan stage', async () => {
    const res = await runDomainDriver({ id: 'nope', params: { fixture: 'nonexistent' } }, civilModule);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('plan');
    expect(res.refusal.reason).toContain('unknown brief');
  });
});
