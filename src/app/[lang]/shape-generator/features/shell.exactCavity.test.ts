/**
 * W5-C — exact mesh shell (planar-convex cavity) measurement tests.
 *
 * The old mesh fallback vertex-normal-offset "cavity" was not a solid; probe
 * measurement: closed 50³ t=2 "shell" volume 240 000 mm³ vs theory 27 664 mm³
 * (+767%). The rebuilt path solves the inner cavity as the intersection of the
 * per-face offset planes, so shell volume must equal the closed-form value:
 *
 *   closed box 50³, t=2:   50³ − 46³           = 27 664 mm³
 *   open-top   50³, t=2:   50³ − 46·46·48      = 23 432 mm³
 *   hex prism r=20 h=40:   2√3·(a²·40 − a'²·36), a = 20·cos30°, a' = a − 2
 *
 * All asserted to 1e-6 RELATIVE (probe measured 0, 1.6e-8, 3.5e-8).
 * Out-of-scope bodies must be REFUSED with a typed reason, never approximated.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shellFeature } from './shell';
import { variableShellFeature } from './variableShell';
import { meshVolume } from './roundingGuard';
import { stampFaceFeatureIdAll } from './faceProvenance';

const REL_TOL = 1e-6;

function relErr(v: number, theory: number): number {
  return Math.abs(v - theory) / Math.abs(theory);
}

describe('shell — exact mesh cavity (W5-C)', () => {
  it('closed box 50³ t=2 → volume 50³ − 46³ = 27664 (rel ≤ 1e-6)', () => {
    const out = shellFeature.apply(new THREE.BoxGeometry(50, 50, 50), {
      wallThickness: 2, openFace: 0, engine: 0,
    });
    const v = meshVolume(out);
    expect(relErr(v, 27664)).toBeLessThanOrEqual(REL_TOL);
  });

  it('open-top box 50³ t=2 → volume 50³ − 46·46·48 = 23432 (rel ≤ 1e-6)', () => {
    const out = shellFeature.apply(new THREE.BoxGeometry(50, 50, 50), {
      wallThickness: 2, openFace: 1, engine: 0,
    });
    const v = meshVolume(out);
    expect(relErr(v, 23432)).toBeLessThanOrEqual(REL_TOL);
  });

  it('open-bottom box 50³ t=2 → 23432 by symmetry (rel ≤ 1e-6)', () => {
    const out = shellFeature.apply(new THREE.BoxGeometry(50, 50, 50), {
      wallThickness: 2, openFace: 2, engine: 0,
    });
    const v = meshVolume(out);
    expect(relErr(v, 23432)).toBeLessThanOrEqual(REL_TOL);
  });

  it('convex hexagonal prism r=20 h=40 t=2, closed — exact apothem-offset volume (rel ≤ 1e-6)', () => {
    const out = shellFeature.apply(new THREE.CylinderGeometry(20, 20, 40, 6), {
      wallThickness: 2, openFace: 0, engine: 0,
    });
    const aOut = 20 * Math.cos(Math.PI / 6);
    const aIn = aOut - 2;
    const theory = 2 * Math.sqrt(3) * (aOut * aOut * 40 - aIn * aIn * 36);
    const v = meshVolume(out);
    expect(relErr(v, theory)).toBeLessThanOrEqual(REL_TOL);
  });

  it('face-selection open face: picking the −X side wall opens that wall', () => {
    const base = new THREE.BoxGeometry(50, 50, 50);
    // provenance plumbing expects the base to carry a face-feature-id attribute
    // when a featureId ctx is supplied (same contract as the pipeline base)
    stampFaceFeatureIdAll(base, '__base__');
    const out = shellFeature.apply(
      base,
      { wallThickness: 2, openFace: 0, engine: 0 },
      {
        featureId: 'w5c-shell',
        faceSelections: [{
          type: 'face', normal: [-1, 0, 0], position: [-25, 0, 0],
          area: 2500, triangleCount: 2, normalLabel: '-X', triangleIndices: [],
        }],
      },
    );
    // cavity 46×46 pierced through −X: removed = 48·46·46 → 125000 − 101568
    const v = meshVolume(out);
    expect(relErr(v, 125000 - 48 * 46 * 46)).toBeLessThanOrEqual(REL_TOL);
  });

  it('variableShell: per-plane thickness box 50³ (top 2 / side 1.5 / bottom 3, closed) → 25595', () => {
    const out = variableShellFeature.apply(new THREE.BoxGeometry(50, 50, 50), {
      topThickness: 2, sideThickness: 1.5, bottomThickness: 3, openFace: 0,
    });
    // cavity: x,z: 50 − 2·1.5 = 47; y: 50 − 2 − 3 = 45 → 125000 − 47·45·47
    const v = meshVolume(out);
    expect(relErr(v, 125000 - 47 * 45 * 47)).toBeLessThanOrEqual(REL_TOL);
  });

  it('REFUSES a tessellated-smooth body (sphere): >3 planes per vertex', () => {
    expect(() =>
      shellFeature.apply(new THREE.SphereGeometry(20, 16, 12), { wallThickness: 2, openFace: 0, engine: 0 }),
    ).toThrow(/SHELL_UNSUPPORTED_VERTEX/);
  });

  it('REFUSES non-convex / multi-body geometry', () => {
    const a = new THREE.BoxGeometry(20, 20, 20).translate(-20, 0, 0);
    const b = new THREE.BoxGeometry(20, 20, 20).translate(20, 0, 0);
    const merged = mergeGeometries([a, b], false)!;
    expect(() =>
      shellFeature.apply(merged, { wallThickness: 2, openFace: 0, engine: 0 }),
    ).toThrow(/SHELL_UNSUPPORTED_NONCONVEX/);
  });

  it('REFUSES a wall thickness that consumes the body (t=30 on a 50³ box)', () => {
    expect(() =>
      shellFeature.apply(new THREE.BoxGeometry(50, 50, 50), { wallThickness: 30, openFace: 0, engine: 0 }),
    ).toThrow(/SHELL_THICKNESS_TOO_LARGE/);
  });

  it('REFUSES non-indexed geometry (unchanged pre-flight contract)', () => {
    expect(() =>
      shellFeature.apply(new THREE.BoxGeometry(50, 50, 50).toNonIndexed(), { wallThickness: 2, openFace: 0, engine: 0 }),
    ).toThrow(/indexed/);
  });

  it('REFUSES an inverted-winding mesh instead of shelling it', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    const idx = g.index!;
    const arr = idx.array as Uint16Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = tmp;
    }
    idx.needsUpdate = true;
    expect(() =>
      shellFeature.apply(g, { wallThickness: 2, openFace: 0, engine: 0 }),
    ).toThrow(/SHELL_INVERTED_WINDING/);
  });
});
