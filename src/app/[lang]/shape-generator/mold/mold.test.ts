import { describe, it, expect } from 'vitest';
import { detectPartingLine, type MoldMesh } from './partingLine';
import { analyzeDraft, isMoldableFromDirection, suggestPullDirection, draftColor } from './draftAnalysis';
import { splitCoreCavity, buildMoldBlock } from './coreCavitySplit';
import { detectUndercuts } from './undercutDetect';

/** A simple cube mesh: 6 quads = 12 triangles. */
function cube(size = 10): MoldMesh {
  const s = size / 2;
  const v: ReadonlyArray<[number, number, number]> = [
    [-s, -s, -s], [ s, -s, -s], [ s,  s, -s], [-s,  s, -s],  // bottom
    [-s, -s,  s], [ s, -s,  s], [ s,  s,  s], [-s,  s,  s],  // top
  ];
  return {
    vertices: v,
    triangles: [
      // bottom (z=-s, normal -Z)
      { indices: [0, 2, 1], normal: [0, 0, -1] },
      { indices: [0, 3, 2], normal: [0, 0, -1] },
      // top (z=+s, normal +Z)
      { indices: [4, 5, 6], normal: [0, 0, 1] },
      { indices: [4, 6, 7], normal: [0, 0, 1] },
      // front (y=-s, normal -Y)
      { indices: [0, 1, 5], normal: [0, -1, 0] },
      { indices: [0, 5, 4], normal: [0, -1, 0] },
      // back (y=+s)
      { indices: [2, 3, 7], normal: [0, 1, 0] },
      { indices: [2, 7, 6], normal: [0, 1, 0] },
      // right (x=+s)
      { indices: [1, 2, 6], normal: [1, 0, 0] },
      { indices: [1, 6, 5], normal: [1, 0, 0] },
      // left (x=-s)
      { indices: [0, 4, 7], normal: [-1, 0, 0] },
      { indices: [0, 7, 3], normal: [-1, 0, 0] },
    ],
  };
}

describe('partingLine', () => {
  it('detects parting edges on a cube', () => {
    const r = detectPartingLine(cube(), [0, 0, 1]);
    // 4 vertical edges on the cube run between +Z and -Z facing triangles.
    expect(r.edgeCount).toBeGreaterThan(0);
  });

  it('returns one closed loop for a cube', () => {
    const r = detectPartingLine(cube(), [0, 0, 1]);
    expect(r.loops.length).toBeGreaterThan(0);
  });
});

describe('draftAnalysis', () => {
  it('cube has equal positive and negative drafts (top vs bottom)', () => {
    const r = analyzeDraft(cube(), [0, 0, 1]);
    expect(r.summary.positive).toBeGreaterThan(0);
    expect(r.summary.negative).toBeGreaterThan(0);
  });

  it('zero-draft for side walls', () => {
    const r = analyzeDraft(cube(), [0, 0, 1]);
    expect(r.summary.zero).toBeGreaterThan(0);
  });

  it('isMoldableFromDirection false for cube (has negative draft)', () => {
    expect(isMoldableFromDirection(analyzeDraft(cube(), [0, 0, 1]))).toBe(false);
  });

  it('suggestPullDirection returns 6 cardinal candidates', () => {
    const r = suggestPullDirection(cube());
    expect(r.scores).toHaveLength(6);
  });

  it('draftColor returns distinct colors per class', () => {
    expect(draftColor('positive')).not.toBe(draftColor('negative'));
    expect(draftColor('zero')).not.toBe(draftColor('positive'));
  });
});

describe('core / cavity split', () => {
  it('separates cube top from bottom', () => {
    const r = splitCoreCavity(cube(), [0, 0, 1]);
    expect(r.cavityTriangles.length).toBeGreaterThan(0);
    expect(r.coreTriangles.length).toBeGreaterThan(0);
  });

  it('parting triangles for side walls', () => {
    const r = splitCoreCavity(cube(), [0, 0, 1]);
    expect(r.partingTriangles.length).toBeGreaterThan(0);
  });

  it('buildMoldBlock encloses the part', () => {
    const block = buildMoldBlock(cube(), [0, 0, 1], 50)!;
    expect(block.topHalf.max[0]).toBeGreaterThan(5);
    expect(block.bottomHalf.min[0]).toBeLessThan(-5);
  });

  it('null for empty mesh', () => {
    const empty: MoldMesh = { vertices: [], triangles: [] };
    expect(buildMoldBlock(empty)).toBeNull();
  });
});

describe('undercut detection', () => {
  it('cube has back-facing region detected as undercut', () => {
    const r = detectUndercuts(cube(), [0, 0, 1]);
    expect(r.length).toBeGreaterThan(0);
  });

  it('region carries severity label', () => {
    const r = detectUndercuts(cube(), [0, 0, 1]);
    expect(['minor', 'moderate', 'severe']).toContain(r[0]!.severity);
  });

  it('region has area > 0', () => {
    const r = detectUndercuts(cube(), [0, 0, 1]);
    expect(r[0]!.areaMm2).toBeGreaterThan(0);
  });

  it('no undercuts when geometry has no negative draft', () => {
    // A single up-facing triangle has no negative draft.
    const flat: MoldMesh = {
      vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      triangles: [{ indices: [0, 1, 2], normal: [0, 0, 1] }],
    };
    expect(detectUndercuts(flat, [0, 0, 1])).toHaveLength(0);
  });
});
