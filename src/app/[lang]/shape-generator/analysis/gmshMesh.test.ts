/**
 * gmshMesh.test.ts — Stage-4 gmsh conforming-mesh integration.
 *
 * WHAT RUNS LOCALLY (no gmsh binary needed):
 *  A. the MSH 2.2 parser on inline sample meshes — filtering, node compaction,
 *     and orientation repair;
 *  B. the adapter's gmsh-ABSENT contract — returns null (never throws);
 *  C. the production FALLBACK — feaFromStlAsync(precise:true) with gmsh forced
 *     absent falls back to the octree-snap engineering path (meshMode 'refined',
 *     grade 'engineering'), proving the certification path degrades honestly.
 *
 * WHAT IS DEPLOY-VERIFIED (needs gmsh, skipped here with a clear message):
 *  D. the gmsh conforming solve itself (meshMode 'gmsh-conforming', grade
 *     'certification-candidate') and its A5 Kt number. gmsh is not installed on
 *     the dev host, so this asserts nothing locally — it runs on the server
 *     (Dockerfile installs gmsh) and is the DEPLOY-time proof.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import {
  parseMshTets,
  gmshTetMeshFromStl,
  resolveGmshBinary,
  estimateTet10Dof,
  gmshSizingForBBox,
} from './gmshMesh';
import { feaFromStlAsync } from './feaPackage';

/** Non-indexed BufferGeometry → binary STL bytes (what the FEA path parses). */
function geometryToStl(g: THREE.BufferGeometry): Uint8Array {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position') as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const vi = t * 3 + k;
      dv.setFloat32(o + k * 12 + 0, pos.getX(vi), true);
      dv.setFloat32(o + k * 12 + 4, pos.getY(vi), true);
      dv.setFloat32(o + k * 12 + 8, pos.getZ(vi), true);
    }
  }
  return new Uint8Array(buf);
}

/** Plate-with-hole oriented for Z-tension so feaFromStl's auto BC drives it. */
function raiserPlateZ(W: number, Ln: number, T: number, r: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(T, W, Ln);
  const hole = new THREE.CylinderGeometry(r, r, T * 3, 48); hole.rotateZ(Math.PI / 2);
  const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
  return ev.evaluate(new Brush(plate), new Brush(hole), SUBTRACTION).geometry.toNonIndexed();
}

const signedVol6 = (n: Float32Array, [a, b, c, d]: [number, number, number, number]): number => {
  const ax = n[a * 3], ay = n[a * 3 + 1], az = n[a * 3 + 2];
  const bx = n[b * 3] - ax, by = n[b * 3 + 1] - ay, bz = n[b * 3 + 2] - az;
  const cx = n[c * 3] - ax, cy = n[c * 3 + 1] - ay, cz = n[c * 3 + 2] - az;
  const dx = n[d * 3] - ax, dy = n[d * 3 + 1] - ay, dz = n[d * 3 + 2] - az;
  return bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
};

describe('gmshMesh — MSH 2.2 parser (A: runs locally, no binary)', () => {
  it('sizes the A5 plate inside the measured live TET10 envelope', () => {
    const sizing = gmshSizingForBBox({ dx: 8, dy: 120, dz: 200 });
    expect(sizing.nearMm).toBeCloseTo(0.4, 8);
    expect(sizing.farMm).toBeCloseTo(6, 8);
    expect(sizing.curvatureElements).toBe(16);
    expect(sizing.extendFromBoundary).toBe(false);
  });

  it('counts exact TET10 degrees of freedom across shared edges', () => {
    const tets = [
      { nodes: [0, 1, 2, 3] as [number, number, number, number], volume: 1 },
      { nodes: [0, 1, 2, 4] as [number, number, number, number], volume: 1 },
    ];
    // 5 corners + 9 unique edges = 14 quadratic nodes * 3 DOF.
    expect(estimateTet10Dof(tets, 5)).toBe(42);
  });

  it('parses one tet, filters non-tets, compacts unused nodes, remaps non-contiguous ids', () => {
    // Node 99 is surface-only (unused by any tet); ids are non-contiguous (10);
    // element 1 is a triangle (etype 2) → must be filtered out.
    const msh = [
      '$MeshFormat', '2.2 0 8', '$EndMeshFormat',
      '$Nodes', '5',
      '1 0 0 0',
      '2 1 0 0',
      '3 0 1 0',
      '10 0 0 1',
      '99 5 5 5',
      '$EndNodes',
      '$Elements', '2',
      '1 2 2 0 1 1 2 3',        // surface triangle → filtered
      '2 4 2 0 1 1 2 3 10',     // tetrahedron (positively oriented)
      '$EndElements',
      '',
    ].join('\n');
    const { nodes, tets } = parseMshTets(msh);
    expect(tets.length).toBe(1);
    expect(nodes.length / 3).toBe(4);              // node 99 dropped by compaction
    expect(tets[0].nodes).toEqual([0, 1, 2, 3]);   // ids 1,2,3,10 → dense 0..3
    expect(signedVol6(nodes, tets[0].nodes)).toBeGreaterThan(0);
    expect(tets[0].volume).toBeCloseTo(1 / 6, 6);
  });

  it('repairs a NEGATIVELY oriented tet so its signed volume is positive', () => {
    // Same 4 corners but node order 1,2,10,3 gives a NEGATIVE signed volume.
    const msh = [
      '$MeshFormat', '2.2 0 8', '$EndMeshFormat',
      '$Nodes', '4', '1 0 0 0', '2 1 0 0', '3 0 1 0', '10 0 0 1', '$EndNodes',
      '$Elements', '1', '1 4 2 0 1 1 2 10 3', '$EndElements', '',
    ].join('\n');
    const { nodes, tets } = parseMshTets(msh);
    expect(tets.length).toBe(1);
    expect(signedVol6(nodes, tets[0].nodes)).toBeGreaterThan(0); // orientation fixed
    expect(tets[0].volume).toBeCloseTo(1 / 6, 6);
  });

  it('rejects a non-MSH2 version explicitly (parser is scoped to MSH 2.x ASCII)', () => {
    const msh = ['$MeshFormat', '4.1 0 8', '$EndMeshFormat', '$Nodes', '0', '$EndNodes'].join('\n');
    expect(() => parseMshTets(msh)).toThrow(/MSH 2/);
  });

  it('returns an empty mesh (no throw) when there are no tets', () => {
    const msh = ['$MeshFormat', '2.2 0 8', '$EndMeshFormat', '$Nodes', '1', '1 0 0 0', '$EndNodes',
      '$Elements', '1', '1 2 2 0 1 1 1 1', '$EndElements'].join('\n');
    const { tets } = parseMshTets(msh);
    expect(tets.length).toBe(0);
  });
});

