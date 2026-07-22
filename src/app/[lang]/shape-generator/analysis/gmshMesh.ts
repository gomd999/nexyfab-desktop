/**
 * gmshMesh.ts — CERTIFICATION-grade boundary-conforming tet mesher (out-of-process).
 *
 * Stage 4 of the NexyFab FEA accuracy ladder. Stages 1-3 gave an in-repo
 * octree-snap engineering-grade path (A5 plate-hole Kt within ~5.6% of Kirsch,
 * `precise:true`). This module adds a HIGHER-accuracy option by shelling the
 * `gmsh` binary — exactly the same posture as our OpenSCAD dependency
 * (`src/lib/openscad-render/renderStl.ts`): a SEPARATE process invoked with
 * execFile, temp files, timeout, and cleanup.
 *
 * LICENSING: gmsh is GPL. We invoke it as a standalone executable over files
 * (STL in, .msh out) — mere aggregation at arm's length, NOT linking. This does
 * NOT impose the GPL on our (proprietary) code, the identical arrangement we
 * already rely on for the OpenSCAD CLI. This module contains no gmsh source.
 *
 * SERVER-ONLY: uses node:child_process. Imported dynamically from the server
 * FEA path (feaPackage.feaFromStlAsync) — never bundled to the client.
 *
 * FALLBACK CONTRACT: every failure mode (binary absent / ENOENT, timeout,
 * non-zero exit, empty or surface-only mesh, oversize mesh) returns `null`.
 * The caller then falls back to the octree-snap engineering path. We NEVER
 * crash and NEVER fabricate a mesh.
 *
 * Pipeline:
 *   1. write the incoming binary STL (the conforming surface triangulation from
 *      replicad `.mesh()` / three-bvh-csg) to a temp file;
 *   2. write a .geo script that Merges the STL, reclassifies it into a geometry,
 *      builds a volume, and sets a mesh size;
 *   3. `gmsh model.geo -3 -format msh2 -o out.msh` (3-D volume mesh, MSH 2.2
 *      ASCII so the parser below is small and deterministic);
 *   4. parse the conforming linear (TET4) tetrahedra into the {nodes, tets}
 *      shape femSolver consumes — the existing buildTet10Mesh then promotes the
 *      corners to quadratic TET10 mid-side nodes.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tet } from './femSolver';

/** Resolve the gmsh executable — GMSH_BIN env override, else `gmsh` on PATH. */
export function gmshBinary(): string {
  const fromEnv = process.env.GMSH_BIN?.trim();
  if (fromEnv) return fromEnv;
  return 'gmsh';
}

export interface GmshMeshResult {
  /** Corner-node coordinates (x,y,z triples). Feed to buildTet10Mesh. */
  nodes: Float32Array;
  /** Linear tetrahedra (positively oriented) referencing `nodes`. */
  tets: Tet[];
  source: 'gmsh';
  nodeCount: number;
  tetCount: number;
}

/** Signed 6·volume of a tet from a flat coord array (for orientation + volume). */
function signedVol6(coords: number[] | Float32Array, a: number, b: number, c: number, d: number): number {
  const ax = coords[a * 3], ay = coords[a * 3 + 1], az = coords[a * 3 + 2];
  const bx = coords[b * 3] - ax, by = coords[b * 3 + 1] - ay, bz = coords[b * 3 + 2] - az;
  const cx = coords[c * 3] - ax, cy = coords[c * 3 + 1] - ay, cz = coords[c * 3 + 2] - az;
  const dx = coords[d * 3] - ax, dy = coords[d * 3 + 1] - ay, dz = coords[d * 3 + 2] - az;
  // (b) · ((c) × (d))
  return bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
}

/**
 * Parse the TET4 tetrahedra out of an MSH 2.2 ASCII mesh into femSolver's
 * {nodes, tets} shape. PURE + deterministic — unit-tested with inline data.
 *
 * Robustness:
 *  - filters non-tet elements (surface triangles etype 2, lines etype 1,
 *    points etype 15) so only 4-node tets (etype 4) become elements;
 *  - COMPACTS the node set to only tet-referenced nodes, remapped to a dense
 *    0-based index space — so no floating, zero-stiffness surface node can
 *    make the global stiffness singular;
 *  - fixes tet ORIENTATION (swaps two corners when the signed volume is
 *    negative) so femSolver's Jacobian weight detJ/24 is positive, matching
 *    the sign convention of the in-repo Kuhn-tet mesher.
 */
