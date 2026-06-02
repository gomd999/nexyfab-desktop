/**
 * stepWrite.fmt — REAL literal formatter regression suite.
 *
 * Pins the contract that `stepWrite.__internal.fmt` produces an AP214 /
 * Part 21 REAL literal with:
 *   - a SINGLE trailing dot on whole numbers (`1.`, `-2.`, `100.`)
 *   - NO trailing dot on values with a genuine fractional component
 *     (`1.5`, `-0.529999`, `3.14`) — the pre-fix implementation produced
 *     stray-dot output like `'-0.529999.'`, which `stepImport.parseSingleArg`
 *     had to strip defensively. This suite locks that defensive workaround
 *     into a no-op going forward.
 *   - STEP exponential form (`1.E-7`) for sub-resolution magnitudes that
 *     would otherwise collapse to `0.` under 6-decimal fixed formatting.
 *
 * The suite also asserts that real writer output (`writeExtrudeAsStep` /
 * polygon writer) contains no `\.\.` doubles and no fractional-tailed dots,
 * so the contract holds end-to-end.
 */
import { describe, it, expect } from 'vitest';
import {
  __internal,
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
} from './stepWrite';
import { importStep } from './stepImport';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

const { fmt } = __internal;

describe('stepWrite.fmt — integer values', () => {
  it('fmt(0) → "0."', () => {
    expect(fmt(0)).toBe('0.');
  });

  it('fmt(-0) → "0."', () => {
    // -0 === 0 is true; we collapse to "0." for spec sanity.
    expect(fmt(-0)).toBe('0.');
  });

  it('fmt(1) → "1."', () => {
    expect(fmt(1)).toBe('1.');
  });

  it('fmt(-2) → "-2."', () => {
    expect(fmt(-2)).toBe('-2.');
  });

  it('fmt(100) → "100."', () => {
    expect(fmt(100)).toBe('100.');
  });

  it('fmt(1234567) → "1234567."', () => {
    expect(fmt(1234567)).toBe('1234567.');
  });
});

describe('stepWrite.fmt — non-integer values (regression: no stray trailing dot)', () => {
  it('fmt(1.5) → "1.5" (no trailing dot)', () => {
    expect(fmt(1.5)).toBe('1.5');
  });

  it('fmt(-0.529999) → "-0.529999" (regression: previously "-0.529999.")', () => {
    expect(fmt(-0.529999)).toBe('-0.529999');
  });

  it('fmt(3.14) → "3.14"', () => {
    expect(fmt(3.14)).toBe('3.14');
  });

  it('fmt(0.001) → "0.001"', () => {
    expect(fmt(0.001)).toBe('0.001');
  });

  it('fmt(0.5) → "0.5"', () => {
    expect(fmt(0.5)).toBe('0.5');
  });

  it('fmt(-0.5) → "-0.5"', () => {
    expect(fmt(-0.5)).toBe('-0.5');
  });

  it('fmt(-3.14) → "-3.14"', () => {
    expect(fmt(-3.14)).toBe('-3.14');
  });

  it('fmt(100.25) → "100.25"', () => {
    expect(fmt(100.25)).toBe('100.25');
  });

  it('fmt(0.123456) → "0.123456" (full 6-decimal precision retained)', () => {
    expect(fmt(0.123456)).toBe('0.123456');
  });
});

describe('stepWrite.fmt — sub-resolution → STEP exponential', () => {
  it('fmt(1e-7) → "1.E-7"', () => {
    expect(fmt(1e-7)).toBe('1.E-7');
  });

  it('fmt(-1e-7) → "-1.E-7"', () => {
    expect(fmt(-1e-7)).toBe('-1.E-7');
  });

  it('fmt(2.5e-8) → "2.5E-8"', () => {
    expect(fmt(2.5e-8)).toBe('2.5E-8');
  });

  it('fmt(1e-12) survives round-trip — does not collapse to 0', () => {
    const out = fmt(1e-12);
    expect(out).not.toBe('0.');
    expect(Number(out.replace('E', 'e'))).toBeCloseTo(1e-12, 18);
  });
});

