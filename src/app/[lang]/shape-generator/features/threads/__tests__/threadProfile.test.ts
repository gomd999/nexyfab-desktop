/**
 * threadProfile.test.ts — Wave 2 Phase 2 Track D7 (W7).
 *
 * Verifies the 60° V-thread cross-section builder used by the sweep.
 * ISO 68-1 angles + truncation per spec §7.2.
 */

import { describe, it, expect } from 'vitest';
import {
  buildThreadProfile,
  profileRadialExtent,
  profileAxialExtent,
  profileSelfIntersects,
  DEFAULT_ROOT_RADIUS_COEFF,
  DEFAULT_CREST_TRUNCATION_COEFF,
  type ProfileSpec,
} from '../threadProfile';

// M8 × 1.25 → H = (√3/2)·1.25 = 1.0825 mm
const M8_SPEC: ProfileSpec = {
  pitch: 1.25,
  threadHeight: 1.0825,
};

describe('buildThreadProfile — basic shape', () => {
  it('returns a non-empty polygon', () => {
    const pts = buildThreadProfile(M8_SPEC);
    expect(pts.length).toBeGreaterThan(3);
  });

  it('contains at least 4 points by default (crest start, root, crest end, close)', () => {
    const pts = buildThreadProfile(M8_SPEC);
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });

  it('rounded-root profile has the same vertex count as sharp-root (client-side chamfer mode)', () => {
    // The client-side D7 profile uses a chamfer (two tangent points) in
    // place of a true arc — the OCCT worker can later supply rootArcSegments
    // arc samples. Both shapes have the same vertex count (lower tangent
    // OR sharp apex; upper tangent OR sharp apex; plus two crest corners).
    const sharp = buildThreadProfile({ ...M8_SPEC, rootRadius: 0 });
    const rounded = buildThreadProfile({ ...M8_SPEC });
    expect(rounded.length).toBe(sharp.length);
  });
});

describe('buildThreadProfile — coordinates & extent', () => {
  it('axial extent ≤ pitch (rounded root shrinks the extent slightly)', () => {
    const pts = buildThreadProfile(M8_SPEC);
    expect(profileAxialExtent(pts)).toBeLessThanOrEqual(1.25 + 1e-9);
    expect(profileAxialExtent(pts)).toBeGreaterThan(0.5 * 1.25);
  });

  it('sharp-root profile axial extent EQUALS the pitch (no chamfer)', () => {
    const pts = buildThreadProfile({ ...M8_SPEC, rootRadius: 0 });
    expect(profileAxialExtent(pts)).toBeCloseTo(1.25, 3);
  });

  it('radial extent ≈ (5/8)·H (the engagement crest radial)', () => {
    const pts = buildThreadProfile(M8_SPEC);
    const radialMax = Math.max(...pts.map((p) => p[0]));
    const radialMin = Math.min(...pts.map((p) => p[0]));
    // Engagement crest radial per ISO 68-1: 5/8 · H. The default
    // crestTruncation knob is additive ON TOP of engagement; when the
    // caller omits it (M8_SPEC has no crestTruncation field), the crest
    // sits at the engagement plane.
    const engagement = (5 / 8) * M8_SPEC.threadHeight;
    expect(radialMax).toBeCloseTo(engagement, 3);
    // root radial = 0 (or rounded slightly +) at the apex side
    expect(radialMin).toBeGreaterThanOrEqual(0);
  });

  it('crest radial is positive (V sticks OUT of the cylinder)', () => {
    const pts = buildThreadProfile(M8_SPEC);
    const radialMax = Math.max(...pts.map((p) => p[0]));
    expect(radialMax).toBeGreaterThan(0);
  });
});

describe('buildThreadProfile — crest truncation', () => {
  it('default crest truncation = H/8 (ISO 68-1)', () => {
    expect(DEFAULT_CREST_TRUNCATION_COEFF).toBe(1 / 8);
  });

  it('explicit crestTruncation > 0 widens the crest flat (extra truncation adds width)', () => {
    const baseline = buildThreadProfile(M8_SPEC);
    const extraTrunc = buildThreadProfile({ ...M8_SPEC, crestTruncation: 0.05 });
    // Both profiles share the same engagement-crest radial (= 5/8·H), but
    // the extra truncation widens the crest flat width — measurable via
    // the axial separation of the two highest-radial vertices.
    function crestFlatWidth(pts: ReadonlyArray<readonly [number, number]>): number {
      const maxR = Math.max(...pts.map((p) => p[0]));
      const ys = pts.filter((p) => Math.abs(p[0] - maxR) < 1e-6).map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    }
    expect(crestFlatWidth(extraTrunc)).toBeGreaterThan(crestFlatWidth(baseline));
  });

  it('rejects negative crestTruncation', () => {
    expect(() => buildThreadProfile({ ...M8_SPEC, crestTruncation: -0.1 })).toThrow();
  });
});

describe('buildThreadProfile — root truncation / rounding', () => {
  it('default rootRadius = 0.144·P (UNJ-style)', () => {
    expect(DEFAULT_ROOT_RADIUS_COEFF).toBe(0.144);
  });

  it('sharp root (rootRadius=0) produces an apex point at radial=0', () => {
    const sharp = buildThreadProfile({ ...M8_SPEC, rootRadius: 0 });
    const hasApex = sharp.some(([r]) => Math.abs(r) < 1e-9);
    expect(hasApex).toBe(true);
  });

  it('rejects negative rootRadius', () => {
    expect(() => buildThreadProfile({ ...M8_SPEC, rootRadius: -0.1 })).toThrow();
  });
});

describe('buildThreadProfile — validation', () => {
  it('throws on non-positive pitch', () => {
    expect(() => buildThreadProfile({ pitch: 0, threadHeight: 1 })).toThrow();
  });

  it('throws on non-positive threadHeight', () => {
    expect(() => buildThreadProfile({ pitch: 1, threadHeight: 0 })).toThrow();
  });
});

describe('buildThreadProfile — different pitches', () => {
  it('finer pitch (M8×1, P=1) shrinks axial extent (sharp root for exact = P)', () => {
    const fineP = buildThreadProfile({ pitch: 1.0, threadHeight: 0.866, rootRadius: 0 });
    expect(profileAxialExtent(fineP)).toBeCloseTo(1.0, 3);
  });

  it('coarser pitch produces larger axial extent (sharp root for exact = P)', () => {
    const m16 = buildThreadProfile({ pitch: 2.0, threadHeight: 1.732, rootRadius: 0 });
    expect(profileAxialExtent(m16)).toBeCloseTo(2.0, 3);
    expect(profileRadialExtent(m16)).toBeGreaterThan(
      profileRadialExtent(buildThreadProfile(M8_SPEC)),
    );
  });
});

describe('profileSelfIntersects — defensive check', () => {
  it('canonical 60° V profile does NOT self-intersect', () => {
    const pts = buildThreadProfile(M8_SPEC);
    expect(profileSelfIntersects(pts)).toBe(false);
  });

  it('manually-constructed crossing polygon DOES self-intersect', () => {
    // A bowtie quadrilateral (classic self-intersecting case).
    const bowtie = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ] as const;
    expect(profileSelfIntersects(bowtie as never)).toBe(true);
  });

  it('triangle (3 points) trivially passes', () => {
    const tri = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ] as const;
    expect(profileSelfIntersects(tri as never)).toBe(false);
  });
});
