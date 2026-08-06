// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapOcctGeomAbsEnumName } from './nodeOcctBridge';

describe('OCCT GeomAbs enum adapter', () => {
  const wrapperEnum = {
    values: { 0: {}, 1: {} },
    GeomAbs_Plane: { value: 0 },
    GeomAbs_Cylinder: { value: 1 },
  };

  it('maps direct singleton, wrapper and numeric representations by a unique ordinal', () => {
    expect(mapOcctGeomAbsEnumName(wrapperEnum.GeomAbs_Plane, wrapperEnum)).toBe('plane');
    expect(mapOcctGeomAbsEnumName({ value: 1 }, wrapperEnum)).toBe('cylinder');
    expect(mapOcctGeomAbsEnumName(0, wrapperEnum)).toBe('plane');
    const callableEnum = Object.assign(() => undefined, wrapperEnum);
    expect(mapOcctGeomAbsEnumName({ value: 1 }, callableEnum)).toBe('cylinder');
  });

  it('fails closed for unknown, malformed, or ambiguous wrapper values', () => {
    expect(mapOcctGeomAbsEnumName({ value: 99 }, wrapperEnum)).toBeNull();
    expect(mapOcctGeomAbsEnumName({ value: '0' }, wrapperEnum)).toBeNull();
    expect(mapOcctGeomAbsEnumName(0, { ...wrapperEnum, GeomAbs_OtherSurface: { value: 0 } })).toBeNull();
    expect(mapOcctGeomAbsEnumName(0, null)).toBeNull();
  });
});
