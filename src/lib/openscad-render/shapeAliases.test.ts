// @vitest-environment node
/**
 * shapeAliases drift guard — every aliased id must be a real compiler-supported
 * shape / feature, so a typo or a renamed shape can't ship a glossary entry
 * that points the LLM at a non-existent id. Also checks each entry actually
 * carries cross-language (non-ASCII) synonyms, since that's its whole purpose.
 */
import { describe, it, expect } from 'vitest';
import { SHAPE_ALIASES, FEATURE_ALIASES, renderAliasGlossary, detectShapeFromText } from './shapeAliases';
import { SUPPORTED_SHAPES, SUPPORTED_FEATURES } from './intentToScad';

const hasNonAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return true;
  return false;
};

describe('SHAPE_ALIASES', () => {
  for (const id of Object.keys(SHAPE_ALIASES)) {
    it(`"${id}" is a real SUPPORTED_SHAPES id`, () => {
      expect(SUPPORTED_SHAPES.has(id)).toBe(true);
    });
    it(`"${id}" has multiple synonyms incl. cross-language ones`, () => {
      const syns = SHAPE_ALIASES[id]!;
      expect(syns.length).toBeGreaterThan(2);
      expect(syns.some(hasNonAscii)).toBe(true);
    });
  }
});

describe('FEATURE_ALIASES', () => {
  for (const id of Object.keys(FEATURE_ALIASES)) {
    it(`"${id}" is a real SUPPORTED_FEATURES type`, () => {
      expect(SUPPORTED_FEATURES.has(id)).toBe(true);
    });
    it(`"${id}" has multiple synonyms incl. cross-language ones`, () => {
      const syns = FEATURE_ALIASES[id]!;
      expect(syns.length).toBeGreaterThan(2);
      expect(syns.some(hasNonAscii)).toBe(true);
    });
  }
});

describe('renderAliasGlossary', () => {
  it('renders one "id — syn, syn" line per entry', () => {
    const out = renderAliasGlossary({ cylinder: ['cylinder', 'X', 'Y'] });
    expect(out).toBe('  cylinder — cylinder, X, Y');
  });

  it('Korean "원통" maps to cylinder (the original bug)', () => {
    expect(SHAPE_ALIASES.cylinder).toContain('원통');
  });

  it('covers the high-frequency primitives', () => {
    for (const id of ['box', 'cylinder', 'sphere', 'cone', 'pipe', 'gear']) {
      expect(SHAPE_ALIASES[id], `${id} should be aliased`).toBeTruthy();
    }
  });
});

describe('detectShapeFromText (deterministic, origin-independent)', () => {
  it('maps non-English shape words across languages', () => {
    expect(detectShapeFromText('원통 지름 20 높이 50')).toBe('cylinder');       // ko
    expect(detectShapeFromText('直径20 高さ50 の円筒')).toBe('cylinder');        // ja
    expect(detectShapeFromText('直径20 高度50 的圆柱')).toBe('cylinder');        // zh
    expect(detectShapeFromText('un cilindro de 20')).toBe('cylinder');          // es
    expect(detectShapeFromText('أسطوانة قطرها 20')).toBe('cylinder');           // ar
    expect(detectShapeFromText('지름 30 구체')).toBe('sphere');
    expect(detectShapeFromText('원뿔 밑지름 30')).toBe('cone');
    expect(detectShapeFromText('도넛 외경 50')).toBe('torus');
    expect(detectShapeFromText('원판 지름 60')).toBe('disk');
    expect(detectShapeFromText('와셔 외경 20')).toBe('washer');
    expect(detectShapeFromText('歯数24 の歯車')).toBe('gear');
    expect(detectShapeFromText('外径30 的管子')).toBe('pipe');
    expect(detectShapeFromText('육각너트 M8')).toBe('hexNut');
  });

  it('still maps plain English', () => {
    expect(detectShapeFromText('a cylinder diameter 20')).toBe('cylinder');
    expect(detectShapeFromText('M8 hex bolt 30mm')).toBe('bolt');
    expect(detectShapeFromText('a 40mm cube')).toBe('box');
  });

  it('prefers the more specific shape ("rounded box" beats "box")', () => {
    expect(detectShapeFromText('a rounded box 40x30x20')).toBe('roundedBox');
  });

  it('does not false-match a synonym glued inside a longer CJK word (구 ∉ 구멍)', () => {
    // "구멍"(hole) contains "구"(sphere) but must NOT be detected as sphere.
    // No standalone shape word here → null (trust the LLM).
    expect(detectShapeFromText('상자 가운데 구멍')).toBe('box'); // box detected, 구멍 ignored
  });

  it('does not false-match ASCII substrings ("rod" ∉ "rodent")', () => {
    expect(detectShapeFromText('a rodent house')).toBeNull();
  });

  it('returns null when no shape word is present (LLM decides)', () => {
    expect(detectShapeFromText('지름 30 두께 5')).toBeNull();
    expect(detectShapeFromText('make something with 4 holes')).toBeNull();
  });
});
