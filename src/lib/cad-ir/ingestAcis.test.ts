/**
 * ingestAcis.test.ts — the verified-reconstruction gate on DWG-3D / ACIS planar solids (Phase 2).
 *
 * Proves the honest slice:
 *   - a PLANAR ACIS solid (reconstructed faithfully by satImport) gets a REAL passthrough PASS,
 *   - a WRONG candidate against that faithful source IR FAILS,
 *   - a curved / box-only body reports honestly ('unavailable', reason acis_curved_no_kernel) —
 *     never a fabricated pass on a bounding box,
 *   - a MIXED import (some planar, some box) refuses to green-check ('unavailable', partial).
 *
 * No third-party CAD binaries: the planar ACIS fixture is synthesized in-repo by writing a box
 * mesh to SAT text (satExport.writeSatText) and reading it back (satImport.parseSatBodies), i.e.
 * the same round-trip satExport already validates against.
 */

import { describe, it, expect } from 'vitest';
import { solidBox } from './meshAnalysis';
import { verifyReconstruction } from './gate';
import { polyhedronToSoup, polyhedronToIr, acisReconstructionGate } from './ingestAcis';
import { writeSatText } from '@/lib/brep-bridge/satExport';
import { parseSatBodies, satToNexyfabAssembly } from '@/lib/brep-bridge/satImport';

/** A watertight solid box (planar faces) as a PolyMesh for satExport. */
function boxMesh(w: number, d: number, h: number) {
  const b = solidBox(w, d, h);
  return { verts: b.verts, faces: b.faces };
}

describe('polyhedronToIr — faithful planar measurement', () => {
  it('measures real volume / bbox / watertight from a planar polyhedron', () => {
    const b = solidBox(10, 20, 30);
    const soup = polyhedronToSoup(b.verts, b.faces, 1);
    const r = polyhedronToIr(soup, { path: 'box.acis', name: 'box' });
    expect(r.ok).toBe(true);
    expect(r.ir).not.toBeNull();
    const ir = r.ir!;
    expect(ir.mesh?.watertight).toBe(true);
    // 10*20*30 = 6000, not the 4*r^2*h a bounding-box flatten would give.
    expect(ir.mesh?.volume_mm3).toBeGreaterThan(5999);
    expect(ir.mesh?.volume_mm3).toBeLessThan(6001);
    expect(ir.extent?.units).toBe('mm');
    expect(ir.extent?.units_source).toBe('declared');
    expect(ir.extent?.size).toEqual([10, 20, 30]);
    expect(ir.reconstruct?.grade).toBe('A');
  });

  it('honors unitMm scaling (model-unit -> mm)', () => {
    const b = solidBox(1, 1, 1);
    const soup = polyhedronToSoup(b.verts, b.faces, 25.4); // inch model -> mm
    const r = polyhedronToIr(soup, { path: 'in.acis', name: 'in' });
    expect(r.ir?.extent?.size?.[0]).toBeCloseTo(25.4, 6);
  });
});

