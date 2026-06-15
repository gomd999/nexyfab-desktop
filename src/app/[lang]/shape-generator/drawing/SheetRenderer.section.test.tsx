import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SheetRenderer } from './SheetRenderer';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Polyhedron } from '@/lib/cad/featureMesh';
import type { CuttingPlane } from './sectionView';

// 20mm cube centered at the origin (−10..10 on every axis), 6 quad faces.
function centeredCube(): Polyhedron {
  return {
    vertices: [
      { x: -10, y: -10, z: -10 }, { x: 10, y: -10, z: -10 }, { x: 10, y: 10, z: -10 }, { x: -10, y: 10, z: -10 },
      { x: -10, y: -10, z: 10 }, { x: 10, y: -10, z: 10 }, { x: 10, y: 10, z: 10 }, { x: -10, y: 10, z: 10 },
    ],
    faces: [
      { vertices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 } },
      { vertices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
      { vertices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
      { vertices: [2, 3, 7, 6], normal: { x: 0, y: 1, z: 0 } },
      { vertices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
      { vertices: [0, 3, 7, 4], normal: { x: -1, y: 0, z: 0 } },
    ],
  };
}

function sectionSheet(cuttingPlaneId: string): Sheet {
  return {
    id: 's1',
    name: 'section test',
    paperSize: 'A4',
    viewports: [{
      id: 'sv',
      sourceId: 'cube',
      projection: { kind: 'section', cuttingPlaneId },
      centerOnSheet: { x: 100, y: 100 },
      widthOnSheet: 60,
      scale: 1,
      label: 'SECTION A-A',
    }],
  };
}

describe('SheetRenderer — section cross-section (generateSection wiring)', () => {
  it('draws the real cross-section outline when a section viewport has geometry + a cutting plane', () => {
    const geometry = new Map<string, Polyhedron>([['cube', centeredCube()]]);
    const cuttingPlanes = new Map<string, CuttingPlane>([
      ['cp1', { origin: [0, 0, 0], normal: [0, 0, 1] }], // Z=0 plane → 20×20 square section
    ]);

    const svg = renderToStaticMarkup(
      <SheetRenderer sheet={sectionSheet('cp1')} geometry={geometry} cuttingPlanes={cuttingPlanes} />,
    );

    expect(svg).toContain('sheet-renderer-section-geometry-sv');
    expect(svg).toContain('section-outline-sv-0');
    // The cross-section must be a closed path with real coordinates, not the placeholder.
    expect(svg).toMatch(/section-outline-sv-0[^>]*d="M /);
  });

  it('falls back to indicator arrows only (no outline) when no cutting plane is supplied — back-compat', () => {
    const geometry = new Map<string, Polyhedron>([['cube', centeredCube()]]);
    const svg = renderToStaticMarkup(
      <SheetRenderer sheet={sectionSheet('cp-missing')} geometry={geometry} />, // no cuttingPlanes prop
    );
    expect(svg).not.toContain('section-outline');
    // The cutting-plane arrows indicator still renders.
    expect(svg).toContain('sheet-renderer-section-arrows-sv');
  });
});
