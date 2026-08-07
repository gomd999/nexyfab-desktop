/**
 * threadGeometricCut.test.ts — Wave 5 Track W5-B measurement suite.
 *
 * MEASURED (not asserted-by-faith) verification that geometric thread mode
 * actually removes material:
 *
 *  (a) volume after thread < volume before, and the removal matches the
 *      Pappus-theorem expectation (groove cross-section area × centroid
 *      circumference × turns) within a stated, measured tolerance;
 *  (b) vertex radius scan of the threaded band matches the catalog
 *      minor/major diameters;
 *  (c) cosmetic mode leaves the host geometry untouched (reference equality
 *      AND identical mesh volume).
 *
 * Baseline measurements this suite is calibrated against (M8 × 20 mm host
 * cylinder R = 4 mm, 64 radial segments, volume 1003.696 mm³):
 *  - pre-W5-B implementation: delta = −0.108 mm³ (nothing cut — the bug);
 *  - W5-B, 16 samples/turn: removed 194.141 mm³ (theory 178.08 → ratio 1.090,
 *    chordal sampling over-cuts between helix samples);
 *  - W5-B, 64 samples/turn: removed 176.259 mm³ (ratio 0.990 — converges
 *    to theory, confirming the chordal explanation).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { applyThreadGeometric } from '../applyThreadGeometric';
import { applyThreadCosmetic } from '../applyThreadCosmetic';
import { makeThreadFeature } from '../threadFeature';
import { findThreadRow } from '../threadCatalog';

// ─── Measurement helpers ────────────────────────────────────────────────────

/** Signed volume of a (possibly indexed) triangle mesh via divergence theorem. */
function meshVolume(geom: THREE.BufferGeometry): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

/**
 * Min/max radial distance (from the Z axis) over all vertices whose z lies
 * in [zMin, zMax] and whose radial distance is < rCap (to exclude e.g. the
 * outer wall of an annulus host when scanning an internal thread's bore).
 */
function radialScan(
  geom: THREE.BufferGeometry,
  zMin: number,
  zMax: number,
  rCap = Infinity,
): { min: number; max: number; count: number } {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < zMin || z > zMax) continue;
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    if (r >= rCap) continue;
    if (r < min) min = r;
    if (r > max) max = r;
    count++;
  }
  return { min, max, count };
}

/** M8 host cylinder: radius = major dia / 2 = 4 mm, z ∈ [0, 20]. */
function makeHostCylinder(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(4, 4, 20, 64, 1, false);
  g.rotateX(Math.PI / 2); // Y-axis → Z-axis
  g.translate(0, 0, 10); // center → z ∈ [0, 20]
  return g;
}

/** Annulus host for internal threads: outer R, bore radius, z ∈ [0, len]. */
function makeAnnulusHost(outerR: number, boreR: number, len: number): THREE.BufferGeometry {
  const outer = new THREE.CylinderGeometry(outerR, outerR, len, 64, 1, false);
  outer.rotateX(Math.PI / 2);
  outer.translate(0, 0, len / 2);
  // Bore slightly longer than the host so the subtraction cuts through.
  const bore = new THREE.CylinderGeometry(boreR, boreR, len + 2, 64, 1, false);
  bore.rotateX(Math.PI / 2);
  bore.translate(0, 0, len / 2);
  const ev = new Evaluator();
  const result = ev.evaluate(
    new Brush(outer, new THREE.MeshStandardMaterial()),
    new Brush(bore, new THREE.MeshStandardMaterial()),
    SUBTRACTION,
  );
  return result.geometry;
}

/**
 * Pappus-theorem removal expectation for the ISO 68-1 basic-profile groove:
 * trapezoid area × 2π·(centroid radius) × turns. Sharp corners (no root
 * rounding) — matches what the cutter actually sweeps, minus end effects
 * and chordal sampling error.
 */
function theoreticalRemoval(
  series: 'external' | 'internal',
  P: number,
  majorR: number,
  minorR: number,
  lengthMm: number,
): number {
  const depth = majorR - minorR; // = 5H/8 for 60° V series
  // Full widths of the trapezoid's parallel sides.
  const wInner = series === 'external' ? P / 4 : (3 * P) / 4; // at minorR
  const wOuter = series === 'external' ? (7 * P) / 8 : P / 8; // at majorR
  const area = ((wInner + wOuter) / 2) * depth;
  // Trapezoid centroid distance from the minorR side.
  const centroidFromInner = (depth * (wInner + 2 * wOuter)) / (3 * (wInner + wOuter));
  const rCentroid = minorR + centroidFromInner;
  const turns = lengthMm / P;
  return area * 2 * Math.PI * rCentroid * turns;
}

const M8 = findThreadRow('ISO_M_COARSE', 'M8')!;
const M8_MAJOR_R = M8.nominalDia / 2; // 4.0
const M8_MINOR_R = M8.minorDiameter / 2; // ≈ 3.3234

// ─── (a) Volume: external thread removes material ───────────────────────────

