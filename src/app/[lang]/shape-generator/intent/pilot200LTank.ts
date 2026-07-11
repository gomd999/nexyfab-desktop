// Pilot: 200L water-treatment coagulation tank (methodology §10 step 2,
// §11 위시빌더 reference case).
//
// Confirmed spec (담수화/200L 플랫폼 문서군):
//   inner Ø650, STS304 5t, straight shell 650H, cone 45° (height DERIVED),
//   4 baffles w=54 (≈T/12) t=4, shaft Ø25, single impeller Ø320 placed
//   300mm above the cone top.
//
// Domain rules enforced HERE in TS (not as decorative SCAD assert):
//   - cone angle ≥ 45° for self-draining sludge discharge (200L 플랫폼 규칙)
//   - impeller/baffle radial clearance must be positive (analytic §12.7.3
//     stand-in; the mesh assemblyInterference run comes later in the net)

import type { AssemblyIntent, ComponentIntent } from './schema';
import { rectSection, tankWallProfile, tankCavityProfile } from './sections';
import type { TankWallParams } from './sections';
import {
  MM3_PER_LITER,
  checkDiscVsRing,
  coneFrustumVolumeMm3,
  cylinderVolumeMm3,
} from './verify';
import type { InterferenceResult } from './verify';

export interface Tank200LSpec extends TankWallParams {
  baffleCount: number;
  baffleWidth: number;
  baffleThk: number;
  /** Baffle top stops this far below the shell top rim, mm. */
  baffleTopGap: number;
  shaftDia: number;
  impellerDia: number;
  impellerThk: number;
  /** Impeller centreline height above the cone top, mm. */
  impellerAboveCone: number;
  minConeAngleDeg: number;
}

export const TANK_200L_SPEC: Tank200LSpec = {
  innerDia: 650,
  wallThk: 5,
  cylinderH: 650,
  coneAngleDeg: 45,
  drainDia: 50,
  baffleCount: 4,
  baffleWidth: 54, // ≈ T/12
  baffleThk: 4,
  baffleTopGap: 50,
  shaftDia: 25,
  impellerDia: 320,
  impellerThk: 15,
  impellerAboveCone: 300,
  minConeAngleDeg: 45,
};

export interface Tank200LBuild {
  assembly: AssemblyIntent;
  derived: {
    coneHeightMm: number;
    totalHeightMm: number;
    /** Closed-form capacity: frustum + cylinder (liters). */
    capacityLiters: number;
    impellerBaffle: InterferenceResult;
  };
}

export function buildTank200L(spec: Tank200LSpec = TANK_200L_SPEC): Tank200LBuild {
  // ── Domain gates (§13 #1 intent-level DFM/process rules) ──────────────────
  if (spec.coneAngleDeg < spec.minConeAngleDeg) {
    throw new Error(
      `buildTank200L: cone angle ${spec.coneAngleDeg}° < ${spec.minConeAngleDeg}° — ` +
      'sludge will not self-drain (200L platform rule).',
    );
  }

  const wall = tankWallProfile(spec);
  const { coneHeightMm: coneH, innerRadiusMm: R, drainRadiusMm: rd } = wall.derived;

  // ── Analytic clearance gate: impeller sweep vs baffle inner face ──────────
  const baffleInnerR = R - spec.baffleWidth;
  const baffleZ: [number, number] = [coneH, coneH + spec.cylinderH - spec.baffleTopGap];
  const impellerZc = coneH + spec.impellerAboveCone;
  const impellerBaffle = checkDiscVsRing({
    discRadius: spec.impellerDia / 2,
    discZ: [impellerZc - spec.impellerThk / 2, impellerZc + spec.impellerThk / 2],
    obstacleInnerRadius: baffleInnerR,
    obstacleZ: baffleZ,
  });
  if (impellerBaffle.interferes) {
    throw new Error(
      `buildTank200L: impeller Ø${spec.impellerDia} overlaps baffles by ` +
      `${(-impellerBaffle.radialClearanceMm).toFixed(1)}mm — reduce impeller or baffle width.`,
    );
  }

  // ── Components ─────────────────────────────────────────────────────────────
  const vessel: ComponentIntent = {
    id: 'vessel',
    name: '200L cone-bottom vessel',
    shapeClass: 'revolute',
    material: { grade: 'STS304', thicknessMm: spec.wallThk },
    features: [
      { id: 'wall', kind: 'revolve', profile: wall.profile },
      // Record-kernel-only: soften the cone/shell junction weld line.
      {
        id: 'junction-fillet',
        kind: 'fillet',
        radius: 8,
        selector: { sourceFeature: 'wall', filter: 'HorizontalEdges', condition: { minLength: 10 } },
      },
    ],
  };

  const baffles: ComponentIntent = {
    id: 'baffles',
    name: `${spec.baffleCount}x wall baffles`,
    shapeClass: 'prismatic',
    material: { grade: 'STS304', thicknessMm: spec.baffleThk },
    features: [
      {
        id: 'baffle',
        kind: 'extrude',
        profile: rectSection('baffle-section', spec.baffleWidth, spec.baffleThk),
        height: spec.cylinderH - spec.baffleTopGap,
        at: { translate: [baffleInnerR, 0, coneH] },
        pattern: { type: 'circular', count: spec.baffleCount },
      },
    ],
  };

  const internals: ComponentIntent = {
    id: 'internals',
    name: 'shaft + impeller (visual stub)',
    shapeClass: 'revolute',
    features: [
      {
        id: 'shaft',
        kind: 'cylinder',
        diameter: spec.shaftDia,
        height: spec.cylinderH + 100,
        at: { translate: [0, 0, coneH] },
      },
      {
        id: 'impeller',
        kind: 'cylinder',
        diameter: spec.impellerDia,
        height: spec.impellerThk,
        centered: true,
        at: { translate: [0, 0, impellerZc] },
      },
    ],
  };

  const assembly: AssemblyIntent = {
    id: 'tank-200l',
    name: '200L coagulation tank',
    components: [
      { component: vessel },
      { component: baffles },
      { component: internals },
    ],
    joints: [
      { type: 'rigid', a: 'internals', b: 'internals' },
      // Impeller↔vessel is a declared clearance relation: contact = defect.
      { type: 'clearance', a: 'internals', b: 'baffles', allowedPenetrationMm: [0, 0] },
    ],
  };

  const capacityMm3 =
    coneFrustumVolumeMm3(rd, R, coneH) + cylinderVolumeMm3(R, spec.cylinderH);

  return {
    assembly,
    derived: {
      coneHeightMm: coneH,
      totalHeightMm: wall.derived.totalHeightMm,
      capacityLiters: capacityMm3 / MM3_PER_LITER,
      impellerBaffle,
    },
  };
}

/** Cavity profile exported for the Pappus cross-check test. */
export function tank200LCavityProfile(spec: Tank200LSpec = TANK_200L_SPEC) {
  return tankCavityProfile(spec);
}
