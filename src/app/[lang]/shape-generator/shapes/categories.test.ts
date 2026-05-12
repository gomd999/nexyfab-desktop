import { describe, it, expect } from 'vitest';
import { getShapeCategory, STANDARD_LIBRARY_STRUCTURAL } from './categories';

describe('STANDARD_LIBRARY_STRUCTURAL', () => {
  /** Keep aligned with `library/standardParts.ts` (StandardPart.category === 'structural'). */
  it('lists structural std part ids', () => {
    expect([...STANDARD_LIBRARY_STRUCTURAL].sort()).toEqual(
      ['angleBracket', 'channelBeam', 'iBeam', 'lmGuideRail'].sort(),
    );
  });
});

describe('getShapeCategory', () => {
  it('maps std: library parts by StandardPart.category', () => {
    expect(getShapeCategory('std:hexBolt')).toBe('standard');
    expect(getShapeCategory('std:ballBearing')).toBe('standard');
    expect(getShapeCategory('std:iBeam')).toBe('structural');
    expect(getShapeCategory('std:channelBeam')).toBe('structural');
  });

  it('maps built-in registry ids', () => {
    expect(getShapeCategory('box')).toBe('primitive');
    expect(getShapeCategory('bolt')).toBe('standard');
    expect(getShapeCategory('lBracket')).toBe('structural');
    expect(getShapeCategory('gear')).toBe('manufacturing');
  });
});
