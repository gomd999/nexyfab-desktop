/* eslint-disable @typescript-eslint/no-explicit-any -- runtime .mjs validators have no declarations */
import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { landscapeCheck } from './landscape-check.mjs';
import { verifyDomain } from './domain-verify.mjs';

const build = buildAssemblyTemplate as unknown as (domain: string, template: string, params: Record<string, unknown>) => any;
const verify = verifyDomain as unknown as (spec: Record<string, unknown>) => any;
const checkLandscape = landscapeCheck as unknown as (assembly: unknown, params: Record<string, unknown>) => any;

describe('landscape accuracy chain: modeled member -> load -> verdict', () => {
  it('derives deck section, span, spacing, load and board check from modeled parts', () => {
    const intent = build('landscape', 'timber_deck', {});
    const result = checkLandscape(intent, { species: 'pine', grade: 2, usage: 'residence_living' });
    expect(result.ok).toBe(true);
    expect(result.member).toMatchObject({ section: '45×140', spanMm: 2400, spacingMm: 444, verdict: 'PASS' });
    expect(result.member.load.live_kNm).toBeGreaterThan(0);
    expect(Object.values(result.member.checks).every((check: any) => check.pass === true)).toBe(true);
    expect(result.board.verdict).toBe('PASS');
    expect(result.connection.verdict).toBe('INPUT');
  });

  it('turns an explicit overload into a structural FAIL', () => {
    const intent = build('landscape', 'timber_deck', {});
    const result = checkLandscape(intent, { species: 'pine', grade: 2, extraW_kNm: 10 });
    expect(result.member.verdict).toBe('FAIL');
    expect(Object.values(result.member.checks).some((check: any) => check.pass === false)).toBe(true);
  });

  it('does not invent wind pressure and evaluates it only when explicitly supplied', () => {
    const intent = build('landscape', 'pergola', {});
    const omitted = checkLandscape(intent, {});
    expect(omitted.wind.skipped).toBe(true);
    expect(omitted.wind.pass).toBeUndefined();

    const checked = checkLandscape(intent, { windPressure_kNm2: 0.6, fsLimit: 1.5 });
    expect(checked.wind).toMatchObject({ windPressure_kNm2: 0.6, pass: false, worst: 'X풍' });
    expect(checked.wind.FS).toBeCloseTo(0.57, 2);
    expect(checked.wind.anchorUpliftPerPost_kN).toBeGreaterThan(0);
  });

  it('keeps drainage at the input gate until catchment and rainfall are declared', () => {
    const missing = verify({ intent: { domain: 'landscape', features: [] }, domain: 'landscape', calculatorId: 'landscape_drainage', params: {} });
    expect(missing.ok).toBe(false);
    expect(missing.needInputs.map((item: any) => item.name)).toEqual(expect.arrayContaining(['areaHa', 'i_mmhr']));

    const checked = verify({
      intent: { domain: 'landscape', features: [] }, domain: 'landscape', calculatorId: 'landscape_drainage',
      params: { areaHa: 1.2, C: 0.7, i_mmhr: 80 },
    });
    expect(checked.ok).toBe(true);
    expect(checked.verdict).toBe('PASS');
    expect(checked.input).toMatchObject({ areaHa: 1.2, C: 0.7, i_mmhr: 80 });
    expect(checked.checks.runoff.Q_m3s).toBeCloseTo(0.1866667, 6);
    expect(checked.checks.runoff.note).toMatch(/관거 미입력/);
  });
});
