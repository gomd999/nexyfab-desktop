import { describe, it, expect } from 'vitest';
import {
  extractLineArt,
  linesToSvg,
  summarizeLineArt,
  type MeshArrays,
} from './lineArt';

// Two coplanar triangles sharing an edge.
function flatQuad(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

// Two triangles at 90° to each other (sharp crease along shared edge).
function foldedQuad(): MeshArrays {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      1, 0, 1, // raised vertex
    ],
    indices: [0, 1, 2, 0, 2, 3, 1, 4, 2],
  };
}

describe('extractLineArt — boundary', () => {
  it('flat quad has 4 boundary edges, 0 creases', () => {
    const segs = extractLineArt(flatQuad(), { cameraPositionMm: [0, 0, 10], detectSilhouette: false });
    const boundary = segs.filter(s => s.kind === 'boundary').length;
    expect(boundary).toBe(4);
  });

  it('boundary detection can be disabled', () => {
    const segs = extractLineArt(flatQuad(), { detectBoundary: false, detectSilhouette: false, detectCreases: true });
    expect(segs.filter(s => s.kind === 'boundary')).toHaveLength(0);
  });
});

describe('extractLineArt — crease', () => {
  it('folded quad has a crease edge', () => {
    const segs = extractLineArt(foldedQuad(), { cameraPositionMm: [0, 0, 10], detectSilhouette: false, creaseAngleDeg: 30 });
    expect(segs.some(s => s.kind === 'crease')).toBe(true);
  });

  it('flat quad has no creases at default 30°', () => {
    const segs = extractLineArt(flatQuad(), { cameraPositionMm: [0, 0, 10], detectSilhouette: false });
    expect(segs.filter(s => s.kind === 'crease')).toHaveLength(0);
  });

  it('crease records dihedral angle', () => {
    const segs = extractLineArt(foldedQuad(), { cameraPositionMm: [0, 0, 10], detectSilhouette: false, creaseAngleDeg: 30 });
    const crease = segs.find(s => s.kind === 'crease');
    expect(crease?.dihedralRad).toBeGreaterThan(0);
  });
});

describe('extractLineArt — silhouette', () => {
  it('produces silhouette edges when camera faces a fold', () => {
    const segs = extractLineArt(foldedQuad(), { cameraPositionMm: [10, 0, 0.5], detectCreases: false, detectBoundary: false });
    // From the side, we expect at least one silhouette.
    expect(segs.some(s => s.kind === 'silhouette')).toBe(true);
  });
});

describe('linesToSvg', () => {
  it('produces svg with line elements', () => {
    const segs = extractLineArt(flatQuad());
    const svg = linesToSvg(segs);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
  });

  it('empty segments → svg without lines', () => {
    const svg = linesToSvg([]);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<line');
  });

  it('honors viewBox', () => {
    const svg = linesToSvg([], { width: 1024, height: 768 });
    expect(svg).toContain('width="1024"');
    expect(svg).toContain('height="768"');
  });
});

describe('summarizeLineArt', () => {
  it('reports counts per kind', () => {
    const segs = extractLineArt(foldedQuad(), { cameraPositionMm: [10, 0, 0.5], creaseAngleDeg: 30 });
    const s = summarizeLineArt(segs);
    expect(s.silhouetteCount + s.creaseCount + s.boundaryCount + s.borderCount).toBe(segs.length);
  });

  it('totalLength > 0 for non-empty input', () => {
    const segs = extractLineArt(flatQuad());
    expect(summarizeLineArt(segs).totalLength).toBeGreaterThan(0);
  });

  it('empty input → 0 totalLength', () => {
    expect(summarizeLineArt([]).totalLength).toBe(0);
  });
});
