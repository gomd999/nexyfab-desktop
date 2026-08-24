import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDIO_VIEW_STATE,
  createStudioViewRestorePatch,
  createStudioViewSnapshot,
} from './studioViewController';

describe('GP-08 studio view persistence controller', () => {
  it('omits the complete default view', () => {
    expect(createStudioViewSnapshot({ ...DEFAULT_STUDIO_VIEW_STATE })).toBeUndefined();
  });

  it('preserves section, split-view and a paired finite camera', () => {
    const snapshot = createStudioViewSnapshot({
      ...DEFAULT_STUDIO_VIEW_STATE,
      sectionActive: true,
      sectionAxis: 'z',
      sectionOffset: 0.75,
      sketchSlicePalette: true,
      sketchSlicePlaneMm: 125,
      multiView: true,
      camera: { position: [1, 2, 3], target: [4, 5, 6] },
    });
    expect(snapshot).toEqual({
      sectionActive: true, sectionAxis: 'z', sectionOffset: 0.75,
      sketchSlicePalette: true, sketchSlicePlaneMm: 125, multiView: true,
      cameraPosition: [1, 2, 3], cameraTarget: [4, 5, 6],
    });
    expect(createStudioViewRestorePatch(snapshot)).toEqual({
      sectionActive: true, sectionAxis: 'z', sectionOffset: 0.75,
      sketchSlicePalette: true, sketchSlicePlaneMm: 125, multiView: true,
      camera: { position: [1, 2, 3], target: [4, 5, 6] }, suppressGeometryFit: true,
    });
  });

  it('restores missing snapshots to the documented defaults', () => {
    expect(createStudioViewRestorePatch(undefined)).toEqual({
      sectionActive: false, sectionAxis: 'y', sectionOffset: 0.5,
      sketchSlicePalette: false, sketchSlicePlaneMm: 60, multiView: false,
      camera: null, suppressGeometryFit: false,
    });
  });

  it('clamps a finite section offset and rejects half or non-finite cameras', () => {
    expect(createStudioViewRestorePatch({
      sectionActive: true, sectionAxis: 'x', sectionOffset: 2,
      sketchSlicePalette: false, sketchSlicePlaneMm: 60, multiView: false,
      cameraPosition: [1, 2, 3],
    })).toMatchObject({ sectionOffset: 1, camera: null, suppressGeometryFit: false });
    expect(createStudioViewSnapshot({
      ...DEFAULT_STUDIO_VIEW_STATE,
      camera: { position: [1, 2, Number.NaN], target: [4, 5, 6] },
    })).toBeUndefined();
  });

  it('does not execute accessors and fails malformed snapshots to defaults', () => {
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'sectionActive', { enumerable: true, get: () => { reads += 1; return true; } });
    expect(createStudioViewRestorePatch(accessor)).toEqual(createStudioViewRestorePatch(undefined));
    expect(reads).toBe(0);
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(() => createStudioViewRestorePatch(hostile)).not.toThrow();
    expect(createStudioViewRestorePatch(hostile)).toEqual(createStudioViewRestorePatch(undefined));
  });
});
