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
} from './sheetMetal';

function makePlate(w = 100, t = 1.0, d = 50): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, t, d);
  // mergeGeometries requires every input to share the same attribute set;
  // BoxGeometry ships uv + normal but applyFlange builds position-only.
  // Strip uv so the merge succeeds in tests (production callers use
  // `flatPattern` / OCCT meshing that already align attributes).
  g.deleteAttribute('uv');
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
    flat.deleteAttribute('uv');
    expect(() => applyHem(flat, { type: 'closed', length: 5, edgeIndex: 0 })).toThrow();
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
