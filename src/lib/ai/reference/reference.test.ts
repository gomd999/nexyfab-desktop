/**
 * Lever C — reference grounding tests.
 *
 * Covers, deterministically (no live LLM):
 *   1. Retrieval relevance — a flanged/cylindrical query surfaces cylinder-heavy
 *      refs; a plate-with-holes query surfaces plate refs; the KDS retriever
 *      returns the governing clause for beam/wall queries.
 *   2. Injection — the geometry planners' messages CONTAIN the cited ref block
 *      for a grounded brief, and gracefully omit it when nothing matches.
 *   3. Honesty — the injected block is labeled NON-AUTHORITATIVE, and no
 *      retrieved number is promoted into the plan (the coerce gate stays
 *      authoritative: plan values come from the model JSON, not the refs).
 */
import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@/lib/ai';
import {
  retrieveReferenceParts,
  formatReferencePartsBlock,
  REFERENCE_PART_COUNT,
} from './retrieveReferenceParts';
import {
  retrieveKdsClauses,
  formatKdsClausesBlock,
  KDS_CLAUSE_SPEC_COUNT,
} from './retrieveKdsClauses';
import { makeLlmPlanner } from '../design-driver/llmPlanner';
import { lBracketPlan } from '../design-driver/fixturePlanner';
import { makeCivilLlmPlanner } from '../../eng-domain/civil/llmPlanner';

function userContent(messages: ChatMessage[]): string {
  const m = messages.find((x) => x.role === 'user');
  return typeof m?.content === 'string' ? m.content : '';
}

describe('reference index sanity', () => {
  it('distilled a substantial part index and a clause-bearing catalog subset', () => {
    expect(REFERENCE_PART_COUNT).toBeGreaterThan(500);
    expect(KDS_CLAUSE_SPEC_COUNT).toBeGreaterThan(5);
  });
});

describe('retrieveReferenceParts — structured relevance', () => {
  it('surfaces cylinder-dominant refs for a flanged/cylindrical query', () => {
    const refs = retrieveReferenceParts(
      {
        text: 'a round flange with a bolt circle and central bore',
        aspect: 'complex',
        surfaceTypes: { cylinder: 24, plane: 6 },
        holeSig: { count: 6 },
      },
      3,
    );
    expect(refs.length).toBeGreaterThan(0);
    // at least one top ref is cylinder-forward (descriptor mentions cylinder)
    expect(refs.some((r) => /cylinder/i.test(r.name))).toBe(true);
  });

  it('surfaces plate refs for a flat-plate-with-holes query', () => {
    const refs = retrieveReferenceParts(
      {
        text: 'a flat mounting plate with four bolt holes',
        aspect: 'plate',
        surfaceTypes: { plane: 30, cylinder: 6 },
        holeSig: { count: 4 },
      },
      3,
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => /plate/i.test(r.name))).toBe(true);
  });

  it('returns [] for a no-signal query (no fabricated ref)', () => {
    expect(retrieveReferenceParts({})).toEqual([]);
    expect(retrieveReferenceParts({ text: '' })).toEqual([]);
    expect(formatReferencePartsBlock([])).toBe('');
  });

  it('labels the block NON-AUTHORITATIVE', () => {
    const block = formatReferencePartsBlock(
      retrieveReferenceParts({ text: 'cylindrical shaft', aspect: 'rod' }),
    );
    expect(block).toContain('NOT authoritative');
    expect(block.toLowerCase()).toContain('never copy');
  });
});

describe('retrieveKdsClauses — clause relevance', () => {
  it('returns a governing clause for a beam query', () => {
    const clauses = retrieveKdsClauses('reinforced concrete beam bending and shear design', 3);
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses[0].clause).toMatch(/K[DC]S/);
  });

  it('returns a governing clause for an earth-retention wall query', () => {
    // The catalog cites a numbered clause for temporary earth-retention (흙막이)
    // walls (KDS 21 30 00); gravity-wall specs carry no numbered clause, so we
    // query the clause-bearing wall family.
    const clauses = retrieveKdsClauses('temporary earth retention wall with struts, embedment and heaving check', 3);
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses.every((c) => /K[DC]S/.test(c.clause))).toBe(true);
  });

  it('returns [] for empty text and formats an empty block to ""', () => {
    expect(retrieveKdsClauses('')).toEqual([]);
    expect(formatKdsClausesBlock([])).toBe('');
  });

  it('labels the clause block CITE / non-authoritative', () => {
    const block = formatKdsClausesBlock(retrieveKdsClauses('steel column buckling'));
    expect(block).toContain('KDS');
    expect(block).toContain('do NOT invent');
  });
});

describe('injection into geometry planner (design-driver)', () => {
  it('appends the cited ref block to the user message for a grounded brief', async () => {
    let seen: ChatMessage[] = [];
    const planner = makeLlmPlanner({
      complete: async (messages) => {
        seen = messages;
        return '{"error":"unsupported","reason":"stub"}';
      },
    });
    await expect(
      planner.plan({ id: 'b1', text: 'design a round flange with a 6-bolt circle' }),
    ).rejects.toThrow();
    const user = userContent(seen);
    expect(user).toContain('Reference parts');
    expect(user).toContain('NOT authoritative');
    // the system prompt carries the one grounding sentence
    const sys = seen.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('NON-AUTHORITATIVE');
  });

  it('does NOT promote a retrieved number into the plan (gate stays authoritative)', async () => {
    // The model returns a KNOWN fixture plan; even with a ref block injected,
    // the coerced plan's values must come from the model JSON, not the refs.
    let seen: ChatMessage[] = [];
    const fixture = lBracketPlan();
    const planner = makeLlmPlanner({
      complete: async (messages) => {
        seen = messages;
        return JSON.stringify(fixture);
      },
    });
    // Use a brief that DOES ground (round flange/plate with holes) so a ref
    // block is injected — then prove the plan values still come from the model.
    const plan = await planner.plan({
      id: 'b2',
      text: 'design a round flange plate with a bolt circle and holes',
    });
    expect(plan.name).toBe(fixture.name); // value sourced from the model, unchanged
    expect(plan.parts.length).toBe(fixture.parts.length);
    // and the injected ref block WAS present in the prompt
    expect(userContent(seen)).toContain('Reference parts');
  });
});

describe('injection into eng-domain planner (civil, KDS clauses)', () => {
  it('appends the cited KDS clause block to the user message', async () => {
    let seen: ChatMessage[] = [];
    const planner = makeCivilLlmPlanner({
      complete: async (messages) => {
        seen = messages;
        return '{"error":"unsupported","reason":"stub"}';
      },
    });
    await expect(
      planner({ id: 'c1', text: 'check a steel beam spanning 6 m under UDL' }),
    ).rejects.toThrow();
    const user = userContent(seen);
    expect(user).toContain('KDS');
    expect(user).toContain('do NOT invent');
    const sys = seen.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('NON-AUTHORITATIVE');
  });
});
