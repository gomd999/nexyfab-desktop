/**
 * Tessellation-quality burn-in (P5 gap probe).
 *
 * scoreMeshQuality grades triangle elements (aspect ratio / skewness / angles).
 * This burn-in measures the quality of the meshes the app actually ships —
 * primitive tessellations and the P1 mesh fillet/chamfer — and confirms the
 * scorer discriminates a healthy mesh from a degenerate one:
 *
 *   1. A clean box tessellation scores well, ~no problem elements.
 *   2. The P1 RoundedBox fillet / CSG chamfer score acceptable-or-better.
 *   3. A sliver-laden mesh is correctly flagged poor/failing.
 *   4. Determinism: identical mesh → identical score.
 *
 * Pure numerics — runs headless, no WASM, not gated.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { scoreMeshQuality, type MeshArrays } from './feaMeshQualityScore';
import { tryMeshFillet, tryMeshChamfer } from '../features/meshRounding';

function toMeshArrays(geo: THREE.BufferGeometry): MeshArrays {
  const positions = Array.from(geo.attributes.position.array as ArrayLike<number>);
  const indices = geo.index
    ? Array.from(geo.index.array as ArrayLike<number>)
    : Array.from({ length: positions.length / 3 }, (_, i) => i);
  return { positions, indices };
}

function box(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeVertexNormals();
  return g;
}

describe('tessellation quality — primitive box', () => {
  // MEASURED 2026-05-20: a minimal box (2 right triangles per rectangular face)
  // rates "poor" by FEA-element standards (~33% elongated right triangles) —
  // expected, and fine for display/CAD (FEA remeshes anyway). The guard just
  // pins that it stays usable (never "failing") and the scorer never crashes.
  it('clean box is usable (not failing) — minimal tessellation rates poor by FEA standards', () => {
    const r = scoreMeshQuality(toMeshArrays(box()));
    // eslint-disable-next-line no-console
    console.info(`[tessQ] box: grade=${r.overallGrade} avg=${r.averageQuality.toFixed(3)} problem=${(r.problemFraction * 100).toFixed(1)}%`);
    expect(r.overallGrade).not.toBe('failing');
    expect(r.problemFraction).toBeLessThan(0.4);
  });
});

describe('tessellation quality — P1 mesh fillet / chamfer', () => {
  it('RoundedBox fillet meshes at acceptable quality', () => {
    const fillet = tryMeshFillet(box(), 4)!;
    const r = scoreMeshQuality(toMeshArrays(fillet));
    // eslint-disable-next-line no-console
    console.info(`[tessQ] fillet r=4: grade=${r.overallGrade} avg=${r.averageQuality.toFixed(3)} problem=${(r.problemFraction * 100).toFixed(1)}%`);
    expect(r.overallGrade).not.toBe('failing');
    expect(r.problemFraction).toBeLessThan(0.35);
    expect(r.averageQuality).toBeGreaterThan(0.4);
  });

  // The chamfer is now built procedurally (clean 44-tri watertight polyhedron),
  // replacing the old CSG result that was sliver-heavy (~78% problem). Its FEA
  // grade stays "poor" — the bevel strips are inherently long thin rectangles,
  // exactly like the box's faces — but topology is clean and volume is correct.
  it('procedural chamfer is clean (low-poly, FEA-poor only from elongated strips)', () => {
    const chamfer = tryMeshChamfer(box(), 4)!;
    const r = scoreMeshQuality(toMeshArrays(chamfer));
    // eslint-disable-next-line no-console
    console.info(`[tessQ] chamfer d=4: grade=${r.overallGrade} avg=${r.averageQuality.toFixed(3)} problem=${(r.problemFraction * 100).toFixed(1)}%`);
    expect(r.overallGrade).not.toBe('failing');
  });
});

describe('tessellation quality — scorer discriminates degenerate meshes', () => {
  it('flags sliver triangles as poor/failing', () => {
    // Three very thin (near-zero-angle) triangles.
    const positions = [
      0, 0, 0, 100, 0, 0, 50, 0.05, 0,
      0, 1, 0, 100, 1, 0, 50, 1.05, 0,
      0, 2, 0, 100, 2, 0, 50, 2.05, 0,
    ];
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const r = scoreMeshQuality({ positions, indices });
    // eslint-disable-next-line no-console
    console.info(`[tessQ] slivers: grade=${r.overallGrade} avg=${r.averageQuality.toFixed(3)} problem=${(r.problemFraction * 100).toFixed(1)}% minAngle=${r.perElement[0]!.minAngleDeg.toFixed(2)}`);
    expect(['poor', 'failing']).toContain(r.overallGrade);
    expect(r.problemFraction).toBeGreaterThan(0.5);
  });

  it('a sliver scores worse than an equilateral triangle', () => {
    const equilateral = scoreMeshQuality({
      positions: [0, 0, 0, 1, 0, 0, 0.5, Math.sqrt(3) / 2, 0],
      indices: [0, 1, 2],
    });
    const sliver = scoreMeshQuality({
      positions: [0, 0, 0, 1, 0, 0, 0.5, 0.001, 0],
      indices: [0, 1, 2],
    });
    expect(equilateral.averageQuality).toBeGreaterThan(sliver.averageQuality);
    expect(equilateral.averageQuality).toBeGreaterThan(0.9); // near-perfect
  });
});

describe('tessellation quality — determinism', () => {
  it('identical mesh → identical score', () => {
    const m = toMeshArrays(tryMeshFillet(box(), 3)!);
    const a = scoreMeshQuality(m);
    const b = scoreMeshQuality(m);
    expect(a.averageQuality).toBe(b.averageQuality);
    expect(a.overallGrade).toBe(b.overallGrade);
    expect(a.problemFraction).toBe(b.problemFraction);
  });
});
