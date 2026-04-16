/**
 * Phase 1 feasibility check for #98 (OCCT topology engine).
 *
 * Runs a single box-minus-cylinder boolean through replicad's OCCT kernel and
 * compares the tessellated mesh against the three-bvh-csg baseline stored in
 * pipeline.json. Purpose is not pass/fail correctness but a go/no-go data
 * point on: does the WASM load in node, does the operation run, and how does
 * the output compare in vertex count / volume / surface area / wall time.
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 — the WASM is ~10 MB and init alone
 * is multi-second, so we don't want it in every CI run.
 *
 *   RUN_OCCT_FEASIBILITY=1 npx vitest run src/app/\[lang\]/shape-generator/__tests__/replicad.feasibility.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

interface PipelineGolden {
  vertexCount: number;
  triangleCount: number;
  volume_mm3: number;
  surfaceArea_mm2: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

function signatureFromReplicadMesh(mesh: {
  vertices: number[];
  triangles: number[];
}): { vertexCount: number; triangleCount: number; volume_mm3: number; surfaceArea_mm2: number; bbox: { min: [number, number, number]; max: [number, number, number] } } {
  const vertexCount = mesh.vertices.length / 3;
  const triangleCount = mesh.triangles.length / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.vertices[i * 3];
    const y = mesh.vertices[i * 3 + 1];
    const z = mesh.vertices[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  let vol = 0, area = 0;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = mesh.triangles[t * 3];
    const i1 = mesh.triangles[t * 3 + 1];
    const i2 = mesh.triangles[t * 3 + 2];
    const ax = mesh.vertices[i0 * 3],     ay = mesh.vertices[i0 * 3 + 1], az = mesh.vertices[i0 * 3 + 2];
    const bx = mesh.vertices[i1 * 3],     by = mesh.vertices[i1 * 3 + 1], bz = mesh.vertices[i1 * 3 + 2];
    const cx = mesh.vertices[i2 * 3],     cy = mesh.vertices[i2 * 3 + 1], cz = mesh.vertices[i2 * 3 + 2];
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by));
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const crx = aby * acz - abz * acy;
    const cry = abz * acx - abx * acz;
    const crz = abx * acy - aby * acx;
    area += 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  return {
    vertexCount,
    triangleCount,
    volume_mm3: Math.abs(vol / 6),
    surfaceArea_mm2: area,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

describeMaybe('replicad OCCT feasibility', () => {
  it('runs box − cylinder and compares against three-bvh-csg baseline', async () => {
    const t0 = Date.now();

    const opencascadeFactory = (await import('replicad-opencascadejs/src/replicad_single.js')).default;
    const oc = await opencascadeFactory();
    const tInit = Date.now() - t0;

    const replicad = await import('replicad');
    replicad.setOC(oc);

    const t1 = Date.now();
    // Match the three-bvh-csg fixture: 60×40×30 box, cylinder Ø20 through Y axis.
    // makeBaseBox centers on origin.
    const box = replicad.makeBaseBox(60, 40, 30);

    // makeCylinder(radius, height, location, direction). Baseline booleanFeature
    // default places the cylinder along Y (toolShape=1 cylinder, height 80).
    // Match that so the volume comparison is meaningful. makeBaseBox extends
    // Z from 0 upward, so anchor cylinder at (0,-40,15) with +Y direction to
    // pass cleanly through the box mid-plane.
    const cyl = replicad.makeCylinder(10, 80, [0, -40, 15], [0, 1, 0]);

    const result = box.cut(cyl);
    const tOp = Date.now() - t1;

    const t2 = Date.now();
    const mesh = result.mesh({ tolerance: 0.1, angularTolerance: 0.2 });
    const tMesh = Date.now() - t2;

    const sig = signatureFromReplicadMesh(mesh);

    const goldenPath = join(__dirname, '__goldens__', 'pipeline.json');
    const goldens = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, PipelineGolden>;
    const baseline = goldens['box-subtract-cylinder'];

    // eslint-disable-next-line no-console
    console.log('\n[#98 phase 1] replicad vs three-bvh-csg — box − cylinder');
    // eslint-disable-next-line no-console
    console.table({
      'init (ms)':       { replicad: tInit,                                     'three-bvh-csg': '—' },
      'operation (ms)':  { replicad: tOp,                                       'three-bvh-csg': '—' },
      'tessellate (ms)': { replicad: tMesh,                                     'three-bvh-csg': '—' },
      vertexCount:       { replicad: sig.vertexCount,                           'three-bvh-csg': baseline.vertexCount },
      triangleCount:     { replicad: sig.triangleCount,                         'three-bvh-csg': baseline.triangleCount },
      volume_mm3:        { replicad: Math.round(sig.volume_mm3 * 100) / 100,    'three-bvh-csg': baseline.volume_mm3 },
      surfaceArea_mm2:   { replicad: Math.round(sig.surfaceArea_mm2 * 100) / 100, 'three-bvh-csg': baseline.surfaceArea_mm2 },
      'bbox min':        { replicad: sig.bbox.min.map(v => Math.round(v * 100) / 100).join(','), 'three-bvh-csg': baseline.bbox.min.join(',') },
      'bbox max':        { replicad: sig.bbox.max.map(v => Math.round(v * 100) / 100).join(','), 'three-bvh-csg': baseline.bbox.max.join(',') },
    });

    // Sanity gate — both kernels should land within 3% on volume. Some drift
    // is expected because tessellation density differs; the physics are the
    // same.
    const volDrift = Math.abs(sig.volume_mm3 - baseline.volume_mm3) / baseline.volume_mm3;
    // eslint-disable-next-line no-console
    console.log(`volume drift vs three-bvh-csg: ${(volDrift * 100).toFixed(3)}%`);
    expect(volDrift).toBeLessThan(0.03);
    expect(sig.triangleCount).toBeGreaterThan(0);
  }, 120_000);
});
