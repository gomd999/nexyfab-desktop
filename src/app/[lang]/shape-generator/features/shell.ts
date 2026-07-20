import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import {
  occtShellBox,
  occtFaceSignatures,
  hostBoxFromGeometry,
  resolveBrepHostHandle,
  resolveBrepHostHandleAsync,
} from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { captureKernelFailure } from './kernelCorpus';
import { buildFaceFinderBySignature } from './topologyEdgeFinder';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/* ------------------------------------------------------------------------- *
 * W5-C — exact mesh shell for planar-faced CONVEX polyhedra.
 *
 * The old mesh fallback offset every vertex along its (per-face, duplicated)
 * vertex normal and CSG-subtracted the result. On a box the six inner "walls"
 * are disconnected oversized sheets — not a solid — so the subtraction produced
 * garbage (measured: closed 50³ t=2 "shell" volume 240 000 mm³ vs the true
 * 27 664 mm³). This replaces it with a real inner cavity:
 *
 *   1. Weld vertices by position; cluster triangles into planar faces (n·x=d).
 *   2. Verify the solid is convex with outward winding, and that every welded
 *      vertex is governed by ≤ 3 distinct face planes.
 *   3. Offset every plane inward by the wall thickness (an OPEN face's plane is
 *      instead pushed OUTWARD so the cavity pierces it), and re-solve each
 *      vertex as the (least-norm) intersection of its adjacent offset planes.
 *      Same topology as the outer solid → a closed manifold inner cavity with
 *      exact wall thickness on every face.
 *   4. CSG-subtract the cavity.
 *
 * SUPPORT SCOPE (mesh path): convex planar-faced polyhedra — boxes, convex
 * prisms, frusta (≤ 3 distinct planes per vertex). Outside that scope the op
 * REFUSES with a typed reason instead of emitting a wrong solid:
 *   SHELL_UNSUPPORTED_NONCONVEX / SHELL_UNSUPPORTED_VERTEX / SHELL_INVERTED_WINDING
 *   SHELL_OPEN_FACE_NOT_FOUND / SHELL_THICKNESS_TOO_LARGE / SHELL_DEGENERATE_VERTEX
 * (Curved/tessellated-smooth bodies exceed 3 planes per vertex; concave bodies
 * fail the convexity test. Those need the OCCT B-rep engine.)
 * ------------------------------------------------------------------------- */

interface PlanarSolidAnalysis {
  /** Distinct face planes: outward normal + offset (n·x = d). */
  planes: { n: THREE.Vector3; d: number }[];
  /** Welded (position-unique) vertex coordinates. */
  weldedPositions: THREE.Vector3[];
  /** original vertex index → welded vertex id */
  vertexWeld: number[];
  /** welded vertex id → ids of the distinct planes adjacent to it */
  vertexPlanes: number[][];
  /** bbox diagonal (tolerance scale) */
  diag: number;
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
  }
  return vol / 6;
}

