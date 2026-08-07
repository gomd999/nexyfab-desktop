/* eslint-disable @typescript-eslint/no-explicit-any -- runtime .mjs validators have no declarations */
import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { civilCheck } from './civil-check.mjs';
import { verifyDomain } from './domain-verify.mjs';

const build = buildAssemblyTemplate as unknown as (domain: string, template: string, params: Record<string, unknown>) => any;
const verify = verifyDomain as unknown as (spec: Record<string, unknown>) => any;

describe('civil accuracy chain: geometry -> preliminary check -> calculator verdict', () => {
  it('keeps retaining-wall geometry as the single source of truth', () => {
    const intent = build('civil', 'retaining_wall_run', { H: 3000, baseWidth: 2000, baseThickness: 400, toeLength: 600 });
    const preliminary = civilCheck(intent)!;
    expect(Object.values(preliminary.checks).every((check: any) => check.pass === true)).toBe(true);
    expect(preliminary.basis).toMatchObject({ H: 3, baseWidth: 2, baseThickness: 0.4 });

    const result = verify({
      intent, domain: 'civil', calculatorId: 'retaining_wall_stability',
      // Geometry-owned values must not be overridden by caller input.
      params: { H: 9, baseWidth: 9, baseThickness: 1.5, toeLength: 2, allowableBearing: 200 },
    });
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('PASS');
    expect(result.derived).toMatchObject({ H: 3, baseWidth: 2, baseThickness: 0.4, toeLength: 0.6 });
    expect(result.input).toMatchObject({ H: 3, baseWidth: 2, baseThickness: 0.4, toeLength: 0.6 });
    expect(result.provenance.user).not.toEqual(expect.arrayContaining(['H', 'baseWidth', 'baseThickness', 'toeLength']));
  });

  it('detects an undersized retaining-wall proportion before structural calculation', () => {
    const intent = build('civil', 'retaining_wall_run', { H: 4000, baseWidth: 1400, baseThickness: 200, toeLength: 700 });
    const result = civilCheck(intent)!;
    expect(result.checks.baseWidthRatio.pass).toBe(false);
    expect(result.checks.baseThicknessRatio.pass).toBe(false);
    expect(result.checks.toeRatio.pass).toBe(false);
  });

  it('derives box-culvert dimensions and returns section forces as INFO, not a fabricated PASS', () => {
    const intent = build('civil', 'box_culvert', { innerWidth: 3000, innerHeight: 3000, wallThk: 350 });
    expect(Object.values(civilCheck(intent)!.checks).every((check: any) => check.pass === true)).toBe(true);
    const result = verify({ intent, domain: 'civil', calculatorId: 'box_culvert_frame', params: { innerWidth: 8, wallThk: 2 } });
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('INFO');
    expect(result.derived).toEqual({ innerWidth: 3, innerHeight: 3, wallThk: 0.35 });
    expect(Object.values(result.moments).every(Number.isFinite)).toBe(true);
    expect(Object.values(result.shears).every(Number.isFinite)).toBe(true);
  });

  it('fails closed when required geometry is absent', () => {
    const result = verify({ intent: { domain: 'civil', features: [] }, domain: 'civil', calculatorId: 'retaining_wall_stability', params: {} });
    expect(result.ok).toBe(false);
    expect(result.needInputs.map((item: any) => item.name)).toEqual(expect.arrayContaining(['H', 'baseWidth']));
    expect(result.verdict).toBeUndefined();
  });
});
