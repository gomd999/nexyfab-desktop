/**
 * miterFrame.test.ts — W5-E measured verification.
 *
 * All checks are measurements against hand-computed values:
 *   - section areas: shoelace vs analytic formulas / catalog areas,
 *   - member volume: mesh signed volume vs area × centroid-fibre length,
 *   - miter: cut-face angle measured off the generated mesh (45° at an
 *     orthogonal corner) and member-vs-member overlap volume via
 *     deterministic grid sampling (≈ 0 after miter),
 *   - cut list: square-frame lengths/quantities vs hand calculation.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  sectionPolygons,
  sectionPolygonsFromProfile,
  generateMemberGeometry,
  generateMiteredFrame,
  computeFrameCuts,
  measureMember,
  memberContainsPoint,
  meshSignedVolume,
  frameCutList,
  SECTION_TYPE,
  type MemberSpec,
  type FrameSegment,
} from './miterFrame';
import { PROFILE_CATALOG, findProfile } from './structuralMembers';
import { generateStructuralFrame } from '../features/weldment';

const SIZE = 40;
const T = 4;

// ── 1. Section polygons: analytic areas ──────────────────────────

describe('sectionPolygons — analytic cross-section areas', () => {
  it('rect tube 40x40x4 area = 40² − 32² = 576 mm²', () => {
    expect(sectionPolygons(SECTION_TYPE.RECT_TUBE, SIZE, T).areaMm2).toBeCloseTo(576, 6);
  });

  it('I-beam 40x40x4 area = 2·40·4 + 32·4 = 448 mm²', () => {
    expect(sectionPolygons(SECTION_TYPE.I_BEAM, SIZE, T).areaMm2).toBeCloseTo(448, 6);
  });

  it('L-angle 40x40x4 area = 40·4 + 36·4 = 304 mm²', () => {
    expect(sectionPolygons(SECTION_TYPE.L_ANGLE, SIZE, T).areaMm2).toBeCloseTo(304, 6);
  });

  it('round tube OD40x4 area ≈ π(20²−16²) = 452.39 mm² (48-gon, ~0.3 % low)', () => {
    const a = sectionPolygons(SECTION_TYPE.ROUND_TUBE, SIZE, T).areaMm2;
    const exact = Math.PI * (400 - 256);
    expect(Math.abs(a - exact) / exact).toBeLessThan(0.005);
  });

  it('solid rod D40 area ≈ π·20² = 1256.6 mm² (48-gon)', () => {
    const a = sectionPolygons(SECTION_TYPE.SOLID_ROD, SIZE, T).areaMm2;
    const exact = Math.PI * 400;
    expect(Math.abs(a - exact) / exact).toBeLessThan(0.005);
  });

  it('all five sectionTypes have pairwise distinct areas', () => {
    const areas = [0, 1, 2, 3, 4].map(k => sectionPolygons(k, SIZE, T).areaMm2.toFixed(3));
    expect(new Set(areas).size).toBe(5);
  });
});

describe('sectionPolygonsFromProfile — catalog dimensions', () => {
  it('every catalog profile yields a polygon within 5 % of catalog area (fillets not modeled)', () => {
    for (const p of PROFILE_CATALOG) {
      const poly = sectionPolygonsFromProfile(p);
      const rel = Math.abs(poly.areaMm2 - p.areaMm2) / p.areaMm2;
      expect(rel, `${p.id}: poly ${poly.areaMm2.toFixed(1)} vs catalog ${p.areaMm2}`).toBeLessThan(0.05);
    }
  });
});

// ── 2. Member solid: volume vs analytic ──────────────────────────

describe('generateMemberGeometry — mesh volume', () => {
  it('straight rect-tube member: volume = 576 mm² × 300 mm', () => {
    const spec: MemberSpec = {
      start: [0, 0, 0], end: [300, 0, 0],
      section: sectionPolygons(SECTION_TYPE.RECT_TUBE, SIZE, T),
    };
    const vol = meshSignedVolume(generateMemberGeometry(spec));
    expect(vol).toBeCloseTo(576 * 300, -1); // within 5 mm³ of 172800
  });

  it('45°-mitered rect-tube member: volume = area × centroid length (oblique-cut prism)', () => {
    // End cut on plane x+y=300 (normal (1,1,0)): the section centroid sits on
    // the axis, so V = A × 300 exactly, even though fibres run 280..320 mm.
    const spec: MemberSpec = {
      start: [0, 0, 0], end: [300, 0, 0],
      section: sectionPolygons(SECTION_TYPE.RECT_TUBE, SIZE, T),
      endCut: { point: [300, 0, 0], normal: [1, 1, 0] },
    };
    const vol = meshSignedVolume(generateMemberGeometry(spec));
    expect(vol).toBeCloseTo(576 * 300, -1);
    const m = measureMember(spec);
    expect(m.cutLengthMm).toBeCloseTo(320, 6);   // longest fibre (outer edge y = −20)
    expect(m.shortLengthMm).toBeCloseTo(280, 6); // shortest fibre (inner edge y = +20)
    expect(m.endMiterDeg).toBeCloseTo(45, 6);
    expect(m.startMiterDeg).toBe(0);
  });
});

// ── 3. Orthogonal corner: miter plane, cut-face angle, overlap ───

function lCornerSpecs(miter: boolean): [MemberSpec, MemberSpec] {
  const segments: FrameSegment[] = [
    { start: [0, 0, 0], end: [300, 0, 0] },
    { start: [300, 0, 0], end: [300, 300, 0] },
  ];
  const section = sectionPolygons(SECTION_TYPE.RECT_TUBE, SIZE, T);
  const cuts = miter ? computeFrameCuts(segments) : [{}, {}];
  return [
    { start: segments[0].start, end: segments[0].end, section, ...cuts[0] },
    { start: segments[1].start, end: segments[1].end, section, ...cuts[1] },
  ];
}

/** Deterministic grid-sampled overlap volume of two member solids (mm³). */
function overlapVolume(a: MemberSpec, b: MemberSpec): number {
  // Sampling box encloses the corner region where any overlap can occur.
  // Origins are deliberately offset (0.13/0.87/0.93) so no cell center lies
  // exactly on the shared miter plane x+y=300 — containment is boundary-
  // inclusive, and points exactly ON the cut plane belong to both solids
  // (a measure-zero set that a lattice aligned to the plane would count).
  const x0 = 275.13, x1 = 325, y0 = -24.87, y1 = 25, z0 = -20.93, z1 = 21;
  const step = 0.5;
  const cellVol = step * step * step;
  let count = 0;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let z = z0 + step / 2; z < z1; z += step) {
        if (memberContainsPoint(a, [x, y, z]) && memberContainsPoint(b, [x, y, z])) count++;
      }
    }
  }
  return count * cellVol;
}

