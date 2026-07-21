/**
 * design-driver/fixturePlanner — deterministic planner over three known
 * briefs (WA-A acceptance fixtures). This is the WA-A stand-in for the
 * LLM planner (WA-D): same brief ⇒ same plan, byte-for-byte.
 *
 * Fixtures:
 *   'l-bracket'          — single L-profile prism, 5 measured dimensions.
 *   'stepped-shaft'      — two stacked cylinder steps (24-gon tessellated
 *                          extrudes — the executable circular-section path:
 *                          revolve/loft bodies have no NamedTopology
 *                          builder, so dimensioned circular geometry uses
 *                          polygon-tessellated extrudes whose cap vertices
 *                          lie EXACTLY on the true circle; the measurement
 *                          engine verifies concyclicity and returns the
 *                          exact diameter).
 *   'pin-block-assembly' — 2 parts + concentric/coincident mates + BOM.
 *
 * Unknown briefs are REFUSED with PlannerError (계획 날조 금지).
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import { PlannerError, type DesignPlanner } from './planner';
import type { DesignBrief, DesignPlan } from './types';

// ─── geometry helpers ────────────────────────────────────────────────────

/** CCW regular n-gon inscribed in the radius-r circle (vertices ON circle). */
export function circleLoop(radius: number, segments: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < segments; k++) {
    const t = (2 * Math.PI * k) / segments;
    pts.push({ x: radius * Math.cos(t), y: radius * Math.sin(t) });
  }
  return pts;
}

/** Exact volume of the n-gon-tessellated "cylinder" prism: (n/2)·r²·sin(2π/n)·h. */
export function tessellatedCylinderVolume(radius: number, segments: number, height: number): number {
  return (segments / 2) * radius * radius * Math.sin((2 * Math.PI) / segments) * height;
}

