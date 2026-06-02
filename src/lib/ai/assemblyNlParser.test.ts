/**
 * assemblyNlParser tests — regex coverage for the four AssemblyPlan kinds
 * plus prompt-builder structural assertions.
 *
 * Coverage matrix:
 *   - regex hits for each of {stacked, grid, ring, pair} in two phrasings
 *   - regex picks up optional spacing/radius modifiers
 *   - regex returns `{kind:'unparsed'}` for free-form prompts
 *   - empty / whitespace / non-string text → unparsed (total function)
 *   - grid > stacked priority when both shapes appear
 *   - BUILD_ASSEMBLY_PROMPT carries all four kinds, the schema sketch, the
 *     examples block, and the user's text (with quote-escaping)
 *   - exported constants enumerate every kind / pair mate exactly once
 */
import { describe, it, expect } from 'vitest';
import {
  detectAssemblyIntent,
  BUILD_ASSEMBLY_PROMPT,
  ASSEMBLY_PLAN_KINDS,
  PAIR_MATE_KINDS,
  ASSEMBLY_SCHEMA_SKETCH,
  ASSEMBLY_EXAMPLES_BLOCK,
} from './assemblyNlParser';

describe('detectAssemblyIntent — stacked', () => {
  it('"3 stacked" → kind=stacked, count=3', () => {
    const r = detectAssemblyIntent('3 stacked');
    expect(r).toEqual({ kind: 'stacked', count: 3 });
  });

  it('"5 stacked plates" → ignores noun, count=5', () => {
    const r = detectAssemblyIntent('5 stacked plates');
    expect(r.kind).toBe('stacked');
    if (r.kind === 'stacked') expect(r.count).toBe(5);
  });

  it('"stack 4 parts" → verb form, count=4', () => {
    const r = detectAssemblyIntent('stack 4 parts');
    expect(r).toEqual({ kind: 'stacked', count: 4 });
  });

  it('"4 stacked spacing 12.5" → captures spacing', () => {
    const r = detectAssemblyIntent('4 stacked spacing 12.5');
    expect(r).toEqual({ kind: 'stacked', count: 4, spacing: 12.5 });
  });
});

describe('detectAssemblyIntent — grid', () => {
  it('"2 x 3 grid" → rows=2, cols=3', () => {
    const r = detectAssemblyIntent('2 x 3 grid');
    expect(r).toEqual({ kind: 'grid', rows: 2, cols: 3 });
  });

  it('"4×2 grid of cylinders" → unicode times, ignores noun', () => {
    const r = detectAssemblyIntent('4×2 grid of cylinders');
    expect(r.kind).toBe('grid');
    if (r.kind === 'grid') {
      expect(r.rows).toBe(4);
      expect(r.cols).toBe(2);
    }
  });

  it('"3 x 3 grid spacing 50" → captures spacing', () => {
    const r = detectAssemblyIntent('3 x 3 grid spacing 50');
    expect(r).toEqual({ kind: 'grid', rows: 3, cols: 3, spacing: 50 });
  });
});

describe('detectAssemblyIntent — ring', () => {
  it('"ring of 6" → count=6', () => {
    const r = detectAssemblyIntent('ring of 6');
    expect(r).toEqual({ kind: 'ring', count: 6 });
  });

  it('"8 in a ring" → trailing form, count=8', () => {
    const r = detectAssemblyIntent('8 in a ring');
    expect(r).toEqual({ kind: 'ring', count: 8 });
  });

  it('"ring of 6 radius 30" → captures radius', () => {
    const r = detectAssemblyIntent('ring of 6 radius 30');
    expect(r).toEqual({ kind: 'ring', count: 6, radius: 30 });
  });

  it('"ring of 1" → unparsed (count < 2 not geometric)', () => {
    const r = detectAssemblyIntent('ring of 1');
    expect(r.kind).toBe('unparsed');
  });
});

describe('detectAssemblyIntent — pair', () => {
  it('"pair concentric" → mate=concentric', () => {
    const r = detectAssemblyIntent('pair concentric');
    expect(r).toEqual({ kind: 'pair', mate: 'concentric' });
  });

  it('"pair with hinge" → mate=hinge', () => {
    const r = detectAssemblyIntent('pair with hinge');
    expect(r).toEqual({ kind: 'pair', mate: 'hinge' });
  });

  it('"two parts coincident" → mate=coincident', () => {
    const r = detectAssemblyIntent('two parts coincident');
    expect(r).toEqual({ kind: 'pair', mate: 'coincident' });
  });

  it('"pair distance" → unparsed (unknown mate)', () => {
    const r = detectAssemblyIntent('pair distance');
    expect(r.kind).toBe('unparsed');
  });
});

