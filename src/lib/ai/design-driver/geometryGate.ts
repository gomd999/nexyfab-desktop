/**
 * design-driver/geometryGate — gate (a): deterministic geometry build +
 * watertightness / volume verification.
 *
 * Consumes (수정 없음):
 *   - `featureToPolyhedron` / `polyhedronEdges` (src/lib/cad/featureMesh)
 *     for the meshes and the manifold-edge structure.
 *
 * Self-implemented here (소유 범위 내 계산):
 *   - mesh volume via the divergence theorem — exact for the tessellated
 *     geometry. MEASURED CAVEAT (실측 260721): featureMesh's centroid
 *     flip-heuristic mis-orients faces bordering the concavity of
 *     NON-CONVEX solids (L-profile: raw signed sum 5760 ≠ 14720 mm³), so
 *     the raw face winding cannot be trusted. `manifoldVolume` therefore
 *     RE-ORIENTS the faces consistently by edge-adjacency propagation
 *     (each manifold edge must be traversed in opposite directions by its
 *     two faces) and returns |signed sum| — exact for any closed
 *     orientable 2-manifold, independent of the input winding. A
 *     non-orientable / non-propagatable mesh is an explicit failure.
 *     Fan triangulation of a planar (possibly non-convex) face loop
 *     preserves the signed integral exactly.
 *   - watertight check: every derived edge must be shared by EXACTLY two
 *     faces (boundary edges or >2-fan edges ⇒ not a closed 2-manifold).
 *   - AABB pairwise-disjointness across a part's bodies: the part volume
 *     is reported as the SUM of body volumes, which is only honest when
 *     bodies don't overlap. Zero-thickness contact (stacked bodies sharing
 *     a plane) is allowed; positive-volume AABB overlap fails the gate
 *     (AABB 비중첩 ⇒ 솔리드 비중첩은 참; 역은 미판정 — 그 경우 합산을
 *     거부한다, 근사로 때우지 않는다).
 *
 * Meshing failures (featureMesh throws on degenerate input) are CAPTURED
 * into the gate result — a degenerate body is a geometry-gate FAIL with
 * the thrown reason, not a driver crash.
 */

import {
  featureToPolyhedron,
  polyhedronEdges,
  type Polyhedron,
} from '@/lib/cad/featureMesh';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import type { GateResult, PlanPart } from './types';
import { decompositionBasisLine, decompositionVolumeMm3, discrepancyLine, splitVolumeDiscrepancy } from './volumeDecomposition';

// ─── build artifacts ─────────────────────────────────────────────────────

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BodyGeometry {
  bodyId: string;
  /** Mesh in the FEATURE frame (untranslated) — the frame topo names and
   *  drawing measurements use. Null when meshing failed. */
  poly: Polyhedron | null;
  /** AABB in the PART frame (body translate applied). Null when unmeshed. */
  bbox: Aabb | null;
  volumeMm3: number;
  /** Faces re-wound by `manifoldVolume`'s orientation propagation. */
  flippedFaces: number;
  watertight: boolean;
  nonManifoldEdges: number;
  /** Meshing failure message (featureMesh refusal), when meshing failed. */
  error?: string;
}

export interface PartGeometry {
  partId: string;
  bodies: BodyGeometry[];
  /** Sum of body volumes — only meaningful when bodies are disjoint. */
  totalVolumeMm3: number;
  /** Part-frame composite AABB over all meshed bodies (null if none). */
  bbox: Aabb | null;
  /** Body-id pairs whose AABBs intersect with positive volume. */
  overlappingBodyPairs: Array<[string, string]>;
}

/** Volume below this (mm³) counts as degenerate. */
const VOLUME_EPS = 1e-9;
/** AABB overlap thickness below this (mm) counts as surface contact, not overlap. */
const CONTACT_EPS = 1e-9;

