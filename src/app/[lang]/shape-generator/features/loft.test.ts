/**
 * W5-A loft tests — real-loft core (`loftSolid`) + preset feature rework.
 *
 * Pre-fix probe evidence (2026-07-21, same file as stage-1 probe):
 *   - square prism 40×40×100: mesh signed volume 53,333.3 vs 160,000 true
 *     (inconsistent triangle winding — the old mesh was not a closed oriented solid),
 *   - frustum 20→10: 26,666.7 vs 93,333.3 true,
 *   - circle→square "morph": per-ring areas 1248.6 …×7, then 1600.0 …×6 —
 *     a 28.15% area JUMP at mid-height (preset switch, not a loft),
 *   - no API accepted arbitrary sections (params: 3-preset enums only).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loftFeature, loftSolid, meshSignedVolume, type LoftSectionInput } from './loft';

function threeVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.getIndex()!;
  const positions = pos.array as ArrayLike<number>;
  const indices: number[] = [];
  for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i));
  return Math.abs(meshSignedVolume(positions, indices));
}

function squareSection(half: number, z: number): LoftSectionInput {
  return {
    points: [
      { x: -half, y: -half, z }, { x: half, y: -half, z },
      { x: half, y: half, z }, { x: -half, y: half, z },
    ],
  };
}

function hasVertex(positions: ArrayLike<number>, x: number, y: number, z: number, tol = 1e-9): boolean {
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs((positions[i] as number) - x) <= tol &&
        Math.abs((positions[i + 1] as number) - y) <= tol &&
        Math.abs((positions[i + 2] as number) - z) <= tol) return true;
  }
  return false;
}

const dummy = new THREE.BufferGeometry();

// ── Core: loftSolid (arbitrary convex sections) ────────────────────────────

describe('loftSolid — measured volumes', () => {
  it('(a) two equal squares → prism, volume exact', () => {
    const r = loftSolid([squareSection(20, 0), squareSection(20, 100)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log('[W5-A] core prism volume =', r.volume, '(exact 160000, relErr', Math.abs(r.volume - 160000) / 160000, ')');
    expect(Math.abs(r.volume - 160000) / 160000).toBeLessThan(1e-9);
    // Mesh is oriented outward: signed volume of the returned arrays is +volume.
    const signed = meshSignedVolume(r.positions, Array.from(r.indices));
    expect(Math.abs(signed - r.volume) / r.volume).toBeLessThan(1e-12);
  });

  it('(b) square 20 → 10 → frustum, V = h/3·(A1+A2+√(A1·A2)) within 1e-9', () => {
    const r = loftSolid([squareSection(20, 0), squareSection(10, 100)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const A1 = 1600, A2 = 400;
    const exact = (100 / 3) * (A1 + A2 + Math.sqrt(A1 * A2));
    console.log('[W5-A] core frustum volume =', r.volume, '(exact', exact, ', relErr', Math.abs(r.volume - exact) / exact, ')');
    expect(Math.abs(r.volume - exact) / exact).toBeLessThan(1e-9);
  });

  it('(c) square 20 → near-point (1e-3) → pyramid approximation', () => {
    const r = loftSolid([squareSection(20, 0), squareSection(1e-3, 100)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const A1 = 1600, A2 = 4e-6;
    const frustumExact = (100 / 3) * (A1 + A2 + Math.sqrt(A1 * A2));
    const pyramid = (100 / 3) * A1;
    // The mesh IS the tiny frustum (exact) and approximates the pyramid to ~5e-5.
    console.log('[W5-A] core pyramid-approx volume =', r.volume, '(pyramid', pyramid, ', relErr', Math.abs(r.volume - pyramid) / pyramid, ')');
    expect(Math.abs(r.volume - frustumExact) / frustumExact).toBeLessThan(1e-9);
    expect(Math.abs(r.volume - pyramid) / pyramid).toBeLessThan(1e-4);
  });

  it('multi-section (3 stacked squares) keeps the exact prism volume', () => {
    const r = loftSolid([squareSection(20, 0), squareSection(15, 50), squareSection(10, 100)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Two stacked frustums, both exact.
    const f = (a: number, b: number, h: number) => (h / 3) * (4 * a * a + 4 * b * b + 4 * a * b);
    const exact = f(20, 15, 50) + f(15, 10, 50);
    expect(Math.abs(r.volume - exact) / exact).toBeLessThan(1e-9);
  });
});

describe('loftSolid — differing vertex counts (resample + correspondence)', () => {
  const tri: LoftSectionInput = {
    points: [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 15, y: 25, z: 0 }],
  };
  const sq: LoftSectionInput = {
    points: [{ x: 0, y: 0, z: 50 }, { x: 30, y: 0, z: 50 }, { x: 30, y: 30, z: 50 }, { x: 0, y: 30, z: 50 }],
  };

  it('triangle(3) → square(4): union arc-length params → ring size 6', () => {
    const r = loftSolid([tri, sq]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // params: {0, 1/3, 2/3} ∪ {0, 1/4, 1/2, 3/4} → 6 correspondence points.
    expect(r.ringSize).toBe(6);
    expect(r.ringCount).toBe(2);
    expect(r.volume).toBeGreaterThan(0);
  });

  it('every original section vertex exists exactly in the result mesh', () => {
    const r = loftSolid([tri, sq]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const p of [...tri.points, ...sq.points]) {
      expect(hasVertex(r.positions, p.x, p.y, p.z, 1e-9)).toBe(true);
    }
  });

  it('result mesh is a closed oriented manifold (every directed edge paired exactly once)', () => {
    const r = loftSolid([tri, sq]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const edges = new Map<string, number>();
    for (let i = 0; i < r.indices.length; i += 3) {
      const t = [r.indices[i]!, r.indices[i + 1]!, r.indices[i + 2]!];
      for (let k = 0; k < 3; k++) {
        const key = `${t[k]}>${t[(k + 1) % 3]}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      expect(count).toBe(1);
      const [a, b] = key.split('>');
      expect(edges.get(`${b}>${a}`)).toBe(1);
    }
  });
});

describe('loftSolid — explicit refusals', () => {
  const okSquare = squareSection(10, 30);

  it('fewer than 2 sections', () => {
    const r = loftSolid([squareSection(10, 0)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('at least 2 sections');
  });

  it('a section with fewer than 3 points', () => {
    const r = loftSolid([{ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }, okSquare]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('at least 3 points');
  });

  it('non-planar section is refused with the measured deviation', () => {
    const warped: LoftSectionInput = {
      points: [
        { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 },
        { x: 20, y: 20, z: 5 }, { x: 0, y: 20, z: 0 },
      ],
    };
    const r = loftSolid([warped, okSquare]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('non-planar');
  });

  it('self-intersecting (bow-tie) section is refused', () => {
    const bowtie: LoftSectionInput = {
      points: [
        { x: 0, y: 0, z: 0 }, { x: 10, y: 8, z: 0 },
        { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 },
      ],
    };
    const r = loftSolid([bowtie, okSquare]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('self-intersecting');
  });

  it('non-convex (L-shape) section is refused', () => {
    const lShape: LoftSectionInput = {
      points: [
        { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 10, z: 0 },
        { x: 10, y: 10, z: 0 }, { x: 10, y: 20, z: 0 }, { x: 0, y: 20, z: 0 },
      ],
    };
    const r = loftSolid([lShape, okSquare]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('non-convex');
  });

  it('degenerate (collinear, zero-area) section is refused', () => {
    const line: LoftSectionInput = {
      points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }],
    };
    const r = loftSolid([line, okSquare]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('degenerate');
  });

  it('sections that do not advance in space are refused', () => {
    const r = loftSolid([squareSection(10, 0), squareSection(20, 0)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('stacking direction');
  });
});

// ── Preset feature (UI) path ───────────────────────────────────────────────

describe('loftFeature preset path — measured volumes (Float32 mesh, tol 1e-6)', () => {
  it('square→square same size = prism, exact 160,000', () => {
    const g = loftFeature.apply(dummy, { sections: 12, height: 100, startShape: 1, endShape: 1, startSize: 20, endSize: 20, twist: 0 }) as THREE.BufferGeometry;
    const v = threeVolume(g);
    expect(Math.abs(v - 160000) / 160000).toBeLessThan(1e-6);
  });

  it('square 20→10 = frustum, exact 93,333.3', () => {
    const g = loftFeature.apply(dummy, { sections: 12, height: 100, startShape: 1, endShape: 1, startSize: 20, endSize: 10, twist: 0 }) as THREE.BufferGeometry;
    const v = threeVolume(g);
    const exact = (100 / 3) * (1600 + 400 + 800);
    expect(Math.abs(v - exact) / exact).toBeLessThan(1e-6);
  });

  it('circle prism = 32-gon prism (exact vs 32-gon; π·r²·h is a stated 0.64% approximation)', () => {
    const g = loftFeature.apply(dummy, { sections: 12, height: 100, startShape: 0, endShape: 0, startSize: 20, endSize: 20, twist: 0 }) as THREE.BufferGeometry;
    const v = threeVolume(g);
    const gon32 = 0.5 * 32 * 400 * Math.sin((2 * Math.PI) / 32) * 100;
    expect(Math.abs(v - gon32) / gon32).toBeLessThan(1e-5);
    // Circle sections are a 32-gon approximation of the true circle:
    expect(Math.abs(v - Math.PI * 400 * 100) / (Math.PI * 400 * 100)).toBeLessThan(0.01);
  });
});

describe('loftFeature preset path — circle→square is now a continuous blend', () => {
  it('per-ring areas grow monotonically with no mid-height jump (was 28.15%)', () => {
    const sections = 12;
    const g = loftFeature.apply(dummy, { sections, height: 100, startShape: 0, endShape: 1, startSize: 20, endSize: 20, twist: 0 }) as THREE.BufferGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const M = pos.count / (sections + 1);
    expect(Number.isInteger(M)).toBe(true);
    const areas: number[] = [];
    for (let s = 0; s <= sections; s++) {
      let a = 0;
      for (let i = 0; i < M; i++) {
        const p = s * M + i, q = s * M + (i + 1) % M;
        a += pos.getX(p) * pos.getZ(q) - pos.getX(q) * pos.getZ(p);
      }
      areas.push(Math.abs(a / 2));
    }
    // Ends: 32-gon circle ring → exact square ring.
    const circleArea = 0.5 * 32 * 400 * Math.sin((2 * Math.PI) / 32);
    expect(Math.abs(areas[0]! - circleArea) / circleArea).toBeLessThan(1e-5);
    expect(Math.abs(areas[sections]! - 1600) / 1600).toBeLessThan(1e-5);
    // Monotone, and adjacent jump bounded (blend, not a switch).
    let maxJump = 0;
    for (let s = 0; s < sections; s++) {
      expect(areas[s + 1]!).toBeGreaterThanOrEqual(areas[s]! * (1 - 1e-9));
      maxJump = Math.max(maxJump, (areas[s + 1]! - areas[s]!) / areas[s]!);
    }
    console.log('[W5-A] circle→square ring areas =', areas.map(a => a.toFixed(1)).join(', '), '| maxJump =', (maxJump * 100).toFixed(2) + '% (was 28.15%)');
    expect(maxJump).toBeLessThan(0.06);
  });
});

describe('loftFeature preset path — twist', () => {
  it('90° twist rotates the top square and keeps volume within the ruled-solid bound', () => {
    const g = loftFeature.apply(dummy, { sections: 12, height: 100, startShape: 1, endShape: 1, startSize: 20, endSize: 20, twist: 90 }) as THREE.BufferGeometry;
    // Top corner (20,20) rotated by 90° → (−20,20) at y=+50.
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    let found = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - 50) < 1e-3 &&
          Math.abs(pos.getX(i) + 20) < 1e-3 &&
          Math.abs(pos.getZ(i) - 20) < 1e-3) { found = true; break; }
    }
    expect(found).toBe(true);
    // Twisted ruled prism: volume slightly below the straight prism
    // (theory for 12 slices of 7.5°: ≈ 0.99715 × 160000 ≈ 159,544 — approximation).
    const v = threeVolume(g);
    console.log('[W5-A] preset 90° twist prism volume =', v, '(straight prism 160000, ruled theory ≈ 159544)');
    expect(v).toBeLessThan(160000 * (1 + 1e-6));
    expect(v).toBeGreaterThan(160000 * 0.97);
  });
});

describe('loftFeature API', () => {
  it('exposes the preset params (arbitrary sections go through loftSolid)', () => {
    const keys = loftFeature.params.map(p => p.key);
    for (const k of ['sections', 'height', 'startShape', 'endShape', 'startSize', 'endSize', 'twist']) {
      expect(keys).toContain(k);
    }
  });
});