function extrude(loop: Array<{ x: number; y: number }>, depth: number): ExtrudeFeature {
  return { kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add' };
}

const CIRCLE_SEGMENTS = 24;

// ─── fixture 1: L-bracket ────────────────────────────────────────────────

/** W60 × H40 legs, thickness 8, depth 20 — L-profile prism. */
export function lBracketPlan(): DesignPlan {
  const W = 60, H = 40, T = 8, D = 20;
  const area = W * T + T * (H - T); // 736 mm² (shoelace-exact for the L)
  return {
    planId: 'fixture-l-bracket',
    name: 'L-Bracket 60×40×8 t=8 d=20',
    parts: [
      {
        partId: 'bracket',
        name: 'L-Bracket',
        material: 'AL6061',
        process: 'cnc',
        bodies: [
          {
            bodyId: 'main',
            feature: extrude(
              [
                { x: 0, y: 0 },
                { x: W, y: 0 },
                { x: W, y: T },
                { x: T, y: T },
                { x: T, y: H },
                { x: 0, y: H },
              ],
              D,
            ),
          },
        ],
        expectedVolume: {
          valueMm3: area * D, // 14720
          basis: `exact prism: L-profile area ${area} mm² (60·8 + 8·32) × depth ${D} mm — no tessellation`,
        },
      },
    ],
    drawing: {
      paperSize: 'A3',
      scale: 1,
      dimensions: [
        // top view shows the profile plane (x,y).
        { id: 'd_width', partId: 'bracket', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: W },
        { id: 'd_height', partId: 'bracket', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.5'], expected: H },
        { id: 'd_thickness', partId: 'bracket', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.bottom.0-1', 'e.bottom.2-3'], expected: T },
        // front view shows the extrude depth (x,z).
        { id: 'd_depth', partId: 'bracket', bodyId: 'main', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: D },
        { id: 'd_corner', partId: 'bracket', bodyId: 'main', view: 'top', kind: 'angular', refs: ['e.bottom.0-1', 'e.bottom.1-2'], expected: 90 },
      ],
    },
  };
}

// ─── fixture 2: stepped shaft ────────────────────────────────────────────

/** ⌀24×30 + ⌀16×25 two-step shaft (stacked tessellated-cylinder bodies). */
export function steppedShaftPlan(): DesignPlan {
  const R1 = 12, L1 = 30, R2 = 8, L2 = 25;
  const n = CIRCLE_SEGMENTS;
  const v1 = tessellatedCylinderVolume(R1, n, L1);
  const v2 = tessellatedCylinderVolume(R2, n, L2);
  const analytic = Math.PI * R1 * R1 * L1 + Math.PI * R2 * R2 * L2;
  const deviationPct = ((v1 + v2 - analytic) / analytic) * 100;
  return {
    planId: 'fixture-stepped-shaft',
    name: 'Stepped Shaft ⌀24×30 / ⌀16×25',
    parts: [
      {
        partId: 'shaft',
        name: 'Stepped Shaft',
        material: 'S45C',
        process: 'cnc',
        bodies: [
          { bodyId: 'step1', feature: extrude(circleLoop(R1, n), L1) },
          { bodyId: 'step2', feature: extrude(circleLoop(R2, n), L2), translate: { x: 0, y: 0, z: L1 } },
        ],
        expectedVolume: {
          valueMm3: v1 + v2,
          basis:
            `${n}-gon tessellated prisms: (n/2)·r²·sin(2π/n)·h per step = ${v1} + ${v2} mm³ (as-meshed 정확); ` +
            `analytic cylinders πr²h = ${analytic} mm³, tessellation deviation ${deviationPct.toFixed(3)}% (근사 명시)`,
        },
      },
    ],
    drawing: {
      paperSize: 'A3',
      scale: 1,
      dimensions: [
        { id: 'd_dia1', partId: 'shaft', bodyId: 'step1', view: 'top', kind: 'diametric', refs: ['f.cap.top'], expected: 2 * R1 },
        { id: 'd_dia2', partId: 'shaft', bodyId: 'step2', view: 'top', kind: 'diametric', refs: ['f.cap.top'], expected: 2 * R2 },
        { id: 'd_len1', partId: 'shaft', bodyId: 'step1', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: L1 },
        { id: 'd_len2', partId: 'shaft', bodyId: 'step2', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: L2 },
      ],
    },
  };
}

// ─── fixture 3: pin-block assembly ───────────────────────────────────────

/** 40×40×20 block (fixed) + ⌀10×30 pin, concentric + seated on top plane. */
export function pinBlockAssemblyPlan(): DesignPlan {
  const B = 40, BD = 20, PR = 5, PL = 30;
  const n = CIRCLE_SEGMENTS;
  const pinVol = tessellatedCylinderVolume(PR, n, PL);
  const pinAnalytic = Math.PI * PR * PR * PL;
  return {
    planId: 'fixture-pin-block',
    name: 'Pin-Block Assembly',
    parts: [
      {
        partId: 'block',
        name: 'Block',
        material: 'AL6061',
        process: 'cnc',
        bodies: [
          {
            bodyId: 'main',
            feature: extrude(
              [
                { x: 0, y: 0 },
                { x: B, y: 0 },
                { x: B, y: B },
                { x: 0, y: B },
              ],
              BD,
            ),
          },
        ],
        expectedVolume: {
          valueMm3: B * B * BD,
          basis: `exact prism: ${B}×${B} mm² square × depth ${BD} mm — no tessellation`,
        },
      },
      {
        partId: 'pin',
        name: 'Pin',
        material: 'SUS304',
        process: 'cnc',
        bodies: [{ bodyId: 'main', feature: extrude(circleLoop(PR, n), PL) }],
        expectedVolume: {
          valueMm3: pinVol,
          basis:
            `${n}-gon tessellated prism (n/2)·r²·sin(2π/n)·h = ${pinVol} mm³ (as-meshed 정확); ` +
            `analytic cylinder πr²h = ${pinAnalytic} mm³ (근사 명시)`,
        },
      },
    ],
    assembly: {
      parts: [
        {
          partId: 'block',
          fixed: true,
          refs: {
            boss_axis: { kind: 'axis', origin: { x: B / 2, y: B / 2, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            top_plane: { kind: 'plane', origin: { x: 0, y: 0, z: BD }, normal: { x: 0, y: 0, z: 1 } },
          },
        },
        {
          partId: 'pin',
          position: { x: 5, y: -3, z: 2 }, // deliberately off — the solve must move it
          refs: {
            axis: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            base_plane: { kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
          },
        },
      ],
      mates: [
        { id: 'm_concentric', kind: 'concentric', a: { partId: 'pin', refId: 'axis' }, b: { partId: 'block', refId: 'boss_axis' } },
        { id: 'm_seated', kind: 'coincident', a: { partId: 'pin', refId: 'base_plane' }, b: { partId: 'block', refId: 'top_plane' } },
      ],
      tolerance: 1e-6,
    },
    drawing: {
      paperSize: 'A3',
      scale: 1,
      dimensions: [
        { id: 'd_block_w', partId: 'block', bodyId: 'main', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: B },
        { id: 'd_block_d', partId: 'block', bodyId: 'main', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: BD },
        { id: 'd_pin_dia', partId: 'pin', bodyId: 'main', view: 'top', kind: 'diametric', refs: ['f.cap.top'], expected: 2 * PR },
        { id: 'd_pin_len', partId: 'pin', bodyId: 'main', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: PL },
      ],
    },
  };
}

// ─── fixture 4: revolve bushing (WB-1 — a TRUE revolve body, dims via f.lat) ─

/**
 * ⌀50 × 60 bushing built as a genuine `revolve` feature (not a tessellated
 * extrude) — the WB-1 path: buildRevolveMeasureTopo exposes the rim faces
 * `f.lat.{i}`, and the drawing gate REAL-measures ⌀/axial-length off them.
 * Profile [(0,0),(25,0),(25,60),(0,60)] swept 360° about Y; off-axis rims at
 * profile index 1 (y=0) and 2 (y=60) → f.lat.1 / f.lat.2.
 *
 * expectedVolume is omitted: the revolve mesh's watertight positive volume is
 * checked by the geometry gate, and the DIMENSIONS (⌀50, L60 measured on the
 * real rim vertices) are the rigorous correctness proof. (Adding a hand
 * tessellated-volume basis is deferred; the measured ⌀ already verifies the
 * rim is the true circle.)
 */
export function revolveBushingPlan(): DesignPlan {
  const R = 25, H = 60;
  const revolve: RevolveFeature = {
    kind: 'revolve',
    loop: [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: R, y: H }, { x: 0, y: H }],
    angleDegrees: 360,
    mode: 'add',
  };
  return {
    planId: 'fixture-revolve-bushing',
    name: `Revolve Bushing ⌀${2 * R}×${H}`,
    parts: [
      {
        partId: 'bushing',
        name: 'Revolve Bushing',
        material: 'S45C',
        process: 'cnc',
        bodies: [{ bodyId: 'body', feature: revolve }],
      },
    ],
    drawing: {
      paperSize: 'A3',
      scale: 1,
      dimensions: [
        // ⌀ on the axis-normal view (front); axial length on the axis-parallel
        // view (top). Refs are revolve rim faces f.lat.{i} (WB-1 namespace).
        { id: 'd_od', partId: 'bushing', bodyId: 'body', view: 'front', kind: 'diametric', refs: ['f.lat.1'], expected: 2 * R },
        { id: 'd_len', partId: 'bushing', bodyId: 'body', view: 'top', kind: 'linear', refs: ['f.lat.1', 'f.lat.2'], expected: H },
      ],
    },
  };
}

// ─── the planner ─────────────────────────────────────────────────────────

export type FixtureKey = 'l-bracket' | 'stepped-shaft' | 'pin-block-assembly' | 'revolve-bushing';

const FIXTURES: Record<FixtureKey, () => DesignPlan> = {
  'l-bracket': lBracketPlan,
  'stepped-shaft': steppedShaftPlan,
  'pin-block-assembly': pinBlockAssemblyPlan,
  'revolve-bushing': revolveBushingPlan,
};

/** Deterministic planner: dispatches on `brief.params.fixture` (fallback:
 *  `brief.id`). Unknown briefs are refused — never guessed. */
export const fixturePlanner: DesignPlanner = {
  name: 'fixture',
  plan(brief: DesignBrief): DesignPlan {
    const key = String(brief.params?.fixture ?? brief.id);
    const build = (FIXTURES as Record<string, (() => DesignPlan) | undefined>)[key];
    if (!build) {
      throw new PlannerError(
        `fixturePlanner: unknown brief '${key}' — known fixtures: ${Object.keys(FIXTURES).join(', ')}. ` +
          '계획을 추측으로 만들지 않는다 (LLM 플래너는 WA-D).',
      );
    }
    return build();
  },
};
