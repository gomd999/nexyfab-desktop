import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_FEATURES,
  SUPPORTED_SHAPES,
  looksLikeOpenScad,
  normalizeFreeformScad,
  numParams,
  parseAssemblyParts,
  parseFeatures,
  parseProfile,
} from './intentParsing';

describe('SCAD intent model-output parsing', () => {
  it('keeps only finite numeric parameters and supported features', () => {
    expect(numParams({ width: 20, text: '20', nan: Number.NaN, inf: Number.POSITIVE_INFINITY }))
      .toEqual({ width: 20 });
    expect(parseFeatures([
      { type: SUPPORTED_FEATURES[0], depth: 3 },
      { type: 'unsupported-feature' },
      null,
    ])).toEqual([{ type: SUPPORTED_FEATURES[0], depth: 3 }]);
  });

  it('accepts only finite two-dimensional profile points', () => {
    expect(parseProfile([
      { x: 0, y: 1 },
      { x: Number.NaN, y: 2 },
      { x: 3, y: '4' },
      null,
    ])).toEqual([{ x: 0, y: 1 }]);
  });

  it('whitelists assembly shapes and normalizes optional transforms', () => {
    expect(parseAssemblyParts([
      {
        name: 'valid',
        shapeId: SUPPORTED_SHAPES[0],
        params: { width: 20, bad: '20' },
        features: [{ type: SUPPORTED_FEATURES[0] }, { type: 'unknown' }],
        position: [1, 2, 3],
        rotation: [0, Number.NaN, 90],
      },
      { shapeId: 'not-supported', params: {} },
    ])).toEqual([{
      name: 'valid',
      shapeId: SUPPORTED_SHAPES[0],
      params: { width: 20 },
      features: [{ type: SUPPORTED_FEATURES[0] }],
      position: [1, 2, 3],
    }]);
  });

  it('requires at least three valid points before attaching a sketch profile', () => {
    expect(parseAssemblyParts([
      { shapeId: 'sketch', profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { shapeId: 'sketch', profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    ])).toEqual([
      { shapeId: 'sketch', params: {}, features: [] },
      {
        shapeId: 'sketch',
        params: {},
        features: [],
        profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      },
    ]);
  });

  it('normalizes fenced model output and recognizes plausible OpenSCAD', () => {
    const normalized = normalizeFreeformScad('prefix\n```openscad\r\ncube([1,2,3]);\r\n```\nsuffix');
    expect(normalized).toBe('cube([1,2,3]);');
    expect(looksLikeOpenScad(normalized)).toBe(true);
    expect(looksLikeOpenScad('This is not source code.')).toBe(false);
  });
});
