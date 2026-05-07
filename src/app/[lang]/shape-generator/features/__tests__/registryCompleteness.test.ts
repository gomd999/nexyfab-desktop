import { describe, expect, it } from 'vitest';
import { FEATURE_DEFS, FEATURE_MAP } from '../index';
import type { FeatureType, MapBackedFeatureType } from '../types';

function allMapBackedFeatureTypes(): MapBackedFeatureType[] {
  const all: FeatureType[] = [
    'sketch',
    'fillet',
    'chamfer',
    'shell',
    'hole',
    'linearPattern',
    'circularPattern',
    'mirror',
    'boolean',
    'draft',
    'scale',
    'moveCopy',
    'splitBody',
    'bend',
    'flange',
    'flatPattern',
    'variableFillet',
    'boundarySurface',
    'sketchExtrude',
    'revolve',
    'sweep',
    'loft',
    'thread',
    'moldTools',
    'weldment',
    'nurbsSurface',
  ];
  return all.filter((t): t is MapBackedFeatureType => t !== 'sketchExtrude');
}

describe('FEATURE_MAP / FEATURE_DEFS', () => {
  it('lists every MapBackedFeatureType exactly once (update list when adding a feature type)', () => {
    const expected = new Set(allMapBackedFeatureTypes());
    const fromDefs = new Set(FEATURE_DEFS.map(d => d.type));
    const fromMap = new Set(
      Object.keys(FEATURE_MAP) as MapBackedFeatureType[],
    );
    expect(fromDefs).toEqual(expected);
    expect(fromMap).toEqual(expected);
    expect(FEATURE_DEFS.length).toBe(expected.size);
  });

  it('never registers sketchExtrude in the map (handled in pipelineManager)', () => {
    expect(FEATURE_DEFS.map(d => d.type)).not.toContain('sketchExtrude');
    expect('sketchExtrude' in FEATURE_MAP).toBe(false);
  });
});