/** Divergence-theorem contribution of ONE face (fan from vs[0]), ×6. */
function faceSixVolume(poly: Polyhedron, faceIdx: number): number {
  const vs = poly.faces[faceIdx].vertices;
  const v0 = poly.vertices[vs[0]];
  let six = 0;
  for (let i = 1; i < vs.length - 1; i++) {
    const v1 = poly.vertices[vs[i]];
    const v2 = poly.vertices[vs[i + 1]];
    six +=
      v0.x * (v1.y * v2.z - v1.z * v2.y) +
      v0.y * (v1.z * v2.x - v1.x * v2.z) +
      v0.z * (v1.x * v2.y - v1.y * v2.x);
  }
  return six;
}

/**
 * Raw signed volume with the faces' AS-STORED winding: V = (1/6) Σ_faces
 * Σ_fan v0 · (v1 × v2). Only trustworthy when the winding is globally
 * consistent — see module header for the measured non-convex caveat.
 */
export function polyhedronVolume(poly: Polyhedron): number {
  let six = 0;
  for (let f = 0; f < poly.faces.length; f++) six += faceSixVolume(poly, f);
  return six / 6;
}

export interface ManifoldVolumeResult {
  ok: boolean;
  /** |signed volume| of the consistently re-oriented manifold (0 on !ok). */
  volumeMm3: number;
  /** Number of faces whose stored winding had to be flipped. */
  flippedFaces: number;
  /** Failure reason (non-manifold edge blocks propagation / orientation conflict). */
  reason?: string;
}

/**
 * Volume of a closed 2-manifold, independent of the input face winding:
 * re-orients faces consistently via edge-adjacency propagation (a manifold
 * edge must be traversed in OPPOSITE directions by its two faces), then
 * returns the absolute divergence-theorem sum. Exact for any orientable
 * closed mesh; refuses (ok:false) on non-manifold or orientation-conflict
 * meshes instead of guessing.
 */
export function manifoldVolume(poly: Polyhedron): ManifoldVolumeResult {
  const faceCount = poly.faces.length;
  // Directed-edge table: undirected key → per-face traversal direction.
  const edgeUses = new Map<string, Array<{ face: number; forward: boolean }>>();
  for (let f = 0; f < faceCount; f++) {
    const vs = poly.faces[f].vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const uses = edgeUses.get(key) ?? [];
      uses.push({ face: f, forward: a < b });
      edgeUses.set(key, uses);
    }
  }
  for (const [key, uses] of edgeUses) {
    if (uses.length !== 2) {
      return { ok: false, volumeMm3: 0, flippedFaces: 0, reason: `edge ${key} used by ${uses.length} face(s) — not a closed 2-manifold` };
    }
  }
  // Face adjacency + orientation propagation (BFS over edge-shared faces).
  const flip = new Array<boolean>(faceCount).fill(false);
  const visited = new Array<boolean>(faceCount).fill(false);
  for (let seed = 0; seed < faceCount; seed++) {
    if (visited[seed]) continue;
    visited[seed] = true;
    const queue = [seed];
    while (queue.length > 0) {
      const f = queue.pop()!;
      const vs = poly.faces[f].vertices;
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i];
        const b = vs[(i + 1) % vs.length];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        const uses = edgeUses.get(key)!;
        const mine = uses.find((u) => u.face === f)!;
        const other = uses.find((u) => u.face !== f);
        if (!other) continue; // self-paired edge on one face — caught above if count ≠ 2
        const effMine = mine.forward !== flip[f]; // XOR
        const requiredFlipOther = other.forward === effMine; // opposite traversal required
        if (!visited[other.face]) {
          visited[other.face] = true;
          flip[other.face] = requiredFlipOther;
          queue.push(other.face);
        } else if (flip[other.face] !== requiredFlipOther) {
          return { ok: false, volumeMm3: 0, flippedFaces: 0, reason: `orientation conflict across edge ${key} — mesh is not orientable` };
        }
      }
    }
  }
  let six = 0;
  let flippedFaces = 0;
  for (let f = 0; f < faceCount; f++) {
    const c = faceSixVolume(poly, f);
    six += flip[f] ? -c : c;
    if (flip[f]) flippedFaces += 1;
  }
  return { ok: true, volumeMm3: Math.abs(six) / 6, flippedFaces };
}