describe('orthogonal corner miter', () => {
  it('computeFrameCuts assigns a 45° bisector plane to both member ends', () => {
    const cuts = computeFrameCuts([
      { start: [0, 0, 0], end: [300, 0, 0] },
      { start: [300, 0, 0], end: [300, 300, 0] },
    ]);
    expect(cuts[0].endCut).toBeDefined();
    expect(cuts[1].startCut).toBeDefined();
    // Same geometric plane through the node.
    const n = new THREE.Vector3(...cuts[0].endCut!.normal).normalize();
    // Bisector of +X and −Y (into-node dirs) is ±(1,1,0)/√2.
    expect(Math.abs(n.x)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(n.y)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('cut-face angle measured on the generated mesh is 45.00° to the member axis', () => {
    const [a] = lCornerSpecs(true);
    const geo = generateMemberGeometry(a);
    const pos = geo.getAttribute('position');
    // Collect triangles whose three vertices lie on the miter plane x+y=300.
    const axis = new THREE.Vector3(1, 0, 0);
    let capTris = 0;
    let worstDeg = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const v = [0, 1, 2].map(k => new THREE.Vector3(
        pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)));
      const onPlane = v.every(p => Math.abs(p.x + p.y - 300) < 1e-3);
      if (!onPlane) continue;
      const nrm = new THREE.Vector3()
        .crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0]));
      if (nrm.length() < 1e-9) continue;
      nrm.normalize();
      const deg = (Math.acos(Math.min(1, Math.abs(nrm.dot(axis)))) * 180) / Math.PI;
      capTris++;
      worstDeg = Math.max(worstDeg, Math.abs(deg - 45));
    }
    expect(capTris).toBeGreaterThan(0);
    expect(worstDeg).toBeLessThan(0.01);
     
    console.log(`[W5-E miter] end-cap triangles=${capTris} max |angle−45°|=${worstDeg.toExponential(2)} deg`);
  });

  it('overlap volume: un-mitered members interpenetrate, mitered overlap ≈ 0', () => {
    const [ua, ub] = lCornerSpecs(false);
    const [ma, mb] = lCornerSpecs(true);
    const rawOverlap = overlapVolume(ua, ub);
    const miteredOverlap = overlapVolume(ma, mb);
     
    console.log(`[W5-E overlap] butt=${rawOverlap.toFixed(1)} mm³  mitered=${miteredOverlap.toFixed(3)} mm³`);
    expect(rawOverlap).toBeGreaterThan(500);            // real interpenetration today
    expect(miteredOverlap).toBeLessThan(rawOverlap * 0.005); // ≥ 99.5 % removed
    expect(miteredOverlap).toBeLessThan(20);            // ≈ 0 in absolute terms
  });
});