describe('stepWrite.fmt — non-finite throws', () => {
  it('fmt(NaN) throws', () => {
    expect(() => fmt(Number.NaN)).toThrow(/non-finite/);
  });

  it('fmt(Infinity) throws', () => {
    expect(() => fmt(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('fmt(-Infinity) throws', () => {
    expect(() => fmt(Number.NEGATIVE_INFINITY)).toThrow(/non-finite/);
  });
});

describe('stepWrite output — no stray trailing dots in REAL literals', () => {
  /** Match every numeric token inside a coordinate / direction / vector list. */
  function extractNumericTokens(stepSource: string): string[] {
    // Tokens that look like REAL literals: optional sign, digits, optional
    // '.', optional digits, optional E±digits. Excludes ref tokens ('#N')
    // and the '.T.' / '.F.' enum flags (which are bounded by dots on both
    // sides, not free-floating numbers).
    const tokens: string[] = [];
    // Restrict scan to argument-list parens so we don't false-match on
    // schema text like 'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'.
    for (const m of stepSource.matchAll(/\(([^()]*)\)/g)) {
      const inner = m[1]!;
      for (const t of inner.split(',')) {
        const trimmed = t.trim();
        // Filter for numeric-looking tokens (digit anywhere, no '#', no quotes).
        if (/^-?\d/.test(trimmed) && !/[#'$*]/.test(trimmed)) {
          tokens.push(trimmed);
        }
      }
    }
    return tokens;
  }

  it('writer output contains no `..` double-dot sequences', () => {
    const ext: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -0.529999, y: 0 },
        { x: 1.5, y: 0 },
        { x: 1.5, y: 3.14 },
        { x: -0.529999, y: 3.14 },
      ],
      depth: 7,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudePolygonAsStep(ext);
    expect(out).not.toMatch(/\.\./);
  });

  it('every numeric token has at most one trailing dot and is parseable', () => {
    const ext: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -0.529999, y: 0.001 },
        { x: 1.5, y: 0.001 },
        { x: 1.5, y: 3.14 },
        { x: -0.529999, y: 3.14 },
      ],
      depth: 7.25,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudePolygonAsStep(ext);
    const tokens = extractNumericTokens(out);
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      // Must not end with `..`.
      expect(tok).not.toMatch(/\.\.$/);
      // Must not have multiple `.` characters in the mantissa (one dot only).
      const mantissa = tok.split(/[eE]/)[0]!;
      const dotCount = (mantissa.match(/\./g) ?? []).length;
      expect(dotCount).toBeLessThanOrEqual(1);
      // Must be parseable by JS Number (after a defensive trailing-dot strip
      // since `Number('1.')` is fine but `Number('1.5.')` is NaN — proving
      // the absence of the stray-dot bug).
      const parsed = Number(tok.replace(/E/g, 'e'));
      expect(Number.isFinite(parsed)).toBe(true);
    }
  });

  it('round-trip of a fractional-coord polygon imports cleanly (parseSingleArg dot-strip is now a no-op)', () => {
    const ext: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -0.529999, y: 0.001 },
        { x: 1.5, y: 0.001 },
        { x: 1.5, y: 3.14 },
        { x: -0.529999, y: 3.14 },
      ],
      depth: 7.25,
      direction: 'one_sided',
      mode: 'add',
    };
    const stepSrc = writeExtrudePolygonAsStep(ext);
    const result = importStep(stepSrc);
    expect(result.unsupported).toEqual([]);
    expect(result.tree.nodes).toHaveLength(1);
    const feature = result.tree.nodes[0]!.payload as ExtrudeFeature;
    expect(feature.depth).toBeCloseTo(7.25, 5);
  });

  it('integer-coord box writer still emits trailing-dot REAL literals (`10.`, `0.`, `-3.`)', () => {
    const ext: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -3, y: -2 },
        { x: 5, y: -2 },
        { x: 5, y: 6 },
        { x: -3, y: 6 },
      ],
      depth: 4,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudeAsStep(ext);
    expect(out).toContain('(-3.,-2.,0.)');
    expect(out).toContain('(5.,6.,4.)');
  });
});
