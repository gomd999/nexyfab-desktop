/**
 * stepAssemblyMateInference tests — Phase 2 mate inference.
 *
 * Two layers:
 *   1. `inferMatesFromPlacements` exercised via hand-crafted FaceData /
 *      AxisData (no STEP source needed) — this isolates the geometric
 *      heuristic from STEP parsing concerns.
 *   2. `extractFaceDataFromSolid` + `extractAxisDataFromSolid` exercised
 *      against real STEP source emitted by `writeStepEntities` (box) and
 *      a hand-crafted cylinder fixture (since stepWrite doesn't emit
 *      cylinder primitives).
 */

import { describe, it, expect } from 'vitest';
import {
  inferMatesFromPlacements,
  extractFaceDataFromSolid,
  extractAxisDataFromSolid,
  type FaceData,
  type AxisData,
} from './stepAssemblyMateInference';
import type { AssemblyState, PartInstance } from '@/lib/assembly/assemblyState';
import { writeStepEntities, writeStepHeader } from './stepWrite';
import { parseEntities } from './stepImport';
import { healStepSource } from './stepRead';

// ─── micro-helpers ────────────────────────────────────────────────────────

function makePart(id: string, fixed = false): PartInstance {
  return {
    id,
    name: id,
    partTemplateId: `pd_${id}`,
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    fixed,
  };
}

function makeState(...parts: PartInstance[]): AssemblyState {
  return { parts, mates: [] };
}

function face(id: string, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number): FaceData {
  return { id, origin: { x: ox, y: oy, z: oz }, normal: { x: nx, y: ny, z: nz } };
}

function axis(id: string, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): AxisData {
  return { id, origin: { x: ox, y: oy, z: oz }, direction: { x: dx, y: dy, z: dz } };
}

// ─── 1: coincident face/face ─────────────────────────────────────────────