// ── 4. Frame generation: sectionType actually changes the mesh ───

describe('generateStructuralFrame (weldment.ts) — sectionType materialized', () => {
  const segs: FrameSegment[] = [
    { start: [0, 0, 0], end: [300, 0, 0] },
    { start: [300, 0, 0], end: [300, 300, 0] },
  ];

  it('five sectionTypes produce five distinct frame meshes', () => {
    const sigs = [0, 1, 2, 3, 4].map(sectionType => {
      const g = generateStructuralFrame(segs, { sectionType, size: SIZE, thickness: T });
      const pos = g.getAttribute('position');
      let sum = 0;
      for (let i = 0; i < pos.count; i++) sum += pos.getX(i) + pos.getY(i) * 2 + pos.getZ(i) * 3;
      return `${pos.count}:${sum.toFixed(3)}`;
    });
    expect(new Set(sigs).size).toBe(5);
  });

  it('mitered frame volume = 2 members × area × axis length (centroid fibre)', () => {
    const g = generateStructuralFrame(segs, { sectionType: SECTION_TYPE.RECT_TUBE, size: SIZE, thickness: T });
    const vol = meshSignedVolume(g);
    expect(vol).toBeCloseTo(2 * 576 * 300, -2); // within 50 mm³ of 345600
  });
});

// ── 5. Cut list: square frame hand calculation ───────────────────

describe('frameCutList — 500 mm square frame, RECT-TUBE 40x40x4', () => {
  const L = 500;
  const segs: FrameSegment[] = [
    { start: [0, 0, 0], end: [L, 0, 0] },
    { start: [L, 0, 0], end: [L, L, 0] },
    { start: [L, L, 0], end: [0, L, 0] },
    { start: [0, L, 0], end: [0, 0, 0] },
  ];

  it('4 members → one line, qty 4, stock length 540 mm (500 + 2×20 miter), 45° both ends', () => {
    const frame = generateMiteredFrame(segs, { sectionType: SECTION_TYPE.RECT_TUBE, size: SIZE, thickness: T });
    expect(frame.members).toHaveLength(4);
    for (const m of frame.members) {
      // Hand calc: outer fibre runs corner-to-corner = L + size = 540 mm.
      expect(m.cutLengthMm).toBeCloseTo(L + SIZE, 6);
      expect(m.startMiterDeg).toBeCloseTo(45, 6);
      expect(m.endMiterDeg).toBeCloseTo(45, 6);
    }

    const cutList = frameCutList(frame);
    expect(cutList.entries).toHaveLength(1);
    expect(cutList.entries[0].quantity).toBe(4);
    expect(cutList.entries[0].lengthMm).toBeCloseTo(540, 6);
    expect(cutList.entries[0].endMiters).toEqual([45]);
    // Raw stock: 4 × 540 = 2160 mm.
    expect(cutList.rawLengthMm).toBeCloseTo(2160, 6);
    // Mass: 576 mm² × 7850 kg/m³ = 4.5216 kg/m × 0.54 m × 4 = 9.76666 kg.
    expect(cutList.totalMassKg).toBeCloseTo(4 * 0.54 * 4.5216, 4);
     
    console.log(`[W5-E cutlist] qty=${cutList.entries[0].quantity} len=${cutList.entries[0].lengthMm} raw=${cutList.rawLengthMm} mass=${cutList.totalMassKg.toFixed(4)} kg`);
  });

  it('catalog profile override: HSS50x50x3 uses catalog linear density 4.33 kg/m', () => {
    const profile = findProfile('HSS50x50x3')!;
    const frame = generateMiteredFrame(segs, {
      sectionType: SECTION_TYPE.RECT_TUBE, size: 50, thickness: 3, profile,
    });
    const cutList = frameCutList(frame, { profile });
    expect(cutList.entries).toHaveLength(1);
    expect(cutList.entries[0].profile).toBe(profile.name);
    // Stock length: 500 + profile depth 50 = 550 mm per member.
    expect(cutList.entries[0].lengthMm).toBeCloseTo(550, 6);
    expect(cutList.totalMassKg).toBeCloseTo(4 * 0.55 * 4.33, 4);
  });

  it('miter: false reproduces legacy butt lengths (axis length, 0° cuts)', () => {
    const frame = generateMiteredFrame(segs, {
      sectionType: SECTION_TYPE.RECT_TUBE, size: SIZE, thickness: T, miter: false,
    });
    for (const m of frame.members) {
      expect(m.cutLengthMm).toBeCloseTo(L, 6);
      expect(m.startMiterDeg).toBe(0);
      expect(m.endMiterDeg).toBe(0);
    }
  });
});
