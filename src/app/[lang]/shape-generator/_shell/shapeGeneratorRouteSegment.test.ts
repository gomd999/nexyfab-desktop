import { describe, expect, it } from 'vitest';
import { shapeGeneratorRouteSegment } from './shapeGeneratorRouteSegment';

describe('shapeGeneratorRouteSegment', () => {
  it.each([
    ['/en/shape-generator/sketch', 'sketch'],
    ['/kr/shape-generator/analysis/results', 'analysis'],
    ['/shape-generator/3d-edit', '3d-edit'],
    ['/en/shape-generator', null],
    ['/en/studio/sketch', null],
    [null, null],
  ] as const)('maps %s to %s', (pathname, expected) => {
    expect(shapeGeneratorRouteSegment(pathname)).toBe(expected);
  });
});