describe('geometric thread — external cut removes real volume', () => {
  const feature = makeThreadFeature({
    id: 'w5b-ext',
    threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
    length: 20,
    mode: 'geometric',
    threadKind: 'external',
  });

  it('volume after < volume before, removal ≈ Pappus theory (default 16 samples/turn)', () => {
    const host = makeHostCylinder();
    const before = meshVolume(host);
    const r = applyThreadGeometric(host, feature);
    expect(r.metadata.booleanApplied).toBe(true);
    expect(r.metadata.degradedReason).toBeUndefined();
    const after = meshVolume(r.geometry);
    const removed = before - after;
    const theory = theoreticalRemoval('external', M8.pitch, M8_MAJOR_R, M8_MINOR_R, 20);

    // Sanity on the setup itself: polygonal (64-seg) cylinder ≈ π·r²·h.
    expect(before).toBeGreaterThan(995);
    expect(before).toBeLessThan(1006);

    expect(after).toBeLessThan(before); // it CUTS — the W5-B point
    // Measured 2026-07: removed = 194.141 mm³, theory = 178.08 mm³ →
    // ratio 1.090. Chordal helix sampling (16/turn) over-cuts between
    // samples; convergence to theory at 64/turn is asserted below.
    expect(removed / theory).toBeGreaterThan(0.85);
    expect(removed / theory).toBeLessThan(1.2);
  });

  it('left-hand thread removes the same volume as right-hand (LH winding regression)', () => {
    // Regression for the W5-B LH bug: an LH-swept cutter with RH triangle
    // winding is inside-out (probe measured −220.015 mm³ vs RH +220.015) and
    // corrupts the boolean. After the fix both hands must cut equally.
    const lhFeature = makeThreadFeature({
      id: 'w5b-lh',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'external',
      threadDirection: 'left_hand',
    });
    const host = makeHostCylinder();
    const before = meshVolume(host);
    const rLh = applyThreadGeometric(host, lhFeature);
    const removedLh = before - meshVolume(rLh.geometry);
    const rRh = applyThreadGeometric(makeHostCylinder(), feature);
    const removedRh = before - meshVolume(rRh.geometry);
    expect(removedLh).toBeGreaterThan(0);
    expect(Math.abs(removedLh - removedRh) / removedRh).toBeLessThan(0.05);
  });

  it('removal converges to theory with fine sampling (64 samples/turn → ratio ≈ 0.99)', () => {
    const host = makeHostCylinder();
    const before = meshVolume(host);
    const r = applyThreadGeometric(host, feature, {
      samplesPerTurn: 64,
      maxSamples: 2048,
    });
    const removed = before - meshVolume(r.geometry);
    const theory = theoreticalRemoval('external', M8.pitch, M8_MAJOR_R, M8_MINOR_R, 20);
    // Measured 2026-07: removed = 176.259 mm³ → ratio 0.990.
    expect(removed / theory).toBeGreaterThan(0.93);
    expect(removed / theory).toBeLessThan(1.07);
  });
});

// ─── (b) Radius scan: root at minor dia, crest kept at major dia ────────────

describe('geometric thread — radius scan matches catalog diameters', () => {
  it('external M8: min radius ≈ minor R (groove root), max ≈ major R (crest)', () => {
    const host = makeHostCylinder();
    const feature = makeThreadFeature({
      id: 'w5b-scan',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'external',
    });
    const r = applyThreadGeometric(host, feature);
    // Mid-band only — end faces excluded.
    const scan = radialScan(r.geometry, 5, 15);
    expect(scan.count).toBeGreaterThan(100);

    // Groove root: exactly minorR at helix samples; between samples the
    // chordal cutter dips to at most minorR·cos(π/16) ≈ 3.260 (16/turn).
    const chordDip = M8_MINOR_R * Math.cos(Math.PI / 16);
    expect(scan.min).toBeLessThanOrEqual(M8_MINOR_R + 0.02);
    expect(scan.min).toBeGreaterThanOrEqual(chordDip - 0.02);

    // Crest: untouched host surface. The 64-segment host itself spans
    // majorR·cos(π/64) … majorR.
    expect(scan.max).toBeLessThanOrEqual(M8_MAJOR_R + 0.01);
    expect(scan.max).toBeGreaterThanOrEqual(M8_MAJOR_R * Math.cos(Math.PI / 64) - 0.01);
  });

  it('internal M8: groove cut outward from bore reaches ≈ major R', () => {
    // Host: annulus, outer R 8, bore at the thread minor radius, 20 long.
    const host = makeAnnulusHost(8, M8_MINOR_R, 20);
    const before = meshVolume(host);
    const feature = makeThreadFeature({
      id: 'w5b-int',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
      threadKind: 'internal',
    });
    const r = applyThreadGeometric(host, feature);
    const after = meshVolume(r.geometry);
    const removed = before - after;
    const theory = theoreticalRemoval('internal', M8.pitch, M8_MAJOR_R, M8_MINOR_R, 20);

     
    console.log(
      `[W5-B] internal M8: before=${before.toFixed(3)} after=${after.toFixed(3)} ` +
        `removed=${removed.toFixed(3)} theory=${theory.toFixed(3)} ratio=${(removed / theory).toFixed(3)}`,
    );
    expect(after).toBeLessThan(before); // internal threading also removes material
    expect(removed / theory).toBeGreaterThan(0.8);
    expect(removed / theory).toBeLessThan(1.25);

    // Scan the bore region (exclude the outer wall at R=8): groove roots
    // must reach ≈ majorR; the untouched bore wall stays at ≈ minorR.
    const scan = radialScan(r.geometry, 5, 15, 6);
    expect(scan.count).toBeGreaterThan(100);
    expect(scan.max).toBeLessThanOrEqual(M8_MAJOR_R + 0.05);
    expect(scan.max).toBeGreaterThanOrEqual(M8_MAJOR_R - 0.09); // chordal dip at 16/turn
    expect(scan.min).toBeGreaterThanOrEqual(M8_MINOR_R * Math.cos(Math.PI / 64) - 0.03);
  });
});

