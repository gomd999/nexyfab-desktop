/**
 * Geometric validation for polygon profile inputs. Real OCCT smoke
 * (extrude actually consumes the chain) belongs to W12 soak.
 */

import { describe, it, expect } from 'vitest';
import { validatePolygonGeometry } from './_polygon.js';

describe('validatePolygonGeometry', () => {
  it('accepts a triangle (minimum vertex count)', () => {
    expect(() => validatePolygonGeometry([[0, 0], [10, 0], [5, 10]])).not.toThrow();
  });

  it('accepts an L-shape (6 vertices)', () => {
    expect(() => validatePolygonGeometry([
      [0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10],
    ])).not.toThrow();
  });

  it('rejects < 3 points', () => {
    expect(() => validatePolygonGeometry([[0, 0], [10, 0]]))
      .toThrow(/needs ≥ 3 points/);
  });

  it('rejects non-finite coords', () => {
    expect(() => validatePolygonGeometry([[0, 0], [NaN, 0], [0, 10]]))
      .toThrow(/non-finite/);
    expect(() => validatePolygonGeometry([[0, 0], [Infinity, 0], [0, 10]]))
      .toThrow(/non-finite/);
  });

  it('rejects explicit closure duplicate', () => {
    // Caller closed manually — would emit a zero-length edge that
    // OCCT chokes on. We surface a clean 400 instead.
    expect(() => validatePolygonGeometry([[0, 0], [10, 0], [0, 10], [0, 0]]))
      .toThrow(/identical/);
  });

  it('allows visually-close-but-not-equal first/last', () => {
    // Only exact equality is rejected; near-zero gaps are fine and
    // OCCT will close them via the close() call.
    expect(() => validatePolygonGeometry([[0, 0], [10, 0], [0, 10], [0, 0.0001]]))
      .not.toThrow();
  });
});
