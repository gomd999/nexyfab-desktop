import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyBend,
  applyFlange,
  applyHem,
  applyJog,
  hemInnerRadius,
  validateHem,
  calculateBendAllowance,
  generateFlatPattern,
  type BendHistoryEntry,
} from './sheetMetal';
import { getKFactor, bendAllowance } from './sheetMetalTables';

function makePlate(w = 100, t = 1.0, d = 50): THREE.BufferGeometry {
  // Deliberately the DEFAULT BoxGeometry (uv + normal intact): the shared
  // meshMerge alignment layer must let flange/hem merge against it — the old
  // code required tests to strip uv first ("Failed to merge flange geometry").
  const g = new THREE.BoxGeometry(w, t, d);
  g.computeBoundingBox();
  return g;
}

describe('applyBend — geometry stability', () => {
  it('preserves triangle count (vertex transform only, no remesh)', () => {
    const plate = makePlate();
    const before = (plate.getIndex()?.count ?? plate.attributes.position.count) / 3;
    const bent = applyBend(plate, { angle: 90, radius: 2, position: 0.5, direction: 'up' });
    const after = (bent.getIndex()?.count ?? bent.attributes.position.count) / 3;
    expect(after).toBe(before);
  });

  it('appends to the bend history on userData', () => {
    const plate = makePlate();
    const bent = applyBend(plate, { angle: 45, radius: 1, position: 0.3, direction: 'down' });
    const history = (bent.userData as { __bendHistory?: unknown[] }).__bendHistory;
    expect(history).toBeDefined();
    expect(history).toHaveLength(1);
  });

  it('chains: a second bend appends without overwriting', () => {
    const plate = makePlate();
    const b1 = applyBend(plate, { angle: 90, radius: 1, position: 0.4, direction: 'up' });
    const b2 = applyBend(b1, { angle: 45, radius: 2, position: 0.7, direction: 'down' });
    const history = (b2.userData as { __bendHistory?: unknown[] }).__bendHistory;
    expect(history).toHaveLength(2);
  });

  it('zero-angle bend is a no-op on the geometry bbox', () => {
    const plate = makePlate(50, 1, 30);
    const bent = applyBend(plate, { angle: 0, radius: 1, position: 0.5, direction: 'up' });
    bent.computeBoundingBox();
    expect(bent.boundingBox!.max.y - bent.boundingBox!.min.y).toBeCloseTo(1, 2);
  });
});

describe('calculateBendAllowance — wrapper alignment', () => {
  it('matches the table function for the same inputs', () => {
    // Wrapper just delegates — sanity check.
    const ba = calculateBendAllowance(90, 1, 1, 0.42);
    expect(ba).toBeCloseTo(Math.PI * (1 + 0.42 * 1) * 0.5, 5);
  });
});

