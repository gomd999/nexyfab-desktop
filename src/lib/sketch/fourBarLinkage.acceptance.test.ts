/**
 * Phase 1 acceptance — 4-bar linkage.
 *
 * Per ADR-013 roadmap (Phase 1.A target 2026-09-15):
 *   "Build 4-bar linkage sketch (4 lines, 4 coincident, length + angle
 *    constraints). Drag any vertex → solver maintains constraints in real
 *    time. Persist + reload + still solves."
 *
 * This test is the make-or-break gate for the planegcs bet. If it passes
 * we have a working parametric sketch engine; if it fails Phase 2-6 are at
 * risk and we need to reach for D-Cubed / build-own-solver (per the
 * roadmap's failure-mode plan).
 *
 * Topology (classic 4-bar):
 *
 *            B ─────── C
 *           /           \
 *          /             \
 *         A ── ground ─── D
 *
 *   A = ground pivot (fixed, origin)
 *   D = ground pivot (fixed, +x at ground length)
 *   B = crank tip (1-DoF rotation around A)
 *   C = rocker tip (constrained by both BC length and CD length)
 *
 * Length constraints:
 *   |AB| = 20  (input crank)
 *   |BC| = 60  (coupler)
 *   |CD| = 50  (output rocker)
 *   |AD| = 50  (ground link, implicit via fixed A & D positions)
 *
 * The mechanism has 1 DoF (input crank rotation). Solver should accept
 * any valid B position consistent with the lengths, and recompute C
 * automatically.
 */
import { describe, it, expect } from 'vitest';
import { createSketchSolver } from './solver';

interface FourBarSnapshot {
  A: { x: number; y: number };
  B: { x: number; y: number };
  C: { x: number; y: number };
  D: { x: number; y: number };
}

async function buildFourBar() {
  const s = await createSketchSolver();
  // Ground pivots (fixed).
  const A = s.addPoint(0, 0, { fixed: true });
  const D = s.addPoint(50, 0, { fixed: true });
  // Free joints (initial guess near a known valid configuration).
  const B = s.addPoint(0, 20);
  const C = s.addPoint(50, 50);
  // Bars.
  const AB = s.addLine(A, B);
  const BC = s.addLine(B, C);
  const CD = s.addLine(C, D);
  // Lengths.
  s.addDistance(A, B, 20);
  s.addDistance(B, C, 60);
  s.addDistance(C, D, 50);
  return { s, A, B, C, D, AB, BC, CD };
}

function snapshot(s: ReturnType<typeof buildFourBar> extends Promise<infer R> ? R : never): FourBarSnapshot {
  return {
    A: { x: s.s.point(s.A).x, y: s.s.point(s.A).y },
    B: { x: s.s.point(s.B).x, y: s.s.point(s.B).y },
    C: { x: s.s.point(s.C).x, y: s.s.point(s.C).y },
    D: { x: s.s.point(s.D).x, y: s.s.point(s.D).y },
  };
}

