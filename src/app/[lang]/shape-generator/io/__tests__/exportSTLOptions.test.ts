import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Stub the platform downloader so we can capture the resulting blob/filename
// without touching the DOM.
const downloads: Array<{ name: string; bytes: number }> = [];
vi.mock('@/lib/platform', () => ({
  downloadBlob: async (filename: string, blob: Blob) => {
    downloads.push({ name: filename, bytes: blob.size });
  },
  PREF_KEYS: {},
  prefGetString: () => '',
  prefSetString: () => {},
  prefRemove: () => {},
}));

import { exportSTL } from '../../topology/optimizer/stlExporter';

function makeBox(size = 10): THREE.BufferGeometry {
  // 10x10x10 cube centered at origin — easy bounds to assert against.
  return new THREE.BoxGeometry(size, size, size);
}

describe('exportSTL options', () => {
  beforeEach(() => { downloads.length = 0; });

  it('default export uses original filename (no suffix)', async () => {
    await exportSTL(makeBox(), 'cube.stl');
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('cube.stl');
  });

  it('cm unit annotates filename', async () => {
    await exportSTL(makeBox(), 'cube.stl', { unit: 'cm' });
    expect(downloads[0].name).toBe('cube_cm.stl');
  });

  it('m unit + centered origin annotates both', async () => {
    await exportSTL(makeBox(), 'cube.stl', { unit: 'm', origin: 'centered' });
    expect(downloads[0].name).toBe('cube_m_centered.stl');
  });

  it('feet-on-floor origin annotates filename', async () => {
    await exportSTL(makeBox(), 'cube.stl', { origin: 'feet-on-floor' });
    expect(downloads[0].name).toBe('cube_feet-on-floor.stl');
  });

  it('does not mutate the source geometry on transform', async () => {
    const geo = makeBox(10);
    geo.computeBoundingBox();
    const beforeMin = geo.boundingBox!.min.clone();
    await exportSTL(geo, 'cube.stl', { unit: 'm', origin: 'centered' });
    geo.computeBoundingBox();
    // Source bbox should still be the original mm-scale box (-5..+5).
    expect(geo.boundingBox!.min.x).toBeCloseTo(beforeMin.x, 4);
    expect(geo.boundingBox!.min.y).toBeCloseTo(beforeMin.y, 4);
  });

  it('produces a non-empty STL buffer', async () => {
    await exportSTL(makeBox(), 'cube.stl');
    // Binary STL = 80 byte header + 4 byte count + 50 bytes/triangle × 12 tris = 684
    expect(downloads[0].bytes).toBeGreaterThan(80 + 4);
  });
});
