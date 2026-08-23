import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildDXFText,
  buildFlatPatternDXFString,
  buildFlatPatternDXFText,
  flatPatternToDXFEntities,
} from './dxfExporter';
import type { FlatPatternResult } from '../features/sheetMetal';

function samplePattern(): FlatPatternResult {
  return {
    geometry: new THREE.BoxGeometry(80, 1, 160),
    width: 80,
    length: 214.25,
    thickness: 2,
    material: 'mildSteel',
    bendTable: [
      { index: 0, position: 27, angle: 90, radius: 3, direction: 'up', bendAllowance: 3.625, bendDeduction: 2.375, kFactor: 0.42 },
      { index: 1, position: 190.625, angle: 90, radius: 3, direction: 'up', bendAllowance: 3.625, bendDeduction: 2.375, kFactor: 0.42 },
    ],
    warnings: [],
  };
}

describe('headless flat-pattern DXF contract', () => {
  it('serializes the cut, both bend lines, and bend-table text without a DOM', () => {
    const pattern = samplePattern();
    const entities = flatPatternToDXFEntities(pattern);
    const text = buildFlatPatternDXFText(pattern);
    expect(text).toContain('SECTION');
    expect(text).toContain('CUT');
    expect(text).toContain('BEND_UP');
    expect(text).toContain('BEND TABLE  mildSteel');
    expect((text.match(/\n  0\nLINE\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(buildFlatPatternDXFString(pattern)).toBe(text);
    expect(buildDXFText(entities)).toBe(text);
  });
});
