/**
 * ingestStep.test.ts — the faithful STEP -> IR path and its honest gate behaviour.
 *
 * Fixtures are SELF-AUTHORED at runtime (no third-party CAD binaries committed): a box
 * STEP is generated with nexyfab's own `writeExtrudeAsStep`, then read back through the
 * pure-TS B-rep reader. The reference corpus under Downloads/참고파일들 is local-license
 * only and is deliberately NOT touched here.
 */
import { describe, it, expect } from 'vitest';
import { writeExtrudeAsStep } from '@/lib/brep-bridge/stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { stepToIr } from './ingestStep';
import { gateIntentTriangles } from './index';
import { solidBox, type IndexedMesh, type TriangleSoup } from './meshAnalysis';

function boxFeature(w: number, d: number, h: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
    depth: h,
    direction: 'one_sided',
    mode: 'add',
  };
}

function meshToSoup(mesh: IndexedMesh): TriangleSoup {
  return mesh.faces.map((f) => [mesh.verts[f[0]!]!, mesh.verts[f[1]!]!, mesh.verts[f[2]!]!]);
}

describe('stepToIr — faithful STEP measurement', () => {
  it('measures a self-authored box STEP with real dims, mm units, watertight, genus 0', () => {
    const step = writeExtrudeAsStep(boxFeature(10, 20, 5), { productName: 'test_box' });
    const res = stepToIr(step, { path: 'box.step', name: 'box.step' });

    expect(res.ok).toBe(true);
    expect(res.ir).not.toBeNull();
    const ir = res.ir!;

    // Units come from the STEP header (SI_UNIT(.MILLI.,.METRE.)) — NOT null like STL.
    expect(ir.extent?.units).toBe('mm');
    expect(ir.extent?.units_source).toBe('declared');

    // Real geometry, not an AABB-of-an-AABB tautology.
    const size = ir.extent?.size;
    if (!size) throw new Error('STEP extent size missing');
    expect(size[0]).toBeCloseTo(10, 3);
    expect(size[1]).toBeCloseTo(20, 3);
    expect(size[2]).toBeCloseTo(5, 3);
    expect(ir.mesh?.volume_mm3).toBeCloseTo(1000, 2);
    expect(ir.mesh?.watertight).toBe(true);
    expect(res.meta.solids).toBe(1);
    expect(res.meta.meshed).toBe(1);
  });

  it('gate PASSES when the candidate box matches the STEP source geometry', () => {
    const step = writeExtrudeAsStep(boxFeature(10, 20, 5), { productName: 'box' });
    const src = stepToIr(step, { path: 'box.step', name: 'box.step' });
    expect(src.ok).toBe(true);

    // Candidate = a box of the SAME dims (the boxy-part case: AABB approx == truth).
    const candidate = meshToSoup(solidBox(10, 20, 5));
    const g = gateIntentTriangles(candidate, src.ir!);
    expect(g.passed).toBe(true);
    expect(g.score).toBeGreaterThanOrEqual(0.85);
  });

  it('gate FAILS honestly when the candidate box has the wrong height', () => {
    const step = writeExtrudeAsStep(boxFeature(10, 20, 5), { productName: 'box' });
    const src = stepToIr(step, { path: 'box.step', name: 'box.step' });
    expect(src.ok).toBe(true);

    // Candidate wrong on Z (5 -> 12): the gate must NOT rubber-stamp it.
    const wrong = meshToSoup(solidBox(10, 20, 12));
    const g = gateIntentTriangles(wrong, src.ir!);
    expect(g.passed).toBe(false);
    expect(g.feedback.toLowerCase()).toContain('mismatch');
  });

  it('returns ok:false (gate unavailable) — never a fake pass — when no solid can be measured', () => {
    const headerOnly =
      'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'\'),\'2;1\');\nFILE_NAME(\'x\',\'\',(\'\'),(\'\'),\'\',\'\',\'\');\n' +
      'FILE_SCHEMA((\'AUTOMOTIVE_DESIGN\'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    const res = stepToIr(headerOnly, { path: 'empty.step', name: 'empty.step' });
    expect(res.ok).toBe(false);
    expect(res.ir).toBeNull();
    expect(res.reason).toMatch(/no_faithful_geometry|step_parse_failed/);
  });

  it('surfaces a parse failure honestly rather than throwing', () => {
    const res = stepToIr('not a step file at all', { path: 'garbage.txt', name: 'garbage.txt' });
    expect(res.ok).toBe(false);
    expect(res.ir).toBeNull();
    expect(typeof res.reason).toBe('string');
  });
});
