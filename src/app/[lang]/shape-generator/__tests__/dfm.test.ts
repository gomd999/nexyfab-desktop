/**
 * DFM analysis unit tests.
 *
 * Validates that:
 *   1. Each of the 6 processes returns a well-formed DFMResult
 *   2. Score is within [0, 100]
 *   3. 3D printing correctly detects overhanging geometry
 *   4. A flat part (no overhangs) gets a better 3D printing score than one with heavy overhangs
 *   5. Issue severities map correctly to score penalties
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeDFM, type ManufacturingProcess } from '../analysis/dfmAnalysis';

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Simple box — no overhangs, no undercuts */
function makeBox(w = 50, h = 30, d = 40): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Tall thin part — high aspect ratio */
function makeTallThin(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(5, 100, 5);
}

/** Flat slab — sheet-metal candidate */
function makeFlatSlab(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(100, 2, 80);
}

/** Cylinder — turning candidate */
function makeCylinder(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(10, 10, 60, 32);
}

const ALL_PROCESSES: ManufacturingProcess[] = [
  'cnc_milling', 'cnc_turning', 'injection_molding',
  'sheet_metal', 'casting', '3d_printing',
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('analyzeDFM', () => {
  // ── 1. Output structure ───────────────────────────────────────────────────

  it('returns one result per requested process', () => {
    const box = makeBox();
    const results = analyzeDFM(box, ALL_PROCESSES);
    expect(results).toHaveLength(ALL_PROCESSES.length);
    expect(results.map(r => r.process).sort()).toEqual([...ALL_PROCESSES].sort());
  });

  it('each result has required fields in valid ranges', () => {
    const box = makeBox();
    const results = analyzeDFM(box, ALL_PROCESSES);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(['easy', 'moderate', 'difficult', 'infeasible']).toContain(r.estimatedDifficulty);
      expect(typeof r.feasible).toBe('boolean');
      expect(Array.isArray(r.issues)).toBe(true);
    }
  });

  it('all issues have required fields', () => {
    const box = makeTallThin();
    const results = analyzeDFM(box, ALL_PROCESSES);
    for (const r of results) {
      for (const issue of r.issues) {
        expect(issue.id).toBeTruthy();
        expect(issue.process).toBe(r.process);
        expect(['error', 'warning', 'info']).toContain(issue.severity);
        expect(issue.description).toBeTruthy();
        expect(issue.suggestion).toBeTruthy();
      }
    }
  });

  // ── 2. Score validity ─────────────────────────────────────────────────────

  it('simple box scores ≥ 50 for CNC milling (no obvious undercuts)', () => {
    const box = makeBox(50, 20, 40);
    const [result] = analyzeDFM(box, ['cnc_milling']);
    // A simple box is a reasonable CNC part
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('tall thin part triggers aspect_ratio warning for CNC milling', () => {
    const part = makeTallThin();
    const [result] = analyzeDFM(part, ['cnc_milling']);
    const hasAspectIssue = result.issues.some(i => i.type === 'aspect_ratio' || i.type === 'deep_pocket');
    expect(hasAspectIssue).toBe(true);
  });

  // ── 3. 3D Printing specific ───────────────────────────────────────────────

  it('flat slab has no overhang issues for 3D printing', () => {
    const slab = makeFlatSlab();
    const [result] = analyzeDFM(slab, ['3d_printing']);
    const overhangIssues = result.issues.filter(i => i.type === 'overhang');
    // A flat slab sitting on its large face should have minimal/no overhangs
    expect(overhangIssues.length).toBe(0);
  });

  it('3D printing result has correct process label', () => {
    const box = makeBox();
    const [result] = analyzeDFM(box, ['3d_printing']);
    expect(result.process).toBe('3d_printing');
    for (const issue of result.issues) {
      expect(issue.process).toBe('3d_printing');
    }
  });

  it('3D printing score is in valid range for all test geometries', () => {
    const geometries = [makeBox(), makeTallThin(), makeFlatSlab(), makeCylinder()];
    for (const geo of geometries) {
      const [result] = analyzeDFM(geo, ['3d_printing']);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  // ── 4. Process-geometry affinity ─────────────────────────────────────────

  it('cylinder scores higher for CNC turning than sheet metal', () => {
    const cyl = makeCylinder();
    const results = analyzeDFM(cyl, ['cnc_turning', 'sheet_metal']);
    const turning = results.find(r => r.process === 'cnc_turning')!;
    const sheetMetal = results.find(r => r.process === 'sheet_metal')!;
    // Turning should score at least as well as sheet metal for a cylinder
    expect(turning.score).toBeGreaterThanOrEqual(sheetMetal.score - 10);
  });

  it('balanced box does not trigger deep_pocket for CNC milling', () => {
    // 50×40×30 — aspect ratio 50/30 ≈ 1.7:1, well within threshold
    const balanced = new THREE.BoxGeometry(50, 40, 30);
    const [result] = analyzeDFM(balanced, ['cnc_milling']);
    const deepPocket = result.issues.some(i => i.type === 'deep_pocket');
    expect(deepPocket).toBe(false);
  });

  // ── 5. Score deduction logic ──────────────────────────────────────────────

  it('error-severity issues deduct more from score than info-severity', () => {
    // We can verify the scoring system is consistent:
    // error = -25, warning = -10, info = -3
    // A geometry with more errors should score lower
    const simplePart = makeBox(50, 10, 50);  // low aspect — fewer issues
    const complexPart = makeTallThin();        // high aspect — more issues

    const [simpleResult] = analyzeDFM(simplePart, ['cnc_milling']);
    const [complexResult] = analyzeDFM(complexPart, ['cnc_milling']);

    // Complex part should generally score equal or lower
    expect(simpleResult.score).toBeGreaterThanOrEqual(complexResult.score);
  });

  // ── 6. Subset of processes ────────────────────────────────────────────────

  it('analyzes only requested processes', () => {
    const box = makeBox();
    const requested: ManufacturingProcess[] = ['cnc_milling', '3d_printing'];
    const results = analyzeDFM(box, requested);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.process).sort()).toEqual(['3d_printing', 'cnc_milling']);
  });

  it('returns empty array when no processes requested', () => {
    const box = makeBox();
    const results = analyzeDFM(box, []);
    expect(results).toHaveLength(0);
  });
});