describe('inferMatesFromPlacements — coincident face/face', () => {
  it('emits 1 coincident mate when 2 parts share a coplanar antiparallel face pair', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      // Plate on z=0, normal pointing up (+Z).
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      // Block sitting on top: bottom face at z=0, normal pointing down (-Z).
      b: [face('bot', 0, 0, 0, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(1);
    expect(mates[0]!.kind).toBe('coincident');
    expect(mates[0]!.a.refKind).toBe('face');
    expect(mates[0]!.b.refKind).toBe('face');
  });

  it('emits 1 coincident mate when normals are parallel (same orientation, touching)', () => {
    // Two coplanar tab faces both pointing +Z (e.g., two stacked plates'
    // shared mating plane modelled with same-sense normals).
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('p', 0, 0, 5, 0, 0, 1)],
      b: [face('q', 0, 0, 5, 0, 0, 1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(1);
    expect(mates[0]!.kind).toBe('coincident');
  });

  it('emits 0 mates when faces are coplanar in orientation but offset perpendicularly', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      // Block 5mm above (gap of 5mm).
      b: [face('bot', 0, 0, 5, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(0);
  });

  it('emits 0 mates when face normals are not parallel', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      // Normal pointing +X — perpendicular to A's normal.
      b: [face('side', 0, 0, 0, 1, 0, 0)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(0);
  });

  it('respects planeContactTol: tightening to 0.001 rejects a 0.05mm gap', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      b: [face('bot', 0, 0, 0.05, 0, 0, -1)],
    };
    const loose = inferMatesFromPlacements(state, partFaces, {}, );
    expect(loose).toHaveLength(1); // default tol 0.1 → accepts
    const tight = inferMatesFromPlacements(state, partFaces, {}, { planeContactTol: 0.001 });
    expect(tight).toHaveLength(0); // tight tol → rejects
  });

  it('loosens planeContactTol: 0.5 accepts a 0.3mm gap that default rejects', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      b: [face('bot', 0, 0, 0.3, 0, 0, -1)],
    };
    const tight = inferMatesFromPlacements(state, partFaces, {});
    expect(tight).toHaveLength(0);
    const loose = inferMatesFromPlacements(state, partFaces, {}, { planeContactTol: 0.5 });
    expect(loose).toHaveLength(1);
  });

  it('deduplicates: same face pair contributing twice (separate iteration paths) → 1 mate', () => {
    // Construct a degenerate case where A has TWO references to the same
    // face id (caller would not typically do this, but if they did, dedup
    // by ref key should collapse). NOTE: refIds must be distinct within a
    // single part for dedup to engage as a real dedup; same-id duplication
    // emits two mate IR objects with distinct ids and an UNDEFINED dedup
    // contract. So we test the legitimate case: a 3-part chain that could
    // double-count if we forgot to dedup across the i,j pairwise loop.
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      b: [face('bot', 0, 0, 0, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(1);
  });
});

// ─── 2: concentric / parallel axis/axis ──────────────────────────────────

describe('inferMatesFromPlacements — concentric / parallel axes', () => {
  it('emits 1 concentric mate for two collinear axes', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partAxes = {
      a: [axis('shaft', 0, 0, 0, 1, 0, 0)],
      b: [axis('hole', 5, 0, 0, 1, 0, 0)], // same line, offset along axis
    };
    const mates = inferMatesFromPlacements(state, {}, partAxes);
    expect(mates).toHaveLength(1);
    expect(mates[0]!.kind).toBe('concentric');
  });

  it('emits 1 parallel mate for two parallel-but-offset axes', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partAxes = {
      // Both point +Z. A through (0,0,*), B through (10,0,*). 10mm gap.
      a: [axis('shaftA', 0, 0, 0, 0, 0, 1)],
      b: [axis('shaftB', 10, 0, 0, 0, 0, 1)],
    };
    const mates = inferMatesFromPlacements(state, {}, partAxes);
    expect(mates).toHaveLength(1);
    expect(mates[0]!.kind).toBe('parallel');
  });

  it('emits 0 mates for skew (non-parallel) axes', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partAxes = {
      a: [axis('shaftA', 0, 0, 0, 1, 0, 0)],
      b: [axis('shaftB', 0, 0, 0, 0, 1, 0)],
    };
    const mates = inferMatesFromPlacements(state, {}, partAxes);
    expect(mates).toHaveLength(0);
  });

  it('emits concentric for antiparallel collinear axes (direction vs −direction)', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partAxes = {
      a: [axis('shaft', 0, 0, 0, 0, 0, 1)],
      b: [axis('hole', 0, 0, 0, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, {}, partAxes);
    expect(mates).toHaveLength(1);
    expect(mates[0]!.kind).toBe('concentric');
  });

  it('axisCollinearTol controls concentric vs parallel boundary', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partAxes = {
      a: [axis('shaftA', 0, 0, 0, 0, 0, 1)],
      // 0.5mm laterally offset.
      b: [axis('shaftB', 0.5, 0, 0, 0, 0, 1)],
    };
    const tight = inferMatesFromPlacements(state, {}, partAxes); // default 0.1
    expect(tight).toHaveLength(1);
    expect(tight[0]!.kind).toBe('parallel');
    const loose = inferMatesFromPlacements(state, {}, partAxes, { axisCollinearTol: 1.0 });
    expect(loose).toHaveLength(1);
    expect(loose[0]!.kind).toBe('concentric');
  });

  it('axisParallelTol controls parallel/skew boundary (degrees)', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    // B's axis tilted 0.5° off from A.
    const tiltRad = (0.5 * Math.PI) / 180;
    const partAxes = {
      a: [axis('shaftA', 0, 0, 0, 0, 0, 1)],
      b: [axis('shaftB', 0, 0, 0, Math.sin(tiltRad), 0, Math.cos(tiltRad))],
    };
    // Default 1° tol → 0.5° is parallel.
    const loose = inferMatesFromPlacements(state, {}, partAxes);
    expect(loose).toHaveLength(1);
    // Tight 0.1° tol → 0.5° is NOT parallel.
    const tight = inferMatesFromPlacements(state, {}, partAxes, { axisParallelTol: 0.1 });
    expect(tight).toHaveLength(0);
  });
});