/** Weld, cluster planes, and validate the W5-C mesh-shell support scope. */
function analyzePlanarConvexSolid(geometry: THREE.BufferGeometry): PlanarSolidAnalysis {
  const pos = geometry.attributes.position;
  const idx = geometry.index!;
  geometry.computeBoundingBox();
  const diag = geometry.boundingBox!.getSize(new THREE.Vector3()).length();
  const weldQ = Math.max(1e-6, 1e-6 * diag);

  // --- weld by position ---
  const weldMap = new Map<string, number>();
  const weldedPositions: THREE.Vector3[] = [];
  const vertexWeld: number[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x / weldQ)},${Math.round(y / weldQ)},${Math.round(z / weldQ)}`;
    let w = weldMap.get(key);
    if (w === undefined) {
      w = weldedPositions.length;
      weldedPositions.push(new THREE.Vector3(x, y, z));
      weldMap.set(key, w);
    }
    vertexWeld[i] = w;
  }

  // --- cluster triangles into planes ---
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const dTol = Math.max(1e-6, 1e-5 * diag);
  const vertexPlaneSets: Set<number>[] = weldedPositions.map(() => new Set<number>());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const triCount = idx.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2);
    a.fromBufferAttribute(pos as THREE.BufferAttribute, i0);
    b.fromBufferAttribute(pos as THREE.BufferAttribute, i1);
    c.fromBufferAttribute(pos as THREE.BufferAttribute, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len < 1e-10 * diag * diag) continue; // degenerate sliver — no plane info
    n.divideScalar(len);
    const d = n.dot(a);
    let planeId = -1;
    for (let p = 0; p < planes.length; p++) {
      if (planes[p].n.dot(n) > 1 - 1e-5 && Math.abs(planes[p].d - d) < dTol) { planeId = p; break; }
    }
    if (planeId < 0) {
      planeId = planes.length;
      planes.push({ n: n.clone(), d });
    }
    vertexPlaneSets[vertexWeld[i0]].add(planeId);
    vertexPlaneSets[vertexWeld[i1]].add(planeId);
    vertexPlaneSets[vertexWeld[i2]].add(planeId);
  }

  // --- outward winding? (signed volume must be positive) ---
  const vol = signedVolume(geometry);
  if (vol <= 0) {
    throw new Error(
      'SHELL_INVERTED_WINDING: the mesh encloses non-positive signed volume ' +
      `(${vol.toFixed(3)} mm³) — triangle winding is inverted or the mesh is not a ` +
      'closed solid. Mesh shell needs an outward-wound closed solid.',
    );
  }

  // --- convexity: every welded vertex on or inside every face plane ---
  const cTol = Math.max(1e-5, 1e-4 * diag);
  for (const plane of planes) {
    for (const v of weldedPositions) {
      const excess = plane.n.dot(v) - plane.d;
      if (excess > cTol) {
        throw new Error(
          'SHELL_UNSUPPORTED_NONCONVEX: mesh shell supports convex planar-faced solids ' +
          `only — a vertex lies ${excess.toFixed(4)} mm outside a face plane (concave or ` +
          'multi-body geometry). Use the OCCT B-rep engine for this body.',
        );
      }
    }
  }

  // --- ≤3 planes per vertex (exact solvability) ---
  const vertexPlanes = vertexPlaneSets.map((s) => [...s]);
  for (let w = 0; w < vertexPlanes.length; w++) {
    if (vertexPlanes[w].length > 3) {
      throw new Error(
        `SHELL_UNSUPPORTED_VERTEX: ${vertexPlanes[w].length} distinct face planes meet at a ` +
        'vertex — mesh shell supports convex planar-faced polyhedra with at most 3 planes ' +
        'per vertex (box / convex prism / frustum). Curved or tessellated-smooth bodies ' +
        'need the OCCT B-rep engine.',
      );
    }
  }

  return { planes, weldedPositions, vertexWeld, vertexPlanes, diag };
}

/**
 * Resolve which plane (if any) is left open.
 * A click-time face selection wins; otherwise the openFace enum picks the
 * most-up (+Y) / most-down (−Y) plane. Requesting an open face that cannot be
 * identified is refused, not guessed.
 */
function resolveOpenPlane(
  analysis: PlanarSolidAnalysis,
  openFace: number,
  sel?: { normal: [number, number, number]; position: [number, number, number] },
): number | null {
  if (sel) {
    const sn = new THREE.Vector3(...sel.normal).normalize();
    const sp = new THREE.Vector3(...sel.position);
    const dTol = Math.max(1e-4, 1e-3 * analysis.diag);
    for (let p = 0; p < analysis.planes.length; p++) {
      const { n, d } = analysis.planes[p];
      if (n.dot(sn) > 0.999 && Math.abs(n.dot(sp) - d) < dTol) return p;
    }
    // fall through to the enum if the click doesn't match a planar face
  }
  if (openFace === 0) return null;
  const wantUp = openFace === 1 ? 1 : -1;
  let best = -1;
  let bestNy = 0.7; // require a reasonably top/bottom-facing plane
  for (let p = 0; p < analysis.planes.length; p++) {
    const ny = analysis.planes[p].n.y * wantUp;
    if (ny > bestNy) { bestNy = ny; best = p; }
  }
  if (best < 0) {
    throw new Error(
      `SHELL_OPEN_FACE_NOT_FOUND: no ${openFace === 1 ? 'top (+Y)' : 'bottom (−Y)'} planar ` +
      'face found to open — pick the face explicitly or set open face to none.',
    );
  }
  return best;
}

/**
 * Build the inner cavity solid: same topology as the outer solid, every vertex
 * re-solved against its adjacent planes offset inward by `thicknessForPlane`
 * (open planes offset outward so the cavity pierces the wall). Winding is kept
 * outward — three-bvh-csg's SUBTRACTION expects two ordinary solids.
 */
function buildInnerCavity(
  geometry: THREE.BufferGeometry,
  analysis: PlanarSolidAnalysis,
  thicknessForPlane: (n: THREE.Vector3) => number,
  openPlanes: ReadonlySet<number>,
): THREE.BufferGeometry {
  const { planes, weldedPositions, vertexWeld, vertexPlanes, diag } = analysis;

  // Offset plane constants. An open plane is pushed OUTWARD past the outer
  // face (by its own thickness) so the boolean cleanly pierces the wall.
  const dPrime = planes.map((pl, i) => {
    const t = thicknessForPlane(pl.n);
    return openPlanes.has(i) ? pl.d + t : pl.d - t;
  });

  // Solve each welded vertex: least-norm displacement x = v + Nᵀλ with
  // N x = d′ (exact intersection when 3 independent planes meet).
  const offsetPositions: THREE.Vector3[] = new Array(weldedPositions.length);
  for (let w = 0; w < weldedPositions.length; w++) {
    const v = weldedPositions[w];
    const pids = vertexPlanes[w];
    const k = pids.length;
    if (k === 0) { offsetPositions[w] = v.clone(); continue; }
    const N = pids.map((p) => planes[p].n);
    const rhs = pids.map((pid, j) => dPrime[pid] - N[j].dot(v));
    // Gram matrix G = N Nᵀ (k×k), solve G λ = rhs.
    const G: number[][] = N.map((ni) => N.map((nj) => ni.dot(nj)));
    const lambda = solveSmallSPD(G, rhs);
    if (!lambda) {
      throw new Error(
        'SHELL_DEGENERATE_VERTEX: the face planes meeting at a vertex are linearly ' +
        'dependent — cannot solve the inner cavity corner. Use the OCCT B-rep engine.',
      );
    }
    const x = v.clone();
    for (let j = 0; j < k; j++) x.addScaledVector(N[j], lambda[j]);
    offsetPositions[w] = x;
  }

  // Containment: every cavity vertex must stay on/inside every non-open
  // ORIGINAL face plane — a vertex escaping one means the wall inverted.
  const inTol = Math.max(1e-6, 1e-5 * diag);
  for (const x of offsetPositions) {
    for (let p = 0; p < planes.length; p++) {
      if (openPlanes.has(p)) continue;
      if (planes[p].n.dot(x) - planes[p].d > inTol) {
        throw new Error(
          'SHELL_THICKNESS_TOO_LARGE: the requested wall thickness pushes the inner ' +
          'cavity outside the solid — the walls would invert. Reduce the thickness.',
        );
      }
    }
  }

  // Same topology, new positions.
  const inner = geometry.clone();
  const ipos = inner.attributes.position;
  for (let i = 0; i < ipos.count; i++) {
    const x = offsetPositions[vertexWeld[i]];
    ipos.setXYZ(i, x.x, x.y, x.z);
  }
  ipos.needsUpdate = true;
  inner.computeVertexNormals();
  inner.computeBoundingBox();
  inner.computeBoundingSphere();

  // Cavity must be a real solid (positive volume) — a collapsed interior means
  // the thickness consumed the body.
  const innerVol = signedVolume(inner);
  if (!(innerVol > 0)) {
    throw new Error(
      `SHELL_THICKNESS_TOO_LARGE: wall thickness collapses the interior (inner cavity ` +
      `volume ${innerVol.toFixed(3)} mm³ ≤ 0). Reduce the thickness.`,
    );
  }
  return inner;
}

/** Gauss elimination with partial pivoting for the tiny (≤3×3) Gram systems. */
function solveSmallSPD(G: number[][], rhs: number[]): number[] | null {
  const k = G.length;
  const M = G.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    if (piv !== col) { const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp; }
    for (let r = col + 1; r < k; r++) {
      const f = M[r][col] / M[col][col];
      for (let cc = col; cc <= k; cc++) M[r][cc] -= f * M[col][cc];
    }
  }
  const out = new Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = M[r][k];
    for (let cc = r + 1; cc < k; cc++) s -= M[r][cc] * out[cc];
    out[r] = s / M[r][r];
  }
  return out;
}

/**
 * Shared mesh-shell core (uniform or per-plane thickness — variableShell
 * reuses it with an axis-binned thickness function).
 */
export function applyExactMeshShell(
  geometry: THREE.BufferGeometry,
  thicknessForPlane: (n: THREE.Vector3) => number,
  openFace: number,
  ctx?: { featureId?: string; faceSelections?: { normal: [number, number, number]; position: [number, number, number] }[] },
): THREE.BufferGeometry {
  if (!geometry.index) {
    throw new Error('Shell requires indexed (closed/manifold) geometry');
  }
  if (geometry.attributes.position.count < 4) {
    throw new Error('Shell requires geometry with at least 4 vertices');
  }

  const analysis = analyzePlanarConvexSolid(geometry);
  const openPlane = resolveOpenPlane(analysis, openFace, ctx?.faceSelections?.[0]);
  const inner = buildInnerCavity(
    geometry,
    analysis,
    thicknessForPlane,
    openPlane === null ? new Set<number>() : new Set([openPlane]),
  );

  // B1 deep — stamp the cavity so triangles it contributes (the inner walls)
  // resolve back to this shell feature instead of the upstream geometry.
  if (ctx?.featureId) {
    stampFaceFeatureIdAll(inner, ctx.featureId, { avoidIdsFrom: geometry });
  }
  const evaluator = new Evaluator();
  configureEvaluatorForProvenance(evaluator, geometry, inner);
  const result = evaluator.evaluate(makeBrush(geometry), makeBrush(inner), SUBTRACTION);
  propagateFeatureIdMap(result.geometry, geometry, inner);
  return result.geometry;
}

export const shellFeature: FeatureDefinition = {
  type: 'shell',
  icon: '🥚',
  params: [
    { key: 'wallThickness', labelKey: 'paramShellThickness', default: 3, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    {
      key: 'openFace',
      labelKey: 'paramShellOpenFace',
      default: 1,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'openFaceNone' },
        { value: 1, labelKey: 'openFaceTop' },
        { value: 2, labelKey: 'openFaceBottom' },
      ],
    },
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params, ctx) {
    const thickness = params.wallThickness;
    const openFace = Math.round(params.openFace);
    const engine = Math.round(params.engine ?? 0);

    if (shouldUseOcctEngine(engine)) {
      try {
        // Fail-clean host contract: registered handle, or null only when the
        // mesh verifiably IS a box (the box host is then faithful); otherwise
        // resolveBrepHostHandle throws → mesh fallback below. Never shell a
        // bounding-box stand-in of a non-box body.
        const upstreamHandle = resolveBrepHostHandle(geometry);
        const host = hostBoxFromGeometry(geometry);
        const result = occtShellBox(host, thickness, openFace, undefined, upstreamHandle);
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        console.warn('[shell] OCCT path failed, falling back to three-bvh-csg:', err);
        captureKernelFailure({
          op: 'shell',
          params: { wallThickness: thickness, openFace, featureId: ctx?.featureId ?? '' },
          geometry,
          error: err,
          resolution: { strategy: 'mesh-fallback', requested: { wallThickness: thickness } },
        });
      }
    }

    const out = applyExactMeshShell(geometry, () => thickness, openFace, ctx);
    return noteMeshFallback(out, { op: 'Shell', engine, featureId: ctx?.featureId });
  },

  /** OCCT async path: resolve the host under the fail-clean contract (with
   *  the mesh→B-rep bridge for handle-less bodies), and — when the user picked
   *  a face to leave open — re-resolve it against the current solid's face
   *  signatures into a FaceFinder so exactly that face opens, surviving
   *  rebuilds. Any failure falls to the sync path (which retries OCCT sync,
   *  then the mesh fallback). */
  async applyAsync(geometry, params, ctx) {
    const thickness = params.wallThickness;
    const openFace = Math.round(params.openFace);
    const engine = Math.round(params.engine ?? 0);
    const sel = ctx?.faceSelections?.[0];
    if (shouldUseOcctEngine(engine)) {
      try {
        const upstreamHandle = await resolveBrepHostHandleAsync(geometry);
        let faceFinder: unknown = undefined;
        if (sel && upstreamHandle) {
          faceFinder = await buildFaceFinderBySignature(
            { position: sel.position, normal: sel.normal },
            occtFaceSignatures(upstreamHandle),
          ) ?? undefined;
        }
        // Shell the REAL (possibly bridged) solid — with the re-resolved face
        // finder when available, else the openFace heuristic. Never a bbox
        // stand-in: resolveBrepHostHandleAsync already threw for those.
        const host = hostBoxFromGeometry(geometry);
        const result = occtShellBox(host, thickness, openFace, undefined, upstreamHandle, faceFinder);
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        console.warn('[shell] OCCT face-finder path failed, falling back:', err);
        captureKernelFailure({
          op: 'shell',
          stage: 'occt-face-finder',
          params: { wallThickness: thickness, openFace, featureId: ctx?.featureId ?? '' },
          geometry,
          error: err,
          resolution: { strategy: 'mesh-fallback', requested: { wallThickness: thickness } },
        });
      }
    }
    return shellFeature.apply(geometry, params, ctx);
  },
};