describe('ACIS SAT round-trip — planar solid gets a REAL passthrough PASS', () => {
  const sat = writeSatText(boxMesh(10, 20, 30), { unitMm: 1 });

  it('writeSatText produces a valid planar SAT body', () => {
    expect(sat.ok).toBe(true);
  });

  it('parseSatBodies recovers a faithful planar polyhedron (not a box)', () => {
    expect(sat.ok).toBe(true);
    if (!sat.ok) return;
    const parsed = parseSatBodies(sat.text);
    expect(parsed.ok).toBe(true);
    const poly = parsed.bodies?.[0]?.poly;
    expect(poly).toBeTruthy();
    expect(poly!.verts.length).toBe(8);
    expect(Math.abs(poly!.volume)).toBeGreaterThan(5999);
    expect(Math.abs(poly!.volume)).toBeLessThan(6001);
  });

  it('gate PASSES the planar reconstruction (passthrough, source == candidate)', () => {
    expect(sat.ok).toBe(true);
    if (!sat.ok) return;
    const parsed = parseSatBodies(sat.text);
    const poly = parsed.bodies![0].poly!;
    const soup = polyhedronToSoup(poly.verts, poly.faces, parsed.unitMm ?? 1);
    const src = polyhedronToIr(soup, { path: 'box.sat', name: 'box' });
    expect(src.ok).toBe(true);
    const g = verifyReconstruction({ kind: 'triangles', triangles: soup }, src.ir!);
    expect(g.passed).toBe(true);
    expect(g.score).toBeGreaterThanOrEqual(0.85);
  });

  it('acisReconstructionGate on the full assembly -> PASS, mode passthrough', () => {
    expect(sat.ok).toBe(true);
    if (!sat.ok) return;
    const asm = satToNexyfabAssembly(sat.text);
    expect(asm.ok).toBe(true);
    const verdict = acisReconstructionGate(asm.assembly, { format: 'SAT', name: 'box' });
    expect(verdict).toBeDefined();
    expect(verdict!.status).toBe('pass');
    if (verdict!.status === 'pass') {
      expect(verdict!.mode).toBe('passthrough');
      expect(verdict!.score).toBeGreaterThanOrEqual(0.85);
    }
  });
});

describe('a WRONG candidate FAILS against the faithful source IR', () => {
  it('a differently-sized box fails the gate (bbox mismatch)', () => {
    const good = solidBox(10, 20, 30);
    const srcSoup = polyhedronToSoup(good.verts, good.faces, 1);
    const src = polyhedronToIr(srcSoup, { path: 'box.sat', name: 'box' });
    expect(src.ok).toBe(true);

    const wrong = solidBox(10, 20, 60); // Z doubled — a hallucinated reconstruction
    const wrongSoup = polyhedronToSoup(wrong.verts, wrong.faces, 1);
    const g = verifyReconstruction({ kind: 'triangles', triangles: wrongSoup }, src.ir!);
    expect(g.passed).toBe(false);
  });
});

describe('curved / box-only ACIS reports HONESTLY (no fake pass)', () => {
  it('all-box assembly -> unavailable, reason acis_curved_no_kernel', () => {
    const assembly = {
      parts: [
        { id: 'b1', type: 'box', fidelity: 'aabb-approximation', params: { width: 10, depth: 20, height: 30 } },
      ],
      note: 'curved ACIS cone -> AABB box',
    };
    const verdict = acisReconstructionGate(assembly, { fallbackReason: 'acis_curved_no_kernel' });
    expect(verdict).toBeDefined();
    expect(verdict!.status).toBe('unavailable');
    if (verdict!.status === 'unavailable') {
      expect(verdict!.reason).toContain('acis_curved_no_kernel');
    }
  });

  it('mixed assembly (planar + box) -> unavailable, reason acis_curved_partial (never a green check)', () => {
    const b = solidBox(10, 20, 30);
    const sv = b.verts.map((v) => [v[0], v[1], v[2]]);
    const assembly = {
      parts: [
        { id: 'p1', type: 'mesh', fidelity: 'brep-polyhedron', params: { verts: sv, faces: b.faces } },
        { id: 'p2', type: 'box', fidelity: 'aabb-approximation', params: { width: 5, depth: 5, height: 5 } },
      ],
      note: 'mixed',
    };
    const verdict = acisReconstructionGate(assembly, { fallbackReason: 'acis_curved_no_kernel' });
    expect(verdict).toBeDefined();
    expect(verdict!.status).toBe('unavailable');
    if (verdict!.status === 'unavailable') {
      expect(verdict!.reason).toContain('acis_curved_partial');
    }
  });

  it('assembly with no fidelity signal -> undefined (nothing to say)', () => {
    expect(acisReconstructionGate({ parts: [] })).toBeUndefined();
    expect(acisReconstructionGate(null)).toBeUndefined();
  });
});