describe('applyFlange', () => {
  it('adds vertices to the merged geometry', () => {
    const plate = makePlate(100, 1, 50);
    const before = plate.attributes.position.count;
    const flanged = applyFlange(plate, { height: 20, angle: 90, radius: 2, edgeIndex: 0 });
    expect(flanged.attributes.position.count).toBeGreaterThan(before);
  });

  it('merges on the DEFAULT box base (uv intact) — shared attribute alignment', () => {
    const plate = makePlate(100, 1, 50);
    expect(plate.getAttribute('uv')).toBeDefined(); // precondition: uv present
    const flanged = applyFlange(plate, { height: 20, angle: 90, radius: 2, edgeIndex: 0 });
    expect(flanged.attributes.position.count).toBeGreaterThan(0);
  });

  it('chains: a SECOND flange merges even with the provenance stamp present', () => {
    // Simulate the pipeline: every feature output carries the per-vertex
    // nfabFaceFeatureId attribute. The second flange used to fail because
    // its tool mesh lacked the attribute (mergeGeometries attribute-set
    // mismatch). The U-channel (two flanges) depends on this chain.
    const plate = makePlate(80, 2, 160);
    const f1 = applyFlange(plate, { height: 30, angle: 90, radius: 3, edgeIndex: 0 });
    f1.setAttribute(
      'nfabFaceFeatureId',
      new THREE.BufferAttribute(new Uint32Array(f1.attributes.position.count).fill(1), 1),
    );
    const f2 = applyFlange(f1, { height: 30, angle: 90, radius: 3, edgeIndex: 1 });
    expect(f2.attributes.position.count).toBeGreaterThan(f1.attributes.position.count);
    // Provenance is kept, not dropped: the merged result still carries it.
    expect(f2.getAttribute('nfabFaceFeatureId')).toBeDefined();
  });

  it('records its bend on __bendHistory (radius/angle/axis/position) like applyBend', () => {
    const plate = makePlate(80, 2, 160); // z ∈ [-80, 80]
    const flanged = applyFlange(plate, { height: 30, angle: 90, radius: 3, edgeIndex: 0 });
    const history = (flanged.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory;
    expect(history).toHaveLength(1);
    const e = history![0];
    expect(e.angle).toBe(90);
    expect(e.radius).toBe(3);
    expect(e.source).toBe('flange');
    expect(e.lineAxis).toBe('x');       // +Z edge → bend line runs along X
    expect(e.linePos).toBeCloseTo(80, 6); // at the +Z edge
    expect(e.blankLength).toBeCloseTo(160, 6);
    expect(e.flatAdded).toBeCloseTo(27, 6); // height − radius
    expect(e.addsMaterial).toBe(true);
  });

  it('appends to an existing history (flange after flange)', () => {
    const plate = makePlate(80, 2, 160);
    const f1 = applyFlange(plate, { height: 30, angle: 90, radius: 3, edgeIndex: 0 });
    const f2 = applyFlange(f1, { height: 30, angle: 90, radius: 3, edgeIndex: 1 });
    const history = (f2.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory;
    expect(history).toHaveLength(2);
    expect(history![1].position).toBe(0); // -Z edge → leading end of the blank
  });

  it('rejects invalid edge index', () => {
    const plate = makePlate();
    expect(() => applyFlange(plate, { height: 10, angle: 90, radius: 1, edgeIndex: 99 })).toThrow();
  });
});

describe('hemInnerRadius', () => {
  it('closed = 0.5T, open = 1.0T, teardrop = 1.5T', () => {
    expect(hemInnerRadius('closed', 1.0)).toBe(0.5);
    expect(hemInnerRadius('open', 2.0)).toBe(2.0);
    expect(hemInnerRadius('teardrop', 1.6)).toBeCloseTo(2.4, 5);
  });
});

describe('applyHem — 180° folded edge', () => {
  it('produces a non-degenerate mesh for each of the three hem types', () => {
    for (const type of ['closed', 'open', 'teardrop'] as const) {
      const plate = makePlate(80, 1.2, 40);
      const baseMaxZ = 20; // plate spans z ∈ [-20, 20]
      const hemmed = applyHem(plate, { type, length: 6, edgeIndex: 0 });
      expect(hemmed.attributes.position.count).toBeGreaterThan(plate.attributes.position.count);
      hemmed.computeBoundingBox();
      const bb = hemmed.boundingBox!;
      // 180° fold means the flat tail returns inward, but the arc itself
      // still bulges outward by 2R before folding — so max.z exceeds the
      // base plate by at least the bend diameter.
      expect(bb.max.z).toBeGreaterThan(baseMaxZ);
      // The hem should add at least one full bend radius of height (the
      // folded layer sits ≈ 2R above the base in +Y).
      expect(bb.max.y).toBeGreaterThan(0.6);
    }
  });

  it('throws on a body with zero Y thickness', () => {
    const flat = new THREE.BoxGeometry(50, 0, 30);
    expect(() => applyHem(flat, { type: 'closed', length: 5, edgeIndex: 0 })).toThrow();
  });

  it('records a 180° bend on __bendHistory with the hem flat length', () => {
    const plate = makePlate(80, 1.2, 40);
    const hemmed = applyHem(plate, { type: 'closed', length: 6, edgeIndex: 0 });
    const history = (hemmed.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory;
    expect(history).toHaveLength(1);
    const e = history![0];
    expect(e.angle).toBe(180);
    expect(e.source).toBe('hem');
    expect(e.radius).toBeCloseTo(hemInnerRadius('closed', 1.2), 6);
    expect(e.flatAdded).toBeCloseTo(6, 6); // (length + radius) − radius
    expect(e.addsMaterial).toBe(true);
  });
});

describe('applyJog — Z-bend with parallel offset', () => {
  it('translates the far region by `offset` while leaving the base region unchanged', () => {
    const plate = makePlate(60, 1, 60);
    const baseMaxZ = 30;
    const offset = 10;
    const jogged = applyJog(plate, { offset, position: 0.5, spacing: 1 });
    jogged.computeBoundingBox();
    const bb = jogged.boundingBox!;
    // After the jog the +Y extent grows by exactly `offset` (far region
    // lifted), while the -Y extent stays at the original base.
    expect(bb.max.y).toBeCloseTo(0.5 + offset, 1);
    expect(bb.min.y).toBeCloseTo(-0.5, 1);
    // Primary axis (Z, longest) should not be stretched — jog is in Y.
    expect(bb.max.z).toBeCloseTo(baseMaxZ, 1);
    expect(bb.min.z).toBeCloseTo(-baseMaxZ, 1);
  });

  it('appends TWO bends to history (one up + one down) for flat-pattern', () => {
    const plate = makePlate(50, 1, 50);
    const jogged = applyJog(plate, { offset: 8, position: 0.5, spacing: 2 });
    const history = (jogged.userData as { __bendHistory?: { direction: string }[] }).__bendHistory;
    expect(history).toBeDefined();
    expect(history).toHaveLength(2);
    expect(history![0].direction).toBe('up');
    expect(history![1].direction).toBe('down');
  });

  it('preserves triangle count (per-vertex transform, no remesh)', () => {
    const plate = makePlate();
    const before = (plate.getIndex()?.count ?? plate.attributes.position.count) / 3;
    const jogged = applyJog(plate, { offset: 5, position: 0.5 });
    const after = (jogged.getIndex()?.count ?? jogged.attributes.position.count) / 3;
    expect(after).toBe(before);
  });

  it('throws on zero-Y-extent sheet (no thickness in Y)', () => {
    // Sheet-metal features assume Y is the thickness axis; a body with
    // zero Y extent isn't a sheet, so applyJog should bail rather than
    // silently produce degenerate geometry.
    const flat = new THREE.BoxGeometry(50, 0, 30);
    flat.deleteAttribute('uv');
    expect(() => applyJog(flat, { offset: 5, position: 0.5 })).toThrow();
  });

  it('chains with a prior bend in the history', () => {
    const plate = makePlate();
    const bent = applyBend(plate, { angle: 45, radius: 2, position: 0.3, direction: 'up' });
    const jogged = applyJog(bent, { offset: 6, position: 0.7, spacing: 2 });
    const history = (jogged.userData as { __bendHistory?: unknown[] }).__bendHistory;
    // 1 from bend + 2 from jog = 3
    expect(history).toHaveLength(3);
  });
});

describe('generateFlatPattern — developed length from bend history (closed form)', () => {
  const W = 80, T = 2, L = 160, R = 3, H = 30;
  const k = getKFactor('mildSteel', R, T);
  const ba = bendAllowance(90, R, T, k);

  it('L-channel (one 90° bend at 75%): blank = flat1 + flat2 + BA = original 160 EXACTLY', () => {
    const plate = makePlate(W, T, L); // z ∈ [-80, 80]
    const bent = applyBend(plate, { angle: 90, radius: R, position: 0.75, direction: 'up' });
    // Sanity: the FOLDED bbox is much shorter than the developed blank — the
    // old formula walked it and produced ≈ 131 mm instead of 160.
    bent.computeBoundingBox();
    const foldedZ = bent.boundingBox!.max.z - bent.boundingBox!.min.z;
    expect(foldedZ).toBeLessThan(L - 20);

    const history = (bent.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory!;
    const flat = generateFlatPattern(bent, history, T, 'mildSteel');
    // Closed form: a fold consumes its bend allowance OUT of the blank —
    // flat1 = 120, flat2 = 160 − 120 − BA, developed = flat1 + BA + flat2.
    const flat1 = L * 0.75;
    const flat2 = L - flat1 - ba;
    expect(flat.length).toBeCloseTo(flat1 + ba + flat2, 9);
    expect(flat.length).toBeCloseTo(L, 9); // = the original blank, exactly
    expect(flat.width).toBeCloseTo(W, 6);
    expect(flat.bendTable).toHaveLength(1);
    expect(flat.bendTable[0].position).toBeCloseTo(flat1, 6);
    expect(flat.bendTable[0].bendAllowance).toBeCloseTo(ba, 9);
  });

  it('U-channel (two 90° flanges): blank = 3 flats + 2 BA EXACTLY', () => {
    const plate = makePlate(W, T, L);
    const f1 = applyFlange(plate, { height: H, angle: 90, radius: R, edgeIndex: 0 });
    const f2 = applyFlange(f1, { height: H, angle: 90, radius: R, edgeIndex: 1 });
    const history = (f2.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory!;
    const flat = generateFlatPattern(f2, history, T, 'mildSteel');
    // Closed form: flanges ADD material — base blank + per-flange (leg + BA).
    const leg = H - R; // 27
    expect(flat.length).toBeCloseTo(leg + ba + L + ba + leg, 9);
    expect(flat.width).toBeCloseTo(W, 6);
    expect(flat.bendTable).toHaveLength(2);
    // Bend lines on the blank: end of the leading leg, end of the base blank.
    expect(flat.bendTable[0].position).toBeCloseTo(leg, 6);
    expect(flat.bendTable[1].position).toBeCloseTo(leg + ba + L, 6);
  });

  it('hem records contribute (flat length + 180° BA) to the developed blank', () => {
    const t = 1.2;
    const plate = makePlate(W, t, L);
    const hemmed = applyHem(plate, { type: 'closed', length: 6, edgeIndex: 0 });
    const history = (hemmed.userData as { __bendHistory?: BendHistoryEntry[] }).__bendHistory!;
    const flat = generateFlatPattern(hemmed, history, t, 'mildSteel');
    const r = hemInnerRadius('closed', t);
    const kHem = getKFactor('mildSteel', r, t);
    const baHem = bendAllowance(180, r, t, kHem);
    // (5 dp — the hem radius derives from the float32 bbox thickness)
    expect(flat.length).toBeCloseTo(L + 6 + baHem, 5);
  });

  it('legacy histories (no exact flat data) keep the bbox walk unchanged', () => {
    // Detected-bend / jog entries carry no v2 fields — the established
    // legacy formula (current bbox walk + BAs at point events) must hold.
    const plate = makePlate(W, T, L);
    const legacy: BendHistoryEntry[] = [
      { angle: 90, radius: R, position: 0.5, direction: 'up' },
    ];
    const flat = generateFlatPattern(plate, legacy, T, 'mildSteel');
    expect(flat.length).toBeCloseTo(L + ba, 9); // flat plate walk + one BA
  });
});

describe('validateHem — DFM gates', () => {
  it('flags closed hem on stainless > 1.0mm as error', () => {
    const warns = validateHem('stainless304', 1.5, 'closed');
    expect(warns.some(w => w.severity === 'error')).toBe(true);
  });

  it('allows closed hem on stainless ≤ 1.0mm', () => {
    const warns = validateHem('stainless304', 0.8, 'closed');
    expect(warns.filter(w => w.severity === 'error')).toHaveLength(0);
  });

  it('allows closed hem on mild steel up to 1.6mm', () => {
    expect(validateHem('mildSteel', 1.6, 'closed').filter(w => w.severity === 'error')).toHaveLength(0);
    expect(validateHem('mildSteel', 1.8, 'closed').some(w => w.severity === 'error')).toBe(true);
  });

  it('open and teardrop hems pass the closed-only restriction', () => {
    expect(validateHem('stainless304', 3.0, 'open')).toHaveLength(0);
    expect(validateHem('stainless304', 3.0, 'teardrop')).toHaveLength(0);
  });
});
