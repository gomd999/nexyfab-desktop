/**
 * llmPrompt — Phase 3.AI.2 tests for the BUILD_INTENT_PROMPT template.
 *
 * Confirms:
 *   - The template returns a non-trivial string.
 *   - All 12 INTENT_KINDS are mentioned in the prompt body.
 *   - At least one worked example per kind is embedded.
 *   - Error-case guidance + "null" sentinel rule appear in the prompt.
 *   - User text is interpolated and quote-escaped.
 *   - The intentKinds param can restrict the output (subset support).
 */
import { describe, it, expect } from 'vitest';
import {
  BUILD_INTENT_PROMPT,
  SCHEMA_SKETCH,
  INTENT_EXAMPLES,
} from './llmPrompt';
import { INTENT_KINDS } from './featureTreeIntentDetector';

describe('BUILD_INTENT_PROMPT — basic shape', () => {
  it('returns a non-empty string', () => {
    const out = BUILD_INTENT_PROMPT('box 50x50x30');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(200);
  });

  it('interpolates the user text', () => {
    const out = BUILD_INTENT_PROMPT('cylinder r 10 h 20');
    expect(out).toContain('cylinder r 10 h 20');
  });

  it('escapes embedded double quotes in user text', () => {
    const out = BUILD_INTENT_PROMPT('say "hi"');
    // Embedded quotes must be backslash-escaped so the wrapper "…" stays balanced.
    expect(out).toContain('say \\"hi\\"');
  });
});

describe('BUILD_INTENT_PROMPT — covers all 12 INTENT_KINDS', () => {
  const out = BUILD_INTENT_PROMPT('box 50x50x30');

  for (const kind of INTENT_KINDS) {
    it(`mentions kind "${kind}"`, () => {
      expect(out).toContain(kind);
    });
  }

  it('lists exactly 12 kinds in the allowed list', () => {
    expect(INTENT_KINDS).toHaveLength(12);
  });
});

describe('BUILD_INTENT_PROMPT — embeds examples', () => {
  const out = BUILD_INTENT_PROMPT('box 50x50x30');

  it('has an Examples section header', () => {
    expect(out).toMatch(/##\s+Examples/);
  });

  it('contains at least one example input per kind', () => {
    for (const kind of INTENT_KINDS) {
      const examples = INTENT_EXAMPLES[kind];
      expect(examples.length).toBeGreaterThan(0);
      expect(out).toContain(examples[0]!.in);
    }
  });

  it('contains the worked JSON output for at least one example per kind', () => {
    for (const kind of INTENT_KINDS) {
      const examples = INTENT_EXAMPLES[kind];
      expect(out).toContain(examples[0]!.out);
    }
  });
});

describe('BUILD_INTENT_PROMPT — error / ambiguity handling', () => {
  const out = BUILD_INTENT_PROMPT('box 50x50x30');

  it('instructs the LLM to emit literal null when no kind matches', () => {
    expect(out).toMatch(/literal string:\s*null/);
  });

  it('forbids markdown code fences', () => {
    expect(out).toMatch(/Do NOT wrap output in markdown code fences/);
  });

  it('lists at least one explicit null example', () => {
    expect(out).toContain('→ null');
  });
});

describe('BUILD_INTENT_PROMPT — schema sketch', () => {
  it('embeds the SCHEMA_SKETCH constant verbatim', () => {
    const out = BUILD_INTENT_PROMPT('box 50x50x30');
    expect(out).toContain(SCHEMA_SKETCH);
  });

  it('SCHEMA_SKETCH names every kind', () => {
    for (const kind of INTENT_KINDS) {
      expect(SCHEMA_SKETCH).toContain(kind);
    }
  });
});

describe('BUILD_INTENT_PROMPT — intentKinds subset', () => {
  it('honours a restricted intentKinds list', () => {
    const subset = ['create_cylinder', 'add_fillet_to_last'] as const;
    const out = BUILD_INTENT_PROMPT('cylinder r 10 h 20', subset);
    expect(out).toContain('create_cylinder');
    expect(out).toContain('add_fillet_to_last');
    // The kindsLine should NOT include unrelated kinds.
    expect(out).toMatch(/\[create_cylinder,\s*add_fillet_to_last\]/);
  });
});
