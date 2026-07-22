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
 *   2. write a .geo script that Merges the STL and fills it with tets. We try
 *      TWO recipes in order (see gmshTetMeshFromStl):
 *        (A) KEEP-SURFACE — heal/weld the raw triangulation, wrap it in a
 *            Surface Loop + Volume and Delaunay-fill WITHOUT reparametrising.
 *            Most robust + exact for a clean watertight OpenSCAD (CSG) STL.
 *        (B) REPARAM — ClassifySurfaces + CreateGeometry, then Volume. Remeshes
 *            the surface; the fallback for triangulations (A) cannot fill.
 *   3. `gmsh model.geo -3 -format msh2 -nopopup -v 3 -o out.msh` (3-D volume
 *      mesh, MSH 2.2 ASCII so the parser below is small and deterministic; `-v 3`
 *      keeps gmsh's Error/Warning lines in the captured stream so the CONCRETE
 *      cause is threaded up to the self-test — see extractGmshError);
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

/**
 * Pull the FIRST concrete gmsh `Error   :` line out of a captured log, SKIPPING
 * the trailing summary banner ("Mesh generation error summary" / "1 error" /
 * "Check the full log for details" / the `----` rules). gmsh prints the real
 * cause EARLIER in the stream (e.g. "PLC Error:  A segment and a facet
 * intersect", "No elements in volume", "Self-intersecting surface mesh",
 * "Unable to recover edge", "Invalid boundary mesh") and then repeats a generic
 * banner at the very end — so a plain `.slice(-6)` tail only ever captures the
 * useless banner. This surfaces the actionable line instead. Returns undefined
 * if no real error line is present. PURE — unit-testable with inline logs.
 */
export function extractGmshError(text: string): string | undefined {
  const banner = /^(-+|mesh generation error summary|\d+\s+errors?|check the full log.*|warnings?\s+can be ignored.*)$/i;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^\s*Error\s*:\s*(.*\S)\s*$/i.exec(raw.trim());
    if (!m) continue;
    const msg = m[1].trim();
    if (!msg || banner.test(msg)) continue;
    return msg;
  }
  return undefined;
}

/** Mutable diagnostics sink. When gmshTetMeshFromStl returns null it writes the
 *  CONCRETE reason here so the caller (feaPackage) can thread it up to the FEA
 *  self-test response — turning a silent `gmshUsed:false` into an actionable
 *  cause (ENOENT / non-zero exit / empty msh / timeout / oversize) that now
 *  includes the SPECIFIC gmsh error line (e.g. "PLC Error: a segment and a
 *  facet intersect"), not just gmsh's generic trailing summary banner. */
export interface GmshDiag {
  /** Short human-readable failure reason (undefined on success). */
  reason?: string;
  /** Node error code when the exec itself failed (e.g. 'ENOENT'). */
  code?: string;
  /** Process exit code when gmsh ran but exited non-zero. */
  exitCode?: number | null;
  /** Tail of gmsh stderr/stdout (trimmed) for the concrete gmsh message. */
  stderr?: string;
  /** Resolved binary that was invoked. */
  bin?: string;
}

export interface GmshMeshOptions {
  /** Subprocess timeout (ms). Default 120 s (a fine conforming mesh is slow). */
  timeoutMs?: number;
  /** Target element edge length (mm). Default = maxBboxDim / 24. */
  targetSizeMm?: number;
  /** Reject (return null → fall back) above this node count, so a runaway mesh
   *  never hangs a live request. Default 200_000. */
  maxNodes?: number;
  /** Optional diagnostics sink — receives the concrete failure reason on null. */
  diag?: GmshDiag;
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

/** Trailing lines of a captured gmsh log (fallback context when no `Error :` line). */
function logTail(log: string, n = 6): string {
  return String(log || '').trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' | ').slice(0, 600);
}

/**
 * Shell gmsh to volume-mesh the closed surface in `stl` and return the
 * conforming linear-tet mesh, or `null` on ANY failure (caller falls back).
 *
 * Robustness: we attempt TWO .geo recipes in order and take the first that
 * yields tets. (A) KEEP-SURFACE fills the healed watertight triangulation
 * directly (no reparametrisation → no ClassifySurfaces/CreateGeometry
 * self-intersection failures, and it preserves the exact OpenSCAD boundary).
 * (B) REPARAM reclassifies the STL into geometry then fills — the fallback for
 * triangulations that (A) cannot close into a volume. On total failure the
 * diag carries the SPECIFIC gmsh error line from the more informative attempt.
 */