describe('detectAssemblyIntent — unparsed / total-function safety', () => {
  it('free-form prompt → unparsed', () => {
    expect(detectAssemblyIntent('create a magical floating bridge').kind).toBe(
      'unparsed',
    );
  });

  it('empty string → unparsed', () => {
    expect(detectAssemblyIntent('').kind).toBe('unparsed');
  });

  it('whitespace-only → unparsed', () => {
    expect(detectAssemblyIntent('   \n\t  ').kind).toBe('unparsed');
  });

  it('non-string (defensive) → unparsed', () => {
    // The signature is `string`, but the route can receive arbitrary JSON
    // and the parser must not crash. Defensive contract.
    expect(detectAssemblyIntent(undefined as unknown as string).kind).toBe(
      'unparsed',
    );
    expect(detectAssemblyIntent(42 as unknown as string).kind).toBe('unparsed');
  });

  it('"0 stacked" → unparsed (count must be positive)', () => {
    expect(detectAssemblyIntent('0 stacked').kind).toBe('unparsed');
  });

  it('"0 x 3 grid" → unparsed', () => {
    expect(detectAssemblyIntent('0 x 3 grid').kind).toBe('unparsed');
  });

  it('grid wins over stacked when both appear', () => {
    // "2 x 3 grid stacked" — grid matcher fires first by priority.
    const r = detectAssemblyIntent('2 x 3 grid stacked');
    expect(r.kind).toBe('grid');
  });

  it('case-insensitive matching', () => {
    const r = detectAssemblyIntent('STACK 3 PARTS');
    expect(r.kind).toBe('stacked');
    if (r.kind === 'stacked') expect(r.count).toBe(3);
  });

  it('"grid" without dimensions → unparsed', () => {
    expect(detectAssemblyIntent('grid').kind).toBe('unparsed');
  });
});

describe('BUILD_ASSEMBLY_PROMPT', () => {
  it('contains all four kinds in the kinds-line', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('arbitrary');
    for (const k of ASSEMBLY_PLAN_KINDS) {
      expect(prompt).toContain(k);
    }
  });

  it('contains the schema sketch and examples block', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('arbitrary');
    expect(prompt).toContain(ASSEMBLY_SCHEMA_SKETCH);
    expect(prompt).toContain(ASSEMBLY_EXAMPLES_BLOCK);
  });

  it('embeds the user request verbatim (quotes escaped)', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('a "ring" of 6');
    // Quotes inside the user text must be backslash-escaped so the prompt
    // remains a single well-formed quoted block.
    expect(prompt).toContain('a \\"ring\\" of 6');
  });

  it('instructs the LLM to emit "null" on ambiguity', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('please help');
    expect(prompt).toMatch(/emit the literal string: null/);
  });

  it('forbids markdown fences in output', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('x');
    expect(prompt.toLowerCase()).toContain('do not wrap output in markdown');
  });

  it('mentions millimetres unit policy', () => {
    const prompt = BUILD_ASSEMBLY_PROMPT('x');
    expect(prompt.toLowerCase()).toContain('millimetres');
  });
});

describe('ASSEMBLY_PLAN_KINDS / PAIR_MATE_KINDS constants', () => {
  it('PLAN_KINDS enumerates exactly the four supported kinds', () => {
    expect([...ASSEMBLY_PLAN_KINDS].sort()).toEqual(
      ['grid', 'pair', 'ring', 'stacked'].sort(),
    );
  });

  it('PAIR_MATE_KINDS enumerates exactly the three supported mates', () => {
    expect([...PAIR_MATE_KINDS].sort()).toEqual(
      ['coincident', 'concentric', 'hinge'].sort(),
    );
  });

  it('schema sketch references each kind discriminator literal', () => {
    expect(ASSEMBLY_SCHEMA_SKETCH).toContain('"stacked"');
    expect(ASSEMBLY_SCHEMA_SKETCH).toContain('"grid"');
    expect(ASSEMBLY_SCHEMA_SKETCH).toContain('"ring"');
    expect(ASSEMBLY_SCHEMA_SKETCH).toContain('"pair"');
  });

  it('examples block contains one worked example per kind', () => {
    expect(ASSEMBLY_EXAMPLES_BLOCK).toContain('"kind":"stacked"');
    expect(ASSEMBLY_EXAMPLES_BLOCK).toContain('"kind":"grid"');
    expect(ASSEMBLY_EXAMPLES_BLOCK).toContain('"kind":"ring"');
    expect(ASSEMBLY_EXAMPLES_BLOCK).toContain('"kind":"pair"');
  });
});
