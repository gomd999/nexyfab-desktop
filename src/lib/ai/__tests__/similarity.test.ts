import { describe, it, expect } from 'vitest';
import { tokenize, frequencyVector, cosineSimilarity, pairwiseSimilarity } from '../similarity';

describe('tokenize', () => {
  it('lowercases and splits Latin words', () => {
    expect(tokenize('Hello WORLD foo')).toEqual(['hello', 'world', 'foo']);
  });

  it('drops single-char tokens and stopwords', () => {
    const r = tokenize('A cat is a friendly animal');
    expect(r).not.toContain('a');
    expect(r).not.toContain('is');
    expect(r).toContain('cat');
    expect(r).toContain('friendly');
    expect(r).toContain('animal');
  });

  it('emits CJK bigrams for Korean', () => {
    const r = tokenize('한국어 입니다');
    // "한국어" → ["한국", "국어"] · "입니다" → ["입니", "니다"]
    expect(r).toContain('한국');
    expect(r).toContain('국어');
    expect(r).toContain('입니');
    expect(r).toContain('니다');
  });

  it('handles empty / non-string input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical text', () => {
    const a = frequencyVector('the quick brown fox');
    const b = frequencyVector('the quick brown fox');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('returns 0 for disjoint vocabularies', () => {
    const a = frequencyVector('apple banana cherry');
    const b = frequencyVector('xenon yttrium zirconium');
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 when either vector is empty', () => {
    const empty = frequencyVector('');
    const nonempty = frequencyVector('hello world');
    expect(cosineSimilarity(empty, nonempty)).toBe(0);
    expect(cosineSimilarity(nonempty, empty)).toBe(0);
  });

  it('returns mid-range value for partial overlap', () => {
    const a = frequencyVector('flange with bolt holes');
    const b = frequencyVector('flange with screw holes');
    const s = cosineSimilarity(a, b);
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  it('is symmetric', () => {
    const a = frequencyVector('alpha beta gamma');
    const b = frequencyVector('beta gamma delta');
    const ab = cosineSimilarity(a, b);
    const ba = cosineSimilarity(b, a);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('CJK bigrams contribute to similarity', () => {
    const a = frequencyVector('한국 어 입니다');
    const b = frequencyVector('한국 입니다 정말');
    const s = cosineSimilarity(a, b);
    expect(s).toBeGreaterThan(0);
  });
});

describe('pairwiseSimilarity', () => {
  it('returns identity matrix shape', () => {
    const m = pairwiseSimilarity(['hello', 'world', 'foobar']);
    expect(m).toHaveLength(3);
    for (const row of m) expect(row).toHaveLength(3);
  });

  it('diagonal is 1', () => {
    const m = pairwiseSimilarity(['a b c', 'd e f', 'g h i']);
    for (let i = 0; i < m.length; i++) {
      expect(m[i][i]).toBe(1);
    }
  });

  it('is symmetric', () => {
    const m = pairwiseSimilarity(['foo bar baz', 'bar baz qux', 'qux quux']);
    for (let i = 0; i < m.length; i++) {
      for (let j = 0; j < m.length; j++) {
        expect(m[i][j]).toBeCloseTo(m[j][i], 10);
      }
    }
  });

  it('handles empty strings (zeros except diagonal)', () => {
    const m = pairwiseSimilarity(['hello world', '', 'world hello']);
    expect(m[0][1]).toBe(0);
    expect(m[1][0]).toBe(0);
    expect(m[0][2]).toBeGreaterThan(0);
  });

  it('rounds to 3 decimal places for stable storage', () => {
    const m = pairwiseSimilarity(['the quick brown fox', 'the quick brown dog']);
    for (const row of m) {
      for (const v of row) {
        // No more than 3 decimal digits.
        expect(Math.abs(v - Math.round(v * 1000) / 1000)).toBeLessThan(1e-9);
      }
    }
  });
});