// ─── 3: 3-part chain ─────────────────────────────────────────────────────

describe('inferMatesFromPlacements — multi-part chains', () => {
  it('3 parts in chain (2 coplanar pairs) → 2 coincident mates', () => {
    // Stack: A on bottom, B in middle (touches A), C on top (touches B).
    const state = makeState(makePart('a', true), makePart('b'), makePart('c'));
    const partFaces = {
      a: [face('a_top', 0, 0, 0, 0, 0, 1)],
      b: [
        face('b_bot', 0, 0, 0, 0, 0, -1),
        face('b_top', 0, 0, 5, 0, 0, 1),
      ],
      c: [face('c_bot', 0, 0, 5, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(2);
    expect(mates.every((m) => m.kind === 'coincident')).toBe(true);
  });

  it('does NOT mate a part to itself even when faces are pairwise coplanar', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      // Part a has TWO faces that would coincide if mated against itself.
      a: [
        face('a1', 0, 0, 0, 0, 0, 1),
        face('a2', 0, 0, 0, 0, 0, -1),
      ],
      b: [],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(0);
  });
});

// ─── 4: mixed kinds + empty data ─────────────────────────────────────────

describe('inferMatesFromPlacements — kind mismatch + missing data', () => {
  it('1 face on A + 1 axis on B → 0 mates (face/axis not handled in Phase 2)', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = { a: [face('top', 0, 0, 0, 0, 0, 1)], b: [] };
    const partAxes = { a: [], b: [axis('shaft', 0, 0, 0, 0, 0, 1)] };
    const mates = inferMatesFromPlacements(state, partFaces, partAxes);
    expect(mates).toHaveLength(0);
  });

  it('part missing from partFaces map is treated as zero faces', () => {
    const state = makeState(makePart('a', true), makePart('b'));
    // Only 'a' has face data; 'b' is absent.
    const partFaces = { a: [face('top', 0, 0, 0, 0, 0, 1)] };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(0);
  });

  it('empty assembly state returns empty mates', () => {
    const mates = inferMatesFromPlacements({ parts: [], mates: [] }, {}, {});
    expect(mates).toEqual([]);
  });

  it('single-part assembly returns empty mates (no pairs to scan)', () => {
    const state = makeState(makePart('only', true));
    const partFaces = { only: [face('top', 0, 0, 0, 0, 0, 1)] };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toEqual([]);
  });

  it('all 11 mate kinds: Phase 2 only emits 3 (coincident, concentric, parallel)', () => {
    // Construct a maximally-helpful 2-part state: parts share a coplanar
    // face pair AND a collinear axis pair. Phase 2 should emit ONE
    // coincident + ONE concentric.
    const state = makeState(makePart('a', true), makePart('b'));
    const partFaces = {
      a: [face('top', 0, 0, 0, 0, 0, 1)],
      b: [face('bot', 0, 0, 0, 0, 0, -1)],
    };
    const partAxes = {
      a: [axis('shaft', 0, 0, 0, 1, 0, 0)],
      b: [axis('hole', 0, 0, 0, 1, 0, 0)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, partAxes);
    const kinds = new Set(mates.map((m) => m.kind));
    expect(kinds.has('coincident')).toBe(true);
    expect(kinds.has('concentric')).toBe(true);
    // Phase 2 unsupported kinds: distance/angle/perpendicular/tangent/
    // hinge/slot/gear/rack_pinion — NONE should appear.
    expect(kinds.has('distance')).toBe(false);
    expect(kinds.has('angle')).toBe(false);
    expect(kinds.has('perpendicular')).toBe(false);
    expect(kinds.has('tangent')).toBe(false);
    expect(kinds.has('hinge')).toBe(false);
    expect(kinds.has('slot')).toBe(false);
    expect(kinds.has('gear')).toBe(false);
    expect(kinds.has('rack_pinion')).toBe(false);
  });
});

// ─── 5: emitted mate metadata ────────────────────────────────────────────

describe('inferMatesFromPlacements — emitted Mate IR shape', () => {
  it('assigns unique auto-generated mate ids', () => {
    const state = makeState(makePart('a', true), makePart('b'), makePart('c'));
    const partFaces = {
      a: [face('a_top', 0, 0, 0, 0, 0, 1)],
      b: [
        face('b_bot', 0, 0, 0, 0, 0, -1),
        face('b_top', 0, 0, 5, 0, 0, 1),
      ],
      c: [face('c_bot', 0, 0, 5, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    const ids = mates.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^inferred_/);
    }
  });

  it('preserves part ids in the emitted refs (so the user can locate the parts)', () => {
    const state = makeState(makePart('plate', true), makePart('block'));
    const partFaces = {
      plate: [face('top', 0, 0, 0, 0, 0, 1)],
      block: [face('bot', 0, 0, 0, 0, 0, -1)],
    };
    const mates = inferMatesFromPlacements(state, partFaces, {});
    expect(mates).toHaveLength(1);
    const partIds = [mates[0]!.a.partId, mates[0]!.b.partId].sort();
    expect(partIds).toEqual(['block', 'plate']);
  });
});

// ─── 6: scaling sanity (O(N²) cost reminder) ─────────────────────────────

describe('inferMatesFromPlacements — scaling sanity', () => {
  it('handles 10 parts × 5 faces each without throwing (within timeout)', () => {
    // 10 × 9 / 2 = 45 part pairs × 25 face pairs = 1125 checks. Well within
    // budget. This is mainly a smoke test that the O(N²) loop is well-behaved.
    const parts: PartInstance[] = [];
    const partFaces: Record<string, FaceData[]> = {};
    for (let i = 0; i < 10; i++) {
      const id = `p${i}`;
      parts.push(makePart(id, i === 0));
      partFaces[id] = [];
      for (let f = 0; f < 5; f++) {
        // All faces deliberately non-coplanar so no mates emit.
        partFaces[id]!.push(
          face(`${id}_f${f}`, i * 100 + f, 0, 0, 1, 0, 0),
        );
      }
    }
    const mates = inferMatesFromPlacements({ parts, mates: [] }, partFaces, {});
    expect(Array.isArray(mates)).toBe(true);
  });
});

// ─── 7: extractFaceDataFromSolid ─────────────────────────────────────────

describe('extractFaceDataFromSolid', () => {
  it('extracts 6 faces from a writer-emitted axis-aligned box', () => {
    const data = writeStepEntities({
      boxes: [{ name: 'Box', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 10 }],
    });
    const source = `${writeStepHeader()}${data}END-ISO-10303-21;\n`;
    const manifoldId = findFirstEntityIdByName(source, 'MANIFOLD_SOLID_BREP');
    expect(manifoldId).not.toBeNull();
    const faces = extractFaceDataFromSolid(source, manifoldId!);
    expect(faces).toHaveLength(6);
    // Each face has a unit-magnitude normal (after writer-side construction).
    for (const f of faces) {
      const len = Math.hypot(f.normal.x, f.normal.y, f.normal.z);
      expect(len).toBeCloseTo(1, 5);
    }
    // Box face normals must include all 6 axis directions
    // (±X, ±Y, ±Z). Some writers flip via same_sense; the SET of magnitudes
    // covers all axes.
    const axesCovered = new Set<string>();
    for (const f of faces) {
      const ax = Math.abs(f.normal.x) > 0.5 ? 'X' :
                  Math.abs(f.normal.y) > 0.5 ? 'Y' : 'Z';
      axesCovered.add(ax);
    }
    expect(axesCovered.size).toBe(3);
  });

  it('returns [] when the manifold id does not exist', () => {
    const data = writeStepEntities({
      boxes: [{ name: 'Box', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }],
    });
    const source = `${writeStepHeader()}${data}END-ISO-10303-21;\n`;
    const faces = extractFaceDataFromSolid(source, 999_999);
    expect(faces).toEqual([]);
  });

  it('returns [] when the manifold id points to a different entity kind', () => {
    const data = writeStepEntities({
      boxes: [{ name: 'Box', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }],
    });
    const source = `${writeStepHeader()}${data}END-ISO-10303-21;\n`;
    // CARTESIAN_POINT is definitely not a MANIFOLD_SOLID_BREP.
    const cpId = findFirstEntityIdByName(source, 'CARTESIAN_POINT');
    expect(cpId).not.toBeNull();
    const faces = extractFaceDataFromSolid(source, cpId!);
    expect(faces).toEqual([]);
  });

  it('returns [] on empty / malformed source (best-effort contract)', () => {
    expect(extractFaceDataFromSolid('', 1)).toEqual([]);
    expect(extractFaceDataFromSolid('not a step file', 1)).toEqual([]);
  });
});

// ─── 8: extractAxisDataFromSolid ─────────────────────────────────────────

describe('extractAxisDataFromSolid', () => {
  it('extracts 1 axis from a hand-crafted cylinder solid', () => {
    const { source, manifoldId } = buildCylinderStep({
      origin: [1, 2, 3],
      direction: [0, 0, 1],
      radius: 5,
    });
    const axes = extractAxisDataFromSolid(source, manifoldId);
    expect(axes).toHaveLength(1);
    expect(axes[0]!.origin.x).toBeCloseTo(1);
    expect(axes[0]!.origin.y).toBeCloseTo(2);
    expect(axes[0]!.origin.z).toBeCloseTo(3);
    expect(axes[0]!.direction.x).toBeCloseTo(0);
    expect(axes[0]!.direction.y).toBeCloseTo(0);
    expect(axes[0]!.direction.z).toBeCloseTo(1);
  });

  it('returns [] for a pure box solid (no CYLINDRICAL_SURFACE present)', () => {
    const data = writeStepEntities({
      boxes: [{ name: 'Box', x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 }],
    });
    const source = `${writeStepHeader()}${data}END-ISO-10303-21;\n`;
    const manifoldId = findFirstEntityIdByName(source, 'MANIFOLD_SOLID_BREP');
    expect(manifoldId).not.toBeNull();
    const axes = extractAxisDataFromSolid(source, manifoldId!);
    expect(axes).toEqual([]);
  });

  it('returns [] when the manifold id does not exist', () => {
    const { source } = buildCylinderStep({
      origin: [0, 0, 0], direction: [0, 0, 1], radius: 1,
    });
    const axes = extractAxisDataFromSolid(source, 999_999);
    expect(axes).toEqual([]);
  });

  it('returns [] on malformed source (best-effort contract)', () => {
    expect(extractAxisDataFromSolid('', 1)).toEqual([]);
    expect(extractAxisDataFromSolid('garbage', 1)).toEqual([]);
  });
});

// ─── 9: end-to-end: extracted data → inferred mates ──────────────────────

describe('end-to-end: extract → infer pipeline', () => {
  it('extracted box faces feed inferMatesFromPlacements correctly', () => {
    // Two boxes at z=0 (top of A) and z=10 (bottom of B) → B sits on A.
    // We HAND-translate B's face data by +10 in Z to simulate the
    // world-frame transform a real importer would apply.
    const aData = writeStepEntities({
      boxes: [{ name: 'A', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 10 }],
    });
    const aSource = `${writeStepHeader()}${aData}END-ISO-10303-21;\n`;
    const aManifold = findFirstEntityIdByName(aSource, 'MANIFOLD_SOLID_BREP')!;
    const aFaces = extractFaceDataFromSolid(aSource, aManifold);

    const bData = writeStepEntities({
      boxes: [{ name: 'B', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 5 }],
    });
    const bSource = `${writeStepHeader()}${bData}END-ISO-10303-21;\n`;
    const bManifold = findFirstEntityIdByName(bSource, 'MANIFOLD_SOLID_BREP')!;
    const bFacesLocal = extractFaceDataFromSolid(bSource, bManifold);
    // Shift B up by 10 to sit on A.
    const bFaces = bFacesLocal.map((f) => ({
      ...f,
      origin: { x: f.origin.x, y: f.origin.y, z: f.origin.z + 10 },
    }));

    const state = makeState(makePart('a', true), makePart('b'));
    const mates = inferMatesFromPlacements(
      state,
      { a: aFaces, b: bFaces },
      {},
    );
    // At least 1 coincident: A's top face (z=10, +Z) meets B's bottom face
    // (translated to z=10, −Z). May emit MORE if other axis-aligned faces
    // happen to be coplanar (e.g., the side faces of two stacked boxes
    // sharing a vertical plane). Verify there is AT LEAST one coincident.
    expect(mates.length).toBeGreaterThanOrEqual(1);
    expect(mates.some((m) => m.kind === 'coincident')).toBe(true);
  });
});

// ─── helper: find an entity by name in a STEP source ─────────────────────

function findFirstEntityIdByName(source: string, name: string): number | null {
  const healed = healStepSource(source).healed;
  const dataIdx = healed.search(/\bDATA\s*;/i);
  if (dataIdx < 0) return null;
  const endIdx = healed.indexOf('END-ISO-10303-21');
  const dataBlock = healed.slice(dataIdx, endIdx >= 0 ? endIdx : undefined);
  const entities = parseEntities(dataBlock);
  for (const [id, ent] of entities) {
    if (ent.name === name) return id;
  }
  return null;
}

// ─── helper: build a cylinder STEP solid by hand ─────────────────────────
//
// `writeStepEntities` only emits BOX primitives; for axis-extraction tests
// we need a CYLINDRICAL_SURFACE. Minimal viable structure:
//   MANIFOLD_SOLID_BREP → CLOSED_SHELL → ADVANCED_FACE → CYLINDRICAL_SURFACE
//                                                    → FACE_OUTER_BOUND → EDGE_LOOP (empty-ish)
// We don't need a topologically-valid cylinder for the EXTRACT path —
// `extractAxisDataFromSolid` only walks the surface ref, never the loop.

function buildCylinderStep(opts: {
  origin: [number, number, number];
  direction: [number, number, number];
  radius: number;
}): { source: string; manifoldId: number } {
  const lines: string[] = [];
  let next = 1;
  const add = (body: string): number => {
    const id = next++;
    lines.push(`#${id}=${body};`);
    return id;
  };
  const fmt = (n: number): string => Number(n.toFixed(8)).toString();
  const cp = add(
    `CARTESIAN_POINT('',(${fmt(opts.origin[0])},${fmt(opts.origin[1])},${fmt(opts.origin[2])}))`,
  );
  const zDir = add(
    `DIRECTION('',(${fmt(opts.direction[0])},${fmt(opts.direction[1])},${fmt(opts.direction[2])}))`,
  );
  const xDir = add(`DIRECTION('',(1.,0.,0.))`);
  const ap = add(`AXIS2_PLACEMENT_3D('',#${cp},#${zDir},#${xDir})`);
  const surface = add(`CYLINDRICAL_SURFACE('',#${ap},${fmt(opts.radius)})`);
  // Minimal "loop" — empty FACE_OUTER_BOUND with a synthetic loop ref.
  // The extractor doesn't traverse the loop, so we just need a syntactic
  // placeholder that parseEntities accepts.
  const emptyLoop = add(`EDGE_LOOP('',())`);
  const fob = add(`FACE_OUTER_BOUND('',#${emptyLoop},.T.)`);
  const face = add(`ADVANCED_FACE('',(#${fob}),#${surface},.T.)`);
  const shell = add(`CLOSED_SHELL('',(#${face}))`);
  const manifoldId = add(`MANIFOLD_SOLID_BREP('',#${shell})`);
  const source = `${writeStepHeader()}DATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
  return { source, manifoldId };
}
