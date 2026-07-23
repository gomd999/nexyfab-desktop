/**
 * scadExemplars.test.ts — few-shot exemplar routing.
 *
 * The hard-tier `hexbolt` generation fixture failed with intent=None / no solid
 * because there was NO bolt exemplar for the model to pattern-match — it improvised
 * and produced nothing renderable. This locks in that fastener prompts now route to
 * the `hex-bolt` exemplar, WITHOUT stealing flange/other prompts.
 */
import { describe, it, expect } from 'vitest';
import { pickExemplar, SCAD_EXEMPLARS } from '../scadExemplars';

describe('pickExemplar — fastener routing', () => {
  it('the fixture prompt routes to hex-bolt', () => {
    expect(pickExemplar('a hex head bolt, M10, 30 mm shank length')?.id).toBe('hex-bolt');
  });

  it('a bare machine screw routes to hex-bolt', () => {
    expect(pickExemplar('an M8 machine screw')?.id).toBe('hex-bolt');
  });

  it('Korean 육각볼트 routes to hex-bolt', () => {
    expect(pickExemplar('M6 육각 볼트')?.id).toBe('hex-bolt');
  });

  it('a bolt-circle flange still routes to flange (no fastener regression)', () => {
    expect(pickExemplar('a pipe flange with a bolt circle, 6 bolts')?.id).toBe('flange');
  });

  it('unrelated prompts are unaffected', () => {
    expect(pickExemplar('a decorative vase')?.id).toBe('vase');
    expect(pickExemplar('an L-bracket')?.id).toBe('l-bracket');
  });
});

describe('exemplar library integrity', () => {
  it('every exemplar has a unique id, keywords, and non-empty scad', () => {
    const ids = new Set<string>();
    for (const ex of SCAD_EXEMPLARS) {
      expect(ex.id).toBeTruthy();
      expect(ids.has(ex.id)).toBe(false);
      ids.add(ex.id);
      expect(ex.keywords.length).toBeGreaterThan(0);
      expect(ex.scad.trim().length).toBeGreaterThan(0);
    }
  });
});
