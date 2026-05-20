import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { diagnoseMesh, summarizeDiagnostic } from './meshHealingDiagnostic';

function geom(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('diagnoseMesh', () => {
  it('clean tetrahedron has no findings', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  1, 2, 3,  0, 2, 3],
    );
    const r = diagnoseMesh(g);
    expect(r.findings).toHaveLength(0);
    expect(r.overallSeverity).toBe('clean');
    expect(r.isOcctSafe).toBe(true);
  });

  it('open triangle is warn (boundary + hole)', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = diagnoseMesh(g);
    expect(r.findings.some(f => f.code === 'OPEN_BOUNDARY')).toBe(true);
    expect(r.findings.some(f => f.code === 'HOLE_SMALL')).toBe(true);
    expect(r.overallSeverity).toBe('warn');
    expect(r.isOcctSafe).toBe(true);
  });

  it('non-manifold mesh is block', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, -1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  0, 1, 4],
    );
    const r = diagnoseMesh(g);
    expect(r.findings.some(f => f.code === 'NON_MANIFOLD_EDGE')).toBe(true);
    expect(r.overallSeverity).toBe('block');
    expect(r.isOcctSafe).toBe(false);
  });

  it('self-intersection produces block finding when not skipped', () => {
    const g = geom(
      [
        -10, -10, 0,  10, -10, 0,  0, 10, 0,
        0, -1, -1,  0, 1, -1,  0, 0, 1,
      ],
      [0, 1, 2,  3, 4, 5],
    );
    const r = diagnoseMesh(g);
    expect(r.findings.some(f => f.code === 'SELF_INTERSECTION')).toBe(true);
  });

  it('skipSelfIntersection respects the flag', () => {
    const g = geom(
      [
        -10, -10, 0,  10, -10, 0,  0, 10, 0,
        0, -1, -1,  0, 1, -1,  0, 0, 1,
      ],
      [0, 1, 2,  3, 4, 5],
    );
    const r = diagnoseMesh(g, { skipSelfIntersection: true });
    expect(r.findings.some(f => f.code === 'SELF_INTERSECTION')).toBe(false);
  });

  it('produces recommendedSteps in healing order', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = diagnoseMesh(g);
    expect(r.recommendedSteps.length).toBeGreaterThan(0);
    // OPEN_BOUNDARY comes before HOLE_SMALL or vice versa per stepOrder.
    expect(r.recommendedSteps[0]).toMatch(/repair|fill/i);
  });
});

describe('summarizeDiagnostic', () => {
  it('returns "clean" for empty findings', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  1, 2, 3,  0, 2, 3],
    );
    const r = diagnoseMesh(g);
    expect(summarizeDiagnostic(r)).toBe('Mesh is clean.');
  });

  it('joins findings with separator', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = diagnoseMesh(g);
    const s = summarizeDiagnostic(r);
    expect(s).toContain('WARN');
    expect(s).toContain('·');
  });
});
