// Intent pipeline pilot tests (methodology §10 step 2).
//
// The core assertion strategy is the methodology's own §6.2 N-version idea
// applied to math: the SAME cavity volume is computed two independent ways
// (Pappus centroid theorem over the polygon vs closed-form cylinder+frustum)
// and must agree — a bug in either the section factory or the verifier
// breaks the agreement.

import { describe, expect, it } from 'vitest';

import { emitAssembly } from './emitOpenScad';
import {
  TANK_200L_SPEC,
  buildTank200L,
  tank200LCavityProfile,
} from './pilot200LTank';
import { routeFeature } from './schema';
import { channelSection, rectSection, tankWallProfile } from './sections';
import {
  MM3_PER_LITER,
  checkDiscVsRing,
  filletDeltaVMm3,
  pappusRevolveVolumeMm3,
  profileViolations,
  signedArea,
} from './verify';

describe('sections: tank wall profile', () => {
  it('is closed, simple, CCW, and clear of the revolve axis', () => {
    const wall = tankWallProfile(TANK_200L_SPEC);
    const violations = profileViolations(wall.profile, {
      minAxisOffset: TANK_200L_SPEC.drainDia / 2,
    });
    expect(violations).toEqual([]);
  });

  it('derives cone height from the angle (single source of truth)', () => {
    // (325 − 25) · tan 45° = 300 — the angle can never silently disagree
    // with the geometry, unlike a decorative cone_ang parameter.
    const wall = tankWallProfile(TANK_200L_SPEC);
    expect(wall.derived.coneHeightMm).toBeCloseTo(300, 9);
    expect(wall.derived.totalHeightMm).toBeCloseTo(950, 9);
    expect(wall.derived.outerRadiusMm).toBe(330);
  });

  it('rejects a drain-less cone (axis sliver guard, §1.1)', () => {
    expect(() => tankWallProfile({ ...TANK_200L_SPEC, drainDia: 0 })).toThrow(/sliver/);
  });

  it('rect and channel sections are valid emission profiles', () => {
    expect(profileViolations(rectSection('r', 54, 4))).toEqual([]);
    const ch = channelSection('c200', { depth: 200, flangeW: 75, webT: 7.5, flangeT: 11 });
    expect(profileViolations(ch)).toEqual([]);
    expect(signedArea(ch.points)).toBeGreaterThan(0);
  });
});

describe('verify: N-version volume cross-check', () => {
  it('Pappus volume of the cavity matches the closed-form capacity', () => {
    const build = buildTank200L();
    const pappusLiters =
      pappusRevolveVolumeMm3(tank200LCavityProfile()) / MM3_PER_LITER;
    // Two independent exact methods — agreement bounds float error only.
    expect(pappusLiters).toBeCloseTo(build.derived.capacityLiters, 6);
  });

  it('capacity covers the 200L working volume with headspace', () => {
    const { capacityLiters } = buildTank200L().derived;
    expect(capacityLiters).toBeGreaterThan(245);
    expect(capacityLiters).toBeLessThan(260);
    expect(capacityLiters).toBeGreaterThanOrEqual(200); // working volume fits
  });

  it('fillet ΔV estimator is positive and below the square bound', () => {
    const dv = filletDeltaVMm3(8, 2000);
    expect(dv).toBeGreaterThan(0);
    expect(dv).toBeLessThan(8 * 8 * 2000);
  });
});

describe('pilot: domain gates', () => {
  it('rejects cone angles below the sludge-discharge minimum', () => {
    expect(() => buildTank200L({ ...TANK_200L_SPEC, coneAngleDeg: 40 })).toThrow(/self-drain/);
  });

  it('passes the impeller/baffle clearance check with the confirmed Ø320', () => {
    const { impellerBaffle } = buildTank200L().derived;
    expect(impellerBaffle.interferes).toBe(false);
    // baffle inner face 325−54=271 vs impeller tip 160 → 111mm clear
    expect(impellerBaffle.radialClearanceMm).toBeCloseTo(111, 9);
    expect(impellerBaffle.zOverlapMm).toBeGreaterThan(0);
  });

  it('rejects an oversized impeller that sweeps into the baffles', () => {
    expect(() => buildTank200L({ ...TANK_200L_SPEC, impellerDia: 560 })).toThrow(/overlaps/);
  });

  it('disc-vs-ring check is exact at the boundary', () => {
    const graze = checkDiscVsRing({
      discRadius: 271,
      discZ: [500, 520],
      obstacleInnerRadius: 271,
      obstacleZ: [300, 900],
    });
    expect(graze.interferes).toBe(false); // touching = 0 clearance, not overlap
    expect(graze.radialClearanceMm).toBe(0);
  });
});

describe('emitOpenScad: draft kernel emission', () => {
  const scad = emitAssembly(buildTank200L().assembly, {
    headerComments: ['spec: 담수화/200L 플랫폼 확정 치수'],
  });

  it('emits the real revolve/extrude profiles (no square([10,10]) stubs)', () => {
    expect(scad).toContain('rotate_extrude(angle=360');
    expect(scad).toContain('linear_extrude(height=600)');
    expect(scad).toContain('[25, 0]');    // inner drain lip of the real wall section
    expect(scad).toContain('[325, 300]'); // inner cone→shell junction (derived coneH)
    expect(scad).not.toContain('square([10, 10]');
  });

  it('patterns the 4 baffles and places the internals', () => {
    expect(scad).toContain('for (a = [0 : 90 : 270])');
    expect(scad).toContain('translate([271, 0, 300])');
    expect(scad).toContain('cylinder(h=15, d=320, center=true');
  });

  it('tags record-kernel features and joints instead of faking them', () => {
    expect(scad).toContain('// @nfab fillet radius=8 source=wall filter=HorizontalEdges');
    expect(scad).toContain('// @nfab joint type=clearance a=internals b=baffles band=[0, 0]');
  });

  it('is structurally sound and deterministic', () => {
    const opens = (scad.match(/\{/g) ?? []).length;
    const closes = (scad.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(scad).not.toMatch(/NaN|undefined|Infinity/);
    // Same intent → byte-identical SCAD (content-hash caching prerequisite).
    expect(emitAssembly(buildTank200L().assembly, {
      headerComments: ['spec: 담수화/200L 플랫폼 확정 치수'],
    })).toBe(scad);
  });
});

describe('schema: kernel routing', () => {
  it('routes exact-only features to OCCT and the rest to the draft kernel', () => {
    expect(
      routeFeature({
        id: 'f', kind: 'fillet', radius: 3,
        selector: { sourceFeature: 'x', filter: 'AllEdges' },
      }),
    ).toBe('occt');
    expect(routeFeature({ id: 's', kind: 'shell', thickness: 2 })).toBe('occt');
    expect(
      routeFeature({ id: 'r', kind: 'revolve', profile: rectSection('p', 10, 10) }),
    ).toBe('openscad');
    expect(
      routeFeature({ id: 'c', kind: 'cylinder', diameter: 10, height: 10 }),
    ).toBe('openscad');
  });
});