export function parseMshTets(text: string): { nodes: Float32Array; tets: Tet[] } {
  const lines = text.split(/\r?\n/);
  const nodeCoords = new Map<number, [number, number, number]>();
  const rawTets: Array<[number, number, number, number]> = [];
  let version = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '$MeshFormat') {
      version = (lines[i + 1] || '').trim().split(/\s+/)[0] || '';
      continue;
    }
    if (line === '$Nodes') {
      const count = parseInt((lines[i + 1] || '').trim(), 10) || 0;
      let j = i + 2;
      for (let k = 0; k < count && j < lines.length; k++, j++) {
        const p = lines[j].trim().split(/\s+/);
        if (p.length < 4) continue;
        const id = parseInt(p[0], 10);
        if (!Number.isFinite(id)) continue;
        nodeCoords.set(id, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
      }
      i = j;
      continue;
    }
    if (line === '$Elements') {
      const count = parseInt((lines[i + 1] || '').trim(), 10) || 0;
      let j = i + 2;
      for (let k = 0; k < count && j < lines.length; k++, j++) {
        const p = lines[j].trim().split(/\s+/).map(Number);
        // MSH2 element line: id etype ntags <tags...> nodeIds...
        if (p.length < 3) continue;
        const etype = p[1];
        if (etype !== 4) continue; // 4-node tetrahedron only
        const ntags = p[2];
        const base = 3 + ntags;
        if (base + 3 >= p.length) continue;
        rawTets.push([p[base], p[base + 1], p[base + 2], p[base + 3]]);
      }
      i = j;
      continue;
    }
  }

  if (version && !version.startsWith('2')) {
    throw new Error(`parseMshTets: only MSH 2.x ASCII is supported (got version "${version}"). Invoke gmsh with -format msh2.`);
  }

  // Compact: keep only tet-referenced nodes, dense 0-based remap.
  const idToIdx = new Map<number, number>();
  const coords: number[] = [];
  const idxOf = (id: number): number => {
    let idx = idToIdx.get(id);
    if (idx === undefined) {
      const c = nodeCoords.get(id);
      if (!c) throw new Error(`parseMshTets: tetrahedron references unknown node id ${id}`);
      idx = coords.length / 3;
      coords.push(c[0], c[1], c[2]);
      idToIdx.set(id, idx);
    }
    return idx;
  };

  const tets: Tet[] = [];
  for (const t of rawTets) {
    const a = idxOf(t[0]);
    const b = idxOf(t[1]);
    let c = idxOf(t[2]);
    let d = idxOf(t[3]);
    let v6 = signedVol6(coords, a, b, c, d);
    if (v6 < 0) { const tmp = c; c = d; d = tmp; v6 = -v6; } // enforce positive orientation
    if (v6 === 0) continue; // degenerate sliver — skip (never fabricate stiffness)
    tets.push({ nodes: [a, b, c, d], volume: v6 / 6 });
  }

  return { nodes: new Float32Array(coords), tets };
}

/** Axis-aligned bounding-box extents from a binary STL (for mesh sizing). */
function stlBBox(stl: Uint8Array): { dx: number; dy: number; dz: number } {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const tri = dv.getUint32(80, true);
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < tri; i++) {
    const o = 84 + i * 50 + 12; // skip the 12-byte facet normal
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(o + v * 12, true);
      const y = dv.getFloat32(o + v * 12 + 4, true);
      const z = dv.getFloat32(o + v * 12 + 8, true);
      if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
      if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
    }
  }
  return { dx: mxx - mnx, dy: mxy - mny, dz: mxz - mnz };
}