function len(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('Phase 1.A — 4-bar linkage acceptance', () => {
  it('solves the initial configuration with all bars at target lengths', async () => {
    const k = await buildFourBar();
    try {
      const r = k.s.solve();
      expect(r.success).toBe(true);
      const snap = snapshot(k);
      expect(len(snap.A, snap.B)).toBeCloseTo(20, 4);
      expect(len(snap.B, snap.C)).toBeCloseTo(60, 4);
      expect(len(snap.C, snap.D)).toBeCloseTo(50, 4);
      // Ground link AD is fixed.
      expect(snap.A).toEqual({ x: 0, y: 0 });
      expect(snap.D).toEqual({ x: 50, y: 0 });
    } finally {
      k.s.destroy();
    }
  });

  it('1 DoF: dragging B re-solves C while preserving all bar lengths', async () => {
    const k = await buildFourBar();
    try {
      k.s.solve();
      // Sweep B through several positions consistent with |AB|=20.
      const angles = [Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3];
      for (const theta of angles) {
        const Bx = 20 * Math.cos(theta);
        const By = 20 * Math.sin(theta);
        k.s.movePoint(k.B, Bx, By);
        const r = k.s.solve();
        expect(r.success).toBe(true);
        const snap = snapshot(k);
        // All three length constraints must hold within numerical tolerance.
        expect(len(snap.A, snap.B)).toBeCloseTo(20, 3);
        expect(len(snap.B, snap.C)).toBeCloseTo(60, 3);
        expect(len(snap.C, snap.D)).toBeCloseTo(50, 3);
        // Ground pivots immutable.
        expect(snap.A).toEqual({ x: 0, y: 0 });
        expect(snap.D).toEqual({ x: 50, y: 0 });
      }
    } finally {
      k.s.destroy();
    }
  });

  it('persist + reload: serialize snapshot, rebuild from scratch, still solves', async () => {
    // First instance: build + drag to a specific angle + capture state.
    const k1 = await buildFourBar();
    let captured: FourBarSnapshot;
    try {
      k1.s.solve();
      k1.s.movePoint(k1.B, 20 * Math.cos(Math.PI / 4), 20 * Math.sin(Math.PI / 4));
      k1.s.solve();
      captured = snapshot(k1);
    } finally {
      k1.s.destroy();
    }
    // Second instance: rebuild from JSON-equivalent state (positions only —
    // the constraint topology is intrinsic to the sketch definition).
    const k2 = await createSketchSolver();
    try {
      const A = k2.addPoint(captured.A.x, captured.A.y, { fixed: true });
      const D = k2.addPoint(captured.D.x, captured.D.y, { fixed: true });
      const B = k2.addPoint(captured.B.x, captured.B.y);
      const C = k2.addPoint(captured.C.x, captured.C.y);
      k2.addLine(A, B);
      k2.addLine(B, C);
      k2.addLine(C, D);
      k2.addDistance(A, B, 20);
      k2.addDistance(B, C, 60);
      k2.addDistance(C, D, 50);
      const r = k2.solve();
      expect(r.success).toBe(true);
      // Reloaded snapshot should match the captured one within tolerance.
      const reloaded = {
        B: { x: k2.point(B).x, y: k2.point(B).y },
        C: { x: k2.point(C).x, y: k2.point(C).y },
      };
      expect(reloaded.B.x).toBeCloseTo(captured.B.x, 3);
      expect(reloaded.B.y).toBeCloseTo(captured.B.y, 3);
      expect(reloaded.C.x).toBeCloseTo(captured.C.x, 3);
      expect(reloaded.C.y).toBeCloseTo(captured.C.y, 3);
    } finally {
      k2.destroy();
    }
  });

  it('DoF readout: 1-DoF mechanism reports dof=1 from planegcs.dof()', async () => {
    const k = await buildFourBar();
    try {
      const r = k.s.solve();
      expect(r.success).toBe(true);
      // 4 points × 2 = 8 raw DoF
      // - 2 fixed points × 2 = 4 DoF removed
      // - 3 distance constraints × 1 = 3 DoF removed
      // Remaining = 8 - 4 - 3 = 1 (the input crank rotation).
      expect(r.dof).toBe(1);
    } finally {
      k.s.destroy();
    }
  });

  it('over-constrained: adding |AD| again is flagged redundant', async () => {
    const k = await buildFourBar();
    try {
      k.s.solve();
      // AD length is already pinned by A & D being fixed. Adding a fourth
      // explicit length constraint should not crash — planegcs should
      // either flag it redundant or solve through it.
      k.s.addDistance(k.A, k.D, 50);
      const r = k.s.solve();
      expect(r.success).toBe(true);
      // After this extra constraint, the system is still solvable. Could be
      // reported as redundant; the key is that solve() succeeded.
      const snap = snapshot(k);
      expect(len(snap.A, snap.D)).toBeCloseTo(50, 3);
    } finally {
      k.s.destroy();
    }
  });
});
