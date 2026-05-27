/**
 * SVG path parser unit tests. Goal: prove that the common engineering
 * 2D shapes (L bracket, U channel, rectangle with chamfered corner)
 * survive a roundtrip through parseSvgPath into a valid polygon
 * vertex list.
 */

import { describe, it, expect } from 'vitest';
import { parseSvgPath } from './_svg.js';

describe('parseSvgPath — happy path', () => {
  it('parses a simple absolute rectangle', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,5 L 0,5 Z');
    expect(out.closed).toBe(true);
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('parses an L bracket (6 vertices)', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,3 L 3,3 L 3,10 L 0,10 Z');
    expect(out.points).toHaveLength(6);
  });

  it('handles H / V shortcuts', () => {
    const out = parseSvgPath('M 0,0 H 10 V 5 H 0 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('handles relative l', () => {
    const out = parseSvgPath('M 5,5 l 10,0 l 0,10 l -10,0 Z');
    expect(out.points).toEqual([[5, 5], [15, 5], [15, 15], [5, 15]]);
  });

  it('handles relative m at start (treated as absolute M)', () => {
    const out = parseSvgPath('m 2,2 l 5,0 l 0,5 l -5,0 z');
    expect(out.points).toEqual([[2, 2], [7, 2], [7, 7], [2, 7]]);
  });

  it('handles implicit-L pairs after M', () => {
    // SVG spec: pairs after the initial M coords are implicit L.
    const out = parseSvgPath('M 0,0 10,0 10,5 0,5 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('drops trailing explicit close-duplicate vertex', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,5 L 0,5 L 0,0 Z');
    // The trailing L 0,0 duplicates the start; we drop it so the
    // polygon validator's "first != last" rule passes.
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('accepts comma + whitespace separators interchangeably', () => {
    const out = parseSvgPath('M0,0 L 10 0 L10,5 L 0 5 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });
});

describe('parseSvgPath — error paths', () => {
  it('rejects empty path', () => {
    expect(() => parseSvgPath('')).toThrow(/non-empty/);
    expect(() => parseSvgPath('   ')).toThrow(/non-empty/);
  });

  it('rejects path with no M', () => {
    expect(() => parseSvgPath('L 0,0 L 10,0 Z')).toThrow(/missing initial M/);
  });

  it('rejects unclosed path', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5'))
      .toThrow(/must end with Z/);
  });

  it('rejects bezier commands', () => {
    expect(() => parseSvgPath('M 0,0 C 5,0 10,5 10,10 Z'))
      .toThrow(/Bezier\/arc/);
    expect(() => parseSvgPath('M 0,0 Q 5,5 10,0 Z'))
      .toThrow(/Bezier\/arc/);
  });

  it('rejects arc commands', () => {
    expect(() => parseSvgPath('M 0,0 A 5,5 0 0,1 10,10 Z'))
      .toThrow(/Bezier\/arc/);
  });

  it('rejects multi-subpath', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5 Z M 20,20 L 30,20 L 30,25 Z'))
      .toThrow(/multi-subpath/);
  });

  it('rejects degenerate (< 3 vertices after closure)', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 Z')).toThrow(/≥ 3/);
  });
});
