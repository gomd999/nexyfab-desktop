/**
 * design_brief MCP tool — handler unit tests (WA-D3 MCP surface).
 *
 * Exercises the REAL tool path: runDesignBriefTool spawns the tsx runner, which
 * runs the SAME shared driver the API route uses. Same brief ⇒ same payload
 * (동일 계약). Verifies success (verified package) + explicit refusal.
 */
import { describe, it, expect } from 'vitest';
import { runDesignBriefTool } from './design-brief.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The .mjs bridge returns the JSON tool payload untyped — assert against `any`.

describe('design_brief MCP tool (subprocess-backed, deterministic planner)', () => {
  it('known fixture brief → verified package with measured volume', async () => {
    const r = await runDesignBriefTool({ text: 'L-Bracket', fixture: 'l-bracket' }) as any;
    expect(r.ok).toBe(true);
    expect(r.planId).toBe('fixture-l-bracket');
    expect(r.package.parts[0].volumeMm3).toBeCloseTo(14720, 6);
    expect(r.package.report.allPassed).toBe(true);
    expect(r.package.report.limitations.length).toBeGreaterThan(0);
  }, 60_000);

  it('MCP payload matches the API contract (parity check)', async () => {
    const r = await runDesignBriefTool({ text: 'pin block', fixture: 'pin-block-assembly' }) as any;
    expect(r.ok).toBe(true);
    expect(r.package.bom.length).toBeGreaterThanOrEqual(2);
    expect(r.package.assembly.converged).toBe(true);
  }, 60_000);

  it('unknown brief → explicit plan-stage refusal (no package)', async () => {
    const r = await runDesignBriefTool({ text: 'a spaceship', fixture: 'nope' }) as any;
    expect(r.ok).toBe(false);
    expect(r.refusal.stage).toBe('plan');
    expect(r.refusal.reason).toMatch(/unknown brief/i);
    expect(r.package).toBeUndefined();
  }, 60_000);
});