function meshAabb(poly: Polyhedron, translate?: { x: number; y: number; z: number }): Aabb {
  const t: Vec3 = { x: translate?.x ?? 0, y: translate?.y ?? 0, z: translate?.z ?? 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of poly.vertices) {
    const x = v.x + t.x, y = v.y + t.y, z = v.z + t.z;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** True when the AABBs intersect with POSITIVE volume (plane contact OK). */
function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(a.min[k], b.min[k]);
    const hi = Math.min(a.max[k], b.max[k]);
    if (hi - lo <= CONTACT_EPS) return false;
  }
  return true;
}

/** Mesh every body of a part, capturing failures instead of throwing. */
export function buildPartGeometry(part: PlanPart): PartGeometry {
  const bodies: BodyGeometry[] = part.bodies.map((body) => {
    let poly: Polyhedron | null = null;
    let error: string | undefined;
    try {
      poly = featureToPolyhedron(body.feature);
      if (!poly) {
        error = `feature kind '${body.feature.kind}' is not meshable (featureToPolyhedron returned null)`;
      }
    } catch (err) {
      error = (err as Error).message;
    }
    if (!poly) {
      return {
        bodyId: body.bodyId,
        poly: null,
        bbox: null,
        volumeMm3: 0,
        flippedFaces: 0,
        watertight: false,
        nonManifoldEdges: 0,
        error,
      };
    }
    const edges = polyhedronEdges(poly);
    const nonManifoldEdges = edges.filter((e) => e.faces.length !== 2).length;
    const vol = manifoldVolume(poly);
    if (!vol.ok && !error) error = `volume undefined — ${vol.reason}`;
    return {
      bodyId: body.bodyId,
      poly,
      bbox: meshAabb(poly, body.translate),
      volumeMm3: vol.volumeMm3,
      flippedFaces: vol.flippedFaces,
      watertight: nonManifoldEdges === 0,
      nonManifoldEdges,
      ...(error ? { error } : {}),
    };
  });

  let bbox: Aabb | null = null;
  for (const b of bodies) {
    if (!b.bbox) continue;
    bbox = bbox ? aabbUnion(bbox, b.bbox) : b.bbox;
  }
  const overlappingBodyPairs: Array<[string, string]> = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.bbox && b.bbox && aabbsOverlap(a.bbox, b.bbox)) {
        overlappingBodyPairs.push([a.bodyId, b.bodyId]);
      }
    }
  }
  return {
    partId: part.partId,
    bodies,
    totalVolumeMm3: bodies.reduce((s, b) => s + b.volumeMm3, 0),
    bbox,
    overlappingBodyPairs,
  };
}

// ─── gate ────────────────────────────────────────────────────────────────