export interface GmshMeshOptions {
  /** Subprocess timeout (ms). Default 120 s (a fine conforming mesh is slow). */
  timeoutMs?: number;
  /** Target element edge length (mm). Default = maxBboxDim / 24. */
  targetSizeMm?: number;
  /** Reject (return null → fall back) above this node count, so a runaway mesh
   *  never hangs a live request. Default 200_000. */
  maxNodes?: number;
}

/** Probe whether the gmsh binary resolves. Returns the resolved path, or null
 *  if absent (ENOENT) / not runnable. Used by tests to skip the gmsh-only case
 *  with a clear message on hosts where gmsh is not installed. */
export function resolveGmshBinary(timeoutMs = 10_000): Promise<string | null> {
  const bin = gmshBinary();
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: timeoutMs, windowsHide: true }, (err) => {
      resolve(err ? null : bin);
    });
  });
}

/**
 * Shell gmsh to volume-mesh the closed surface in `stl` and return the
 * conforming linear-tet mesh, or `null` on ANY failure (caller falls back).
 */
export async function gmshTetMeshFromStl(stl: Uint8Array, opts: GmshMeshOptions = {}): Promise<GmshMeshResult | null> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxNodes = opts.maxNodes ?? 200_000;
  const bin = gmshBinary();

  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-gmsh-${id}`);
  const stlPath = join(workDir, 'surf.stl');
  const geoPath = join(workDir, 'mesh.geo');
  const mshPath = join(workDir, 'out.msh');

  const bb = stlBBox(stl);
  const maxDim = Math.max(bb.dx, bb.dy, bb.dz, 1e-6);
  const size = opts.targetSizeMm && opts.targetSizeMm > 0 ? opts.targetSizeMm : maxDim / 24;

  // .geo remesh recipe (gmsh tutorial t13 lineage): merge the discrete STL
  // surface, reclassify it into a parametrised geometry, wrap it in a volume,
  // then let `gmsh -3` fill it with tets. Curvature-based sizing refines the
  // element size around bores/fillets; the min/max clamp bounds the count.
  const geo = [
    `Merge "surf.stl";`,
    `Mesh.MeshSizeMin = ${(size / 4).toFixed(6)};`,
    `Mesh.MeshSizeMax = ${size.toFixed(6)};`,
    `Mesh.MeshSizeFromCurvature = 12;`,
    `Mesh.Algorithm3D = 1;`,      // Delaunay — robust for arbitrary closed surfaces
    `Mesh.Optimize = 1;`,
    `Mesh.OptimizeNetgen = 1;`,
    `Geometry.Tolerance = 1e-6;`,
    // reclassify the merged STL facets into geometric surfaces (40deg feature angle)
    `ClassifySurfaces{40 * Pi/180, 1, 1, 180 * Pi/180};`,
    `CreateGeometry;`,
    `Surface Loop(1) = Surface{:};`,
    `Volume(1) = {1};`,
  ].join('\n');

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(stlPath, Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength));
    await writeFile(geoPath, geo, 'utf8');

    await new Promise<void>((resolve, reject) => {
      execFile(bin, [geoPath, '-3', '-format', 'msh2', '-o', mshPath], {
        cwd: workDir, timeout: timeoutMs, windowsHide: true,
        maxBuffer: 64 * 1024 * 1024, env: process.env,
      }, (err) => {
        if (err) {
          const e = err as NodeJS.ErrnoException;
          // ENOENT (binary absent) is the expected dev-host case — silent fallback.
          return reject(Object.assign(new Error(e.message), { _gmshFail: true, code: e.code }));
        }
        resolve();
      });
    });

    const text = await readFile(mshPath, 'utf8');
    const parsed = parseMshTets(text);
    if (parsed.tets.length === 0) return null;        // surface-only / empty → fall back
    const nodeCount = parsed.nodes.length / 3;
    if (nodeCount > maxNodes) return null;            // oversize → fall back, don't hang
    return { nodes: parsed.nodes, tets: parsed.tets, source: 'gmsh', nodeCount, tetCount: parsed.tets.length };
  } catch {
    // Never crash, never fabricate — any gmsh failure degrades to the octree path.
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
