import { describe, it, expect } from 'vitest';
import type { OcctTessellation } from '@/lib/occt/types';
import { tessellationToShapeResult } from './thickenKSeries';

/** One flat-shaded triangle (3 verts) + a 2-segment edge loop. */
function fakeTess(): OcctTessellation {
  return {
    positions: [0, 0, 0, 10, 0, 0, 10, 10, 0], // 3 verts → 1 triangle
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    edges: [0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0], // 2 segments
    triangleCount: 1,
    edgeCount: 2,
    bounds: { center: [5, 5, 0], size: [10, 10, 0], radius: 7.07 },
  };
}

describe('tessellationToShapeResult — kernel tessellation → ShapeResult', () => {
  it('packs positions/normals into a geometry and edges into edgeGeometry', () => {
    const r = tessellationToShapeResult(fakeTess());
    expect(r.geometry.getAttribute('position').count).toBe(3); // 9 floats / 3
    expect(r.geometry.getAttribute('normal').count).toBe(3);
    expect(r.edgeGeometry.getAttribute('position').count).toBe(4); // 12 floats / 3
  });

  it('converts kernel volume (mm³) to volume_cm3', () => {
    const r = tessellationToShapeResult(fakeTess(), { volumeMm3: 200 });
    expect(r.volume_cm3).toBeCloseTo(0.2); // 200 mm³ = 0.2 cm³
  });

  it('prefers the exact kernel bbox over the tessellation bounds', () => {
    const r = tessellationToShapeResult(fakeTess(), {
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 2 } },
    });
    expect(r.bbox).toEqual({ w: 10, h: 10, d: 2 });
  });

  it('falls back to tessellation bounds.size when no kernel bbox is given', () => {
    const r = tessellationToShapeResult(fakeTess());
    expect(r.bbox).toEqual({ w: 10, h: 10, d: 0 });
  });

  it('computes vertex normals when the normals array is mismatched', () => {
    const t = fakeTess();
    t.normals = []; // force the computeVertexNormals fallback
    const r = tessellationToShapeResult(t);
    expect(r.geometry.getAttribute('normal').count).toBe(3); // computed, not crashed
  });
});