export function geometryGate(part: PlanPart, geo: PartGeometry): GateResult {
  const reasons: string[] = [];
  const notes: string[] = [
    '부피=발산정리(에지 인접 전파로 일관 재배향한 2-매니폴드 기준 정확 — featureMesh 비볼록 와인딩 결함 실측 보정) · 워터타이트=전 에지 2-면 공유 검사',
  ];

  let minBodyVolume = Infinity;
  let nonManifoldTotal = 0;
  let flippedTotal = 0;
  for (const b of geo.bodies) {
    if (b.error) reasons.push(`body '${b.bodyId}': mesh failed — ${b.error}`);
    if (b.poly && !b.watertight) {
      reasons.push(`body '${b.bodyId}': not watertight — ${b.nonManifoldEdges} non-manifold edge(s)`);
    }
    if (b.poly && b.volumeMm3 <= VOLUME_EPS) {
      reasons.push(
        `body '${b.bodyId}': degenerate — mesh volume ${b.volumeMm3} mm³ ≤ ${VOLUME_EPS} (부피>0 게이트)`,
      );
    }
    nonManifoldTotal += b.nonManifoldEdges;
    flippedTotal += b.flippedFaces;
    if (b.volumeMm3 < minBodyVolume) minBodyVolume = b.volumeMm3;
  }
  for (const [a, b] of geo.overlappingBodyPairs) {
    reasons.push(
      `bodies '${a}' and '${b}' have positive-volume AABB overlap — volume sum is undefined for overlapping bodies (합산 거부)`,
    );
  }

  const metrics: Record<string, number> = {
    bodyCount: geo.bodies.length,
    totalVolumeMm3: geo.totalVolumeMm3,
    minBodyVolumeMm3: Number.isFinite(minBodyVolume) ? minBodyVolume : 0,
    nonManifoldEdges: nonManifoldTotal,
    reorientedFaces: flippedTotal,
  };

  const expected = part.expectedVolume;
  if (expected) {
    const tolRel = expected.tolRel ?? 1e-9;
    notes.push(`expectedVolume basis: ${expected.basis}`);

    // 파라메트릭 근거가 있으면 산술은 엔진이 한다 — 모델이 틀리는 부분이 정확히 이것이다.
    // 분해는 루프가 아니라 브리프 치수에서 나오므로 measured 와 여전히 독립이다(§6-1).
    let authority = expected.valueMm3;
    if (expected.decomposition) {
      let computed: number;
      try {
        computed = decompositionVolumeMm3(expected.decomposition);
      } catch (e) {
        reasons.push(`expectedVolume.decomposition invalid — ${e instanceof Error ? e.message : String(e)}`);
        computed = NaN;
      }
      if (Number.isFinite(computed)) {
        authority = computed;
        metrics.decompositionVolumeMm3 = computed;
        notes.push(decompositionBasisLine(expected.decomposition));
        // 모델이 숫자도 함께 적었다면 자기 분해와 맞는지 본다. 이건 기하 오류가 아니라
        // **산술 오류**이고, 둘을 같은 문장으로 보고하면 어디를 고쳐야 하는지 알 수 없다.
        if (expected.valueMm3 !== undefined) {
          const arithErr =
            Math.abs(expected.valueMm3 - computed) / Math.max(Math.abs(computed), VOLUME_EPS);
          metrics.volumeArithmeticRelError = arithErr;
          if (arithErr > tolRel) {
            reasons.push(
              `expectedVolume.valueMm3 ${expected.valueMm3} mm³ disagrees with your own ` +
                `decomposition (${computed} mm³) by relError ${arithErr} > ${tolRel} — ` +
                `arithmetic error in the stated theory, not a geometry error ` +
                `(the loop was not consulted for either number)`,
            );
          }
        }
      }
    }

    if (authority === undefined) {
      reasons.push('expectedVolume needs valueMm3 or decomposition — 근거 없는 이론 부피는 받지 않는다');
    } else if (Number.isFinite(authority)) {
      const relErr =
        Math.abs(geo.totalVolumeMm3 - authority) / Math.max(Math.abs(authority), VOLUME_EPS);
      metrics.expectedVolumeMm3 = authority;
      metrics.volumeRelError = relErr;
      metrics.volumeTolRel = tolRel;
      if (reasons.length === 0 && relErr > tolRel) {
        // 비율만 말하지 않는다 — 어느 축이 어긋났는지 쪼개서 말한다(260728 §7-1).
        // 실측(bench v1)에서 이 실패 6건 중 4건이 부피 비율만으로는 구별 불가였고,
        // 실제로는 전부 **단면**이었다(깊이는 맞았다). 게이트가 아는 것을 침묵할 이유가 없다.
        let where = '';
        const single = part.bodies.length === 1 ? part.bodies[0] : undefined;
        const feat = single?.feature as { kind?: string; loop?: Array<{ x: number; y: number }>; depth?: number } | undefined;
        if (expected.decomposition && feat?.kind === 'extrude' && Array.isArray(feat.loop) && typeof feat.depth === 'number') {
          const split = splitVolumeDiscrepancy(feat.loop, feat.depth, expected.decomposition, tolRel);
          if (split) {
            metrics.drawnAreaMm2 = split.drawnAreaMm2;
            metrics.declaredAreaMm2 = split.declaredAreaMm2;
            where = ` — ${discrepancyLine(split)}`;
          }
        }
        reasons.push(
          `volume ${geo.totalVolumeMm3} mm³ deviates from theoretical ${authority} mm³ ` +
            `by relError ${relErr} > ${tolRel}${where}`,
        );
      }
    }
  }

  return {
    id: `geometry:${part.partId}`,
    kind: 'geometry',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