export async function gmshTetMeshFromStl(stl: Uint8Array, opts: GmshMeshOptions = {}): Promise<GmshMeshResult | null> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxNodes = opts.maxNodes ?? 200_000;
  const bin = gmshBinary();
  const setDiag = (d: Partial<GmshDiag>) => { if (opts.diag) Object.assign(opts.diag, d); };
  setDiag({ bin });

  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-gmsh-${id}`);
  const stlPath = join(workDir, 'surf.stl');
  const geoPath = join(workDir, 'mesh.geo');
  const mshPath = join(workDir, 'out.msh');

  const bb = stlBBox(stl);
  const maxDim = Math.max(bb.dx, bb.dy, bb.dz, 1e-6);
  const size = opts.targetSizeMm && opts.targetSizeMm > 0 ? opts.targetSizeMm : maxDim / 24;
  const near = (size / 4).toFixed(6);
  const far = size.toFixed(6);

  // STL-conditioning options MUST precede `Merge` (they are consulted while the
  // STL is read): weld duplicate facets, and tolerate small facet overlaps so a
  // seam in an OpenSCAD CSG export does not read as a non-manifold defect.
  const stlConditioning = [
    `Geometry.Tolerance = 1e-5;`,
    `Mesh.AngleToleranceFacetOverlap = 0.02;`,
    `Mesh.StlRemoveDuplicateTriangles = 1;`,
  ];
  const meshControls = [
    `Mesh.Algorithm3D = 1;`,          // Delaunay — robust for arbitrary closed surfaces
    `Mesh.MeshSizeMin = ${near};`,
    `Mesh.MeshSizeMax = ${far};`,
    `Mesh.MeshSizeFromCurvature = 12;`,
    `Mesh.Optimize = 1;`,
    // Mesh.OptimizeNetgen omitted: Debian's gmsh package is built WITHOUT the Netgen
    // optimizer ("Netgen optimizer is not compiled in this version of Gmsh" -> exit 1).
    // The built-in Mesh.Optimize is present and sufficient for our tet quality.
  ];

  // (A) KEEP-SURFACE: weld the raw STL vertices (`Coherence Mesh`), wrap the
  // discrete surface(s) in a Surface Loop + Volume, and Delaunay-fill. No
  // ClassifySurfaces / CreateGeometry, so nothing to self-intersect during
  // reparametrisation; the exact watertight OpenSCAD boundary is preserved.
  const recipeKeep = [
    ...stlConditioning,
    `Merge "surf.stl";`,
    `Coherence Mesh;`,                // weld coincident STL vertices (heal seams)
    `Surface Loop(1) = Surface{:};`,
    `Volume(1) = {1};`,
    ...meshControls,
  ].join('\n');

  // (B) REPARAM: reclassify the merged STL facets into geometric surfaces
  // (40deg feature angle) and rebuild the parametrisation before filling. This
  // REMESHES the surface — the fallback for triangulations that (A) cannot fill.
  const recipeReparam = [
    ...stlConditioning,
    `Merge "surf.stl";`,
    `Coherence Mesh;`,
    `ClassifySurfaces{40 * Pi/180, 1, 1, 180 * Pi/180};`,
    `CreateGeometry;`,
    `Surface Loop(1) = Surface{:};`,
    `Volume(1) = {1};`,
    ...meshControls,
  ].join('\n');

  /** Run one .geo recipe. Never rejects — returns the outcome for the driver. */
  const runGmsh = async (geoText: string): Promise<{
    ranOk: boolean; log: string; errCode?: string; exitCode: number | null; killed: boolean; signal?: string;
  }> => {
    await writeFile(geoPath, geoText, 'utf8');
    return new Promise((resolve) => {
      // `-nopopup` suppresses any GUI/error dialog in batch mode; `-v 3` keeps
      // Error+Warning lines in the stream so extractGmshError can surface the
      // real cause. We deliberately do NOT pass `-v 0`.
      execFile(bin, [geoPath, '-3', '-format', 'msh2', '-nopopup', '-v', '3', '-o', mshPath], {
        cwd: workDir, timeout: timeoutMs, windowsHide: true,
        maxBuffer: 64 * 1024 * 1024, env: process.env,
      }, (err, out, errOut) => {
        const log = `${String(out || '')}\n${String(errOut || '')}`;
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          resolve({ ranOk: false, log, errCode: e.code, exitCode: typeof e.code === 'number' ? e.code : null, killed: !!e.killed, signal: e.signal });
        } else {
          resolve({ ranOk: true, log, exitCode: 0, killed: false });
        }
      });
    });
  };

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(stlPath, Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength));

    const attempts: Array<{ tag: string; geo: string }> = [
      { tag: 'keep-surface', geo: recipeKeep },
      { tag: 'reparam', geo: recipeReparam },
    ];

    let lastReason: string | undefined;
    let lastCode: string | undefined;
    let lastExit: number | null = null;
    let lastTail: string | undefined;

    for (const attempt of attempts) {
      const r = await runGmsh(attempt.geo);
      const specific = extractGmshError(r.log);   // the ACTUAL gmsh cause, if any
      const tail = logTail(r.log);
      const detail = specific ?? tail;            // prefer the concrete line, else the raw tail

      if (!r.ranOk) {
        if (r.errCode === 'ENOENT') {
          // binary missing — retrying the other recipe cannot help.
          const reason = `gmsh binary not found (ENOENT) at "${bin}" — not installed, or GMSH_BIN points to the wrong path`;
          setDiag({ reason, code: r.errCode, exitCode: null, stderr: tail });
          return null;
        }
        if (r.killed || r.signal === 'SIGTERM') {
          lastReason = `gmsh [${attempt.tag}] timed out after ${timeoutMs}ms (mesh too fine or hung)${detail ? ` — ${detail}` : ''}`;
        } else {
          lastReason = `gmsh [${attempt.tag}] exited ${r.exitCode ?? '?'}${r.signal ? ` (signal ${r.signal})` : ''}: ${detail || 'no message captured'}`;
        }
        lastCode = r.errCode; lastExit = r.exitCode; lastTail = detail;
        continue; // try the next recipe
      }

      // exit 0 — read + parse the .msh
      const text = await readFile(mshPath, 'utf8').catch(() => null);
      if (text == null) {
        lastReason = `gmsh [${attempt.tag}] ran (exit 0) but wrote no .msh to "${mshPath}"${specific ? ` — ${specific}` : ''}`;
        lastTail = detail;
        continue;
      }
      let parsed: { nodes: Float32Array; tets: Tet[] };
      try {
        parsed = parseMshTets(text);
      } catch (e) {
        lastReason = `gmsh [${attempt.tag}] produced a .msh the parser rejected: ${(e as Error)?.message ?? String(e)}`;
        lastTail = detail;
        continue;
      }

      if (parsed.tets.length === 0) {
        // surface-only / empty → this recipe did not fill a volume; try the next.
        lastReason = `gmsh [${attempt.tag}] produced NO volume tetrahedra (empty / surface-only msh)${specific ? ` — ${specific}` : tail ? `. gmsh: ${tail}` : ''}`;
        lastTail = detail;
        continue;
      }
      const nodeCount = parsed.nodes.length / 3;
      if (nodeCount > maxNodes) {
        setDiag({ reason: `gmsh mesh too large (${nodeCount} nodes > cap ${maxNodes}) — rejected to protect the live request` });
        return null; // oversize → fall back, don't hang
      }
      return { nodes: parsed.nodes, tets: parsed.tets, source: 'gmsh', nodeCount, tetCount: parsed.tets.length };
    }

    // Both recipes failed — surface the most informative reason we captured.
    setDiag({
      reason: lastReason ?? 'gmsh failed to produce a volume mesh (no reason captured)',
      code: lastCode,
      exitCode: lastExit,
      stderr: lastTail,
    });
    return null;
  } catch (err) {
    // Never crash, never fabricate — any gmsh failure degrades to the octree path.
    if (opts.diag && !opts.diag.reason) {
      setDiag({ reason: `gmsh meshing failed: ${(err as Error)?.message ?? String(err)}` });
    }
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
