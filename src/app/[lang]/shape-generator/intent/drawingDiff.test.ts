// Drawing-diff scorer unit tests — synthetic meshes with known answers.
// (E2E scoring against real wasm-rendered STLs runs in the generator
// scripts; here we prove the measurement math itself.)

import { describe, expect, it } from 'vitest';

import {
  meshBbox,
  profileMaxX,
  scoreBboxDims,
  scoreRevolveAgainstProfile,
  sliceOuterRadius,
} from './drawingDiff';
import { TANK_200L_SPEC } from './pilot200LTank';
import { tankWallProfile } from './sections';

/** Axis-aligned box mesh [x0..x1]×[y0..y1]×[z0..z1] as 12 triangles. */
function boxMesh(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Float32Array {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], // bottom
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], // top
  ];
  const quads = [
    [0, 1, 2, 3], [4, 7, 6, 5], // bottom, top
    [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0], // sides
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) {
    out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  }
  return new Float32Array(out);
}

describe('drawingDiff: mesh measurements', () => {
  const box = boxMesh(-10, 10, -5, 5, 0, 40);

  it('meshBbox is exact', () => {
    expect(meshBbox(box)).toEqual({ min: [-10, -5, 0], max: [10, 5, 40] });
  });

  it('sliceOuterRadius finds the corner radius of a box section', () => {
    // Section at z=20 is the 20×10 rectangle → farthest point = corner
    expect(sliceOuterRadius(box, 20)).toBeCloseTo(Math.hypot(10, 5), 9);
  });

  it('sliceOuterRadius returns -Infinity when the plane misses the mesh', () => {
    expect(sliceOuterRadius(box, 99)).toBe(-Infinity);
  });
});

describe('drawingDiff: drawing expectations', () => {
  const wall = tankWallProfile(TANK_200L_SPEC).profile.points;

  it('profileMaxX reads the shell outer radius from the drawing', () => {
    expect(profileMaxX(wall, 500)).toBeCloseTo(330, 9); // straight shell region
  });

  it('profileMaxX interpolates the cone outer surface', () => {
    // Outer cone runs from the plate end to the miter — monotonically
    // increasing with height, strictly between drain and shell radii.
    const r150 = profileMaxX(wall, 150);
    expect(r150).toBeGreaterThan(150);
    expect(r150).toBeLessThan(330);
    expect(profileMaxX(wall, 250)).toBeGreaterThan(r150);
  });
});

describe('drawingDiff: scoring', () => {
  it('passes a mesh that matches its drawing and localizes an error', () => {
    // "Drawing": 20-wide, 40-tall box section as a rectangle profile
    const profile = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 40 }, { x: 0, y: 40 },
    ];
    // Correct build (square box → corner radius √200 ≠ profile 10, so use
    // radial stations only where corner=expectation matches: instead score
    // bbox for the box, and revolve-score with a matching "cylinder" mesh
    // approximated by an octagonal prism of circumradius 10.
    const oct: number[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI;
      const a1 = ((i + 1) / N) * 2 * Math.PI;
      const p0 = [10 * Math.cos(a0), 10 * Math.sin(a0)];
      const p1 = [10 * Math.cos(a1), 10 * Math.sin(a1)];
      oct.push(p0[0], p0[1], 0, p1[0], p1[1], 0, p1[0], p1[1], 40);
      oct.push(p0[0], p0[1], 0, p1[0], p1[1], 40, p0[0], p0[1], 40);
    }
    const mesh = new Float32Array(oct);
    const good = scoreRevolveAgainstProfile(mesh, profile, [10, 20, 30], 0.5);
    expect(good.pass).toBe(true);
    expect(good.maxErrorMm).toBeLessThanOrEqual(0.5);

    // Wrong drawing (radius 12) → every station fails by ~2mm, localized
    const wrong = scoreRevolveAgainstProfile(
      mesh,
      [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 40 }, { x: 0, y: 40 }],
      [10, 20, 30],
      0.5,
    );
    expect(wrong.pass).toBe(false);
    expect(wrong.items.filter((i) => !i.pass).map((i) => i.label))
      .toEqual(['outerR@z=10', 'outerR@z=20', 'outerR@z=30']);
    expect(wrong.maxErrorMm).toBeCloseTo(2, 1);
  });

  it('scoreBboxDims verifies envelope dims', () => {
    const box = boxMesh(-700, 700, -375, 375, 0, 1600);
    const r = scoreBboxDims(box, { L: 1400, W: 750, H: 1600 }, 0.5);
    expect(r.pass).toBe(true);
    const bad = scoreBboxDims(box, { L: 1400, W: 750, H: 1700 }, 0.5);
    expect(bad.pass).toBe(false);
    expect(bad.items.find((i) => !i.pass)?.label).toBe('H(z)');
  });
});