// ─── Generic modeler feature (features/thread.ts) — real mode cuts ──────────

describe('generic threadFeature (features/thread.ts) — real mode cuts material', () => {
  // Host along +Y (this feature's axis convention): R = 5, height 20.
  function makeYHost(): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(5, 5, 20, 64, 1, false);
  }

  it('cosmetic=0 removes measurable volume (was: mergeGeometries no-op cut)', async () => {
    const { threadFeature } = await import('../../thread');
    const host = makeYHost();
    const before = meshVolume(host);
    const out = threadFeature.apply(host, { pitch: 2, depth: 1, angle: 60, cosmetic: 0 });
    const result = out instanceof Promise ? await out : out;
    const after = meshVolume(result as THREE.BufferGeometry);
     
    console.log(
      `[W5-B] generic thread real mode: before=${before.toFixed(3)} after=${after.toFixed(3)} ` +
        `removed=${(before - after).toFixed(3)}`,
    );
    expect(after).toBeLessThan(before);
    // Order-of-magnitude expectation (Pappus, V-groove depth 1 at R=5,
    // 10 turns): a fully-formed groove would remove roughly
    // area(≈ triangle ~0.5–0.8 mm²) × 2π×4.6 × 10 ≈ 150–230 mm³. Assert a
    // wide honest band — the exact value depends on the clamped flank and
    // the (height−pitch) axial mapping.
    const removed = before - after;
    expect(removed).toBeGreaterThan(80);
    expect(removed).toBeLessThan(320);
  });

  it('cosmetic=0 groove root reaches ≈ R − depth (radius scan)', async () => {
    const { threadFeature } = await import('../../thread');
    const host = makeYHost();
    const out = threadFeature.apply(host, { pitch: 2, depth: 1, angle: 60, cosmetic: 0 });
    const result = (out instanceof Promise ? await out : out) as THREE.BufferGeometry;
    // Scan radial-from-Y-axis in the mid band y ∈ [−5, 5].
    const pos = result.attributes.position as THREE.BufferAttribute;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -5 || y > 5) continue;
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r < min) min = r;
      if (r > max) max = r;
    }
    // Root at R − depth = 4 (chordal dip at 24 samples/turn: ×cos(π/24)).
    expect(min).toBeLessThanOrEqual(4 + 0.02);
    expect(min).toBeGreaterThanOrEqual(4 * Math.cos(Math.PI / 24) - 0.02);
    // Crest untouched at R = 5 (64-segment host).
    expect(max).toBeLessThanOrEqual(5 + 0.01);
    expect(max).toBeGreaterThanOrEqual(5 * Math.cos(Math.PI / 64) - 0.01);
  });

  it('cosmetic=1 keeps the additive indicator behavior (existing contract)', async () => {
    const { threadFeature } = await import('../../thread');
    const host = makeYHost();
    const hostVerts = (host.attributes.position as THREE.BufferAttribute).count;
    const out = threadFeature.apply(host, { pitch: 2, depth: 1, angle: 60, cosmetic: 1 });
    const result = (out instanceof Promise ? await out : out) as THREE.BufferGeometry;
    // Indicator tube is MERGED in — vertex count grows, nothing is cut.
    expect((result.attributes.position as THREE.BufferAttribute).count).toBeGreaterThan(hostVerts);
  });
});

// ─── (c) Cosmetic mode: shape invariant ─────────────────────────────────────

describe('cosmetic thread — geometry untouched (existing contract)', () => {
  it('returns the SAME geometry reference with identical volume', () => {
    const host = makeHostCylinder();
    const before = meshVolume(host);
    const feature = makeThreadFeature({
      id: 'w5b-cos',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'cosmetic',
      threadKind: 'external',
    });
    const r = applyThreadCosmetic(host, feature);
    expect(r.geometry).toBe(host); // reference equality — no clone, no edit
    expect(meshVolume(r.geometry)).toBe(before);
  });
});
