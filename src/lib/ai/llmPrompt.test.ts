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
  BUILD_INTENT_SYSTEM_PROMPT,
  BUILD_INTENT_USER_PROMPT,
  SCHEMA_SKETCH,
  INTENT_EXAMPLES,
} from './llmPrompt';
import { INTENT_KINDS } from './featureTreeIntentDetector';

describe('BUILD_INTENT_PROMPT — basic shape', () => {
  it('separates the stable cache prefix from dynamic context and user text', () => {
    const system = BUILD_INTENT_SYSTEM_PROMPT();
    const user = BUILD_INTENT_USER_PROMPT('make it 20mm', {
      baseShape: 'box',
      features: [],
      selection: null,
    });
    expect(system).toContain('## Allowed intent kinds');
    expect(system).not.toContain('make it 20mm');
    expect(user).toContain('make it 20mm');
    expect(user).toContain('## Current model');
  });

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

  it('omits the model-context section when no context is given', () => {
    const out = BUILD_INTENT_PROMPT('add a fillet');
    expect(out).not.toContain('## Current model');
  });

  it('embeds the model context (features + selection) when provided', () => {
    const out = BUILD_INTENT_PROMPT('make it 8mm', undefined, {
      baseShape: 'box',
      features: [{ id: 'f1', type: 'fillet', params: { radius: 3 } }],
      selection: { kind: 'face', label: '+Y Top' },
    });
    expect(out).toContain('## Current model');
    expect(out).toContain('fillet');
    expect(out).toContain('[id=f1]');
    expect(out).toContain('+Y Top');
  });
});

describe('BUILD_INTENT_PROMPT — covers all 18 INTENT_KINDS', () => {
  const out = BUILD_INTENT_PROMPT('box 50x50x30');

  for (const kind of INTENT_KINDS) {
    it(`mentions kind "${kind}"`, () => {
      expect(out).toContain(kind);
    });
  }

  it('lists exactly 18 kinds in the allowed list', () => {
    expect(INTENT_KINDS).toHaveLength(18);
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