describe('gmshMesh — adapter gmsh-absent contract (B: runs locally)', () => {
  it('returns null when the gmsh binary is absent (ENOENT), never throws', async () => {
    const prev = process.env.GMSH_BIN;
    process.env.GMSH_BIN = 'nf-nonexistent-gmsh-binary-xyz';
    try {
      const stl = geometryToStl(new THREE.BoxGeometry(20, 20, 20));
      const res = await gmshTetMeshFromStl(stl, { timeoutMs: 5000 });
      expect(res).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.GMSH_BIN; else process.env.GMSH_BIN = prev;
    }
  });
});

describe('feaFromStlAsync — precise path fallback + gmsh preference (C + D)', () => {
  it('C: gmsh absent → precise:true FALLS BACK to the octree-snap path, honestly labeled either way', async () => {
    // Machine-speed dependent (260723 dogfooding investigation, real measurement):
    // the octree-snap graded-refine + IC(0) solve at ~68k DOF for this exact geometry
    // measured 34.5s to converge on a slower dev host — LONGER than feaFromStlAsync's
    // PRECISE_WALL_BUDGET_MS (26s, itself already tuned tight against Railway's ~15s
    // gateway timeout — see feedback_railway_deploy memory / prior 502 incident, so
    // this budget must NOT be raised just to make this test pass). On a fast enough
    // host the deadline is not hit and the fallback reaches 'engineering' grade; on a
    // slower host the deadline fires first and it honestly degrades to 'screening'
    // with a clear reason. BOTH are the correct, honest behavior — what must NEVER
    // happen is gmsh's certification-candidate grade (that would mean gmsh was used
    // despite being forced absent) or a silently-wrong/non-finite result. This test
    // asserts the real invariant (honest degrade, never fabricated) instead of a
    // machine-speed-dependent specific outcome.
    const prev = process.env.GMSH_BIN;
    process.env.GMSH_BIN = 'nf-nonexistent-gmsh-binary-xyz'; // force gmsh absent
    try {
      const stl = geometryToStl(raiserPlateZ(120, 200, 8, 10));
      const out = await feaFromStlAsync({ stl, materialKey: 'steel', loadN: 100000, precise: true });
      expect(out.raiser).not.toBeNull();
      expect(out.raiser!.detected).toBe(true);
      // Never gmsh — it was forced absent, so 'certification-candidate'/'gmsh-conforming' would mean a bug.
      expect(out.raiser!.grade).not.toBe('certification-candidate');
      expect(out.result.meshMode).not.toBe('gmsh-conforming');
      expect(out.raiser!.gmshError).toMatch(/gmsh binary not found/);
      if (out.raiser!.applied) {
        // Fast-enough host: octree solve converged within budget.
        expect(out.raiser!.grade).toBe('engineering');
        expect(out.result.meshMode).toBe('refined');
        expect(out.result.grade).toBe('engineering');
      } else {
        // Slower host: wall-time budget fired first — still honest, just a lower tier.
        expect(out.raiser!.grade).toBe('screening');
        expect(out.raiser!.note).toContain('스크리닝 결과 유지');
      }
      expect(Number.isFinite(out.result.maxStress)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GMSH_BIN; else process.env.GMSH_BIN = prev;
    }
  }, 120_000);

  it('D: gmsh conforming solve (DEPLOY-VERIFIED — skipped when gmsh is absent)', async () => {
    const bin = await resolveGmshBinary();
    if (!bin) {
       
      console.log('\n[gmsh D] SKIPPED — gmsh binary not found on this host (expected on the dev machine). ' +
        'This case is DEPLOY-VERIFIED: the Dockerfile installs gmsh and the server runs it.\n');
      expect(bin).toBeNull();
      return;
    }
    const stl = geometryToStl(raiserPlateZ(120, 200, 8, 10));
    const out = await feaFromStlAsync({ stl, materialKey: 'steel', loadN: 100000, precise: true });
     
    console.log(`\n[gmsh D] gmsh=${bin} meshMode=${out.result.meshMode} grade=${out.result.grade} ` +
      `DOF=${out.raiser?.dofCount} maxStress=${out.result.maxStress}\n`);
    expect(out.raiser!.applied).toBe(true);
    expect(out.result.meshMode).toBe('gmsh-conforming');
    expect(out.result.grade).toBe('certification-candidate');
    expect(Number.isFinite(out.result.maxStress)).toBe(true);
  }, 180_000);
});
