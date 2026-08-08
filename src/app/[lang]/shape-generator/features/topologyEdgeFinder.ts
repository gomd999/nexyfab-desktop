/**
 * topologyEdgeFinder.ts — Phase 3-c-1 spike (Topology Naming Problem)
 *
 * Bridge between NexyFab's selection model (`EdgeSelectionInfo`) and
 * replicad's `EdgeFinder` predicate. The bridge is what lets a fillet
 * feature continue to target *the same edge* after an upstream sketch
 * parameter change — without it, the user-clicked edge becomes a stale
 * triangle index after the next remesh and the feature silently drifts.
 *
 * **Scope of this spike** (intentionally small):
 *   1. Convert a single click-point selection into an EdgeFinder that
 *      matches one specific edge by spatial position.
 *   2. Stay opaque about replicad's internal API — we only call the
 *      builder methods documented in replicad's README so future
 *      version bumps don't break us. Strong typing of EdgeFinder itself
 *      is deferred until phase 3-c-2.
 *   3. No production wiring. The pipeline manager keeps using the
 *      pass-through `edgeFinder?` slot already present in
 *      `occtFilletBox` / `occtChamferBox`.
 *
 * **Out of scope** (logged as follow-ups):
 *   - Multi-edge selection (an array of finders chained with `.or()`).
 *   - Direction-based finders (`inDirection`) — needed when the user
 *     selects an edge loop (e.g. "all four top edges of the box").
 *   - Robustness against B-rep splits / merges across boolean ops.
 *
 * Tested manually via the OCCT-feasibility vitest harness (see the
 * companion `topologyEdgeFinder.spike.test.ts`, skipped unless
 * `RUN_OCCT_FEASIBILITY=1`).
 */

import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import type { ReplicadEdgeFinder } from './occtEngine';
import { occtEdgeSignatures, occtTopoNames, occtTopoAnchor } from './occtEngine';
import { bestEdgeMatch, matchFaceBySignature, type EdgeMatchRejection, type EdgeSig, type FaceSig } from './edgeCorrespondence';
import { reportWarning } from '../lib/telemetry';
import type { MeshDowngradeNotice } from './downgradeNotice';
import { AXIS_EPS } from './tolerancePolicy';

/** The subset of EdgeFinder builder methods we rely on. Pulled from
 *  replicad's README — kept here as a typed shim so consumers don't
 *  need to import `replicad` directly. */
export interface BBox3 {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Remap a click point through a bounding-box change so the finder follows the
 * edge when a dimension is edited. For each axis we keep the click's fractional
 * position within the old part bbox and re-apply it to the current bbox. For
 * axis-aligned box edges this lands the point exactly on the moved edge; for
 * other shapes it is a close linear approximation (far better than the stale
 * absolute point). Returns the original point if either bbox is missing.
 */
export function remapPointThroughBbox(
  point: [number, number, number],
  oldBbox: BBox3 | undefined,
  currentBbox: BBox3 | undefined,
): [number, number, number] {
  if (!oldBbox || !currentBbox) return point;
  const out: [number, number, number] = [point[0], point[1], point[2]];
  for (let i = 0; i < 3; i++) {
    const span = oldBbox.max[i] - oldBbox.min[i];
    const frac = Math.abs(span) > AXIS_EPS ? (point[i] - oldBbox.min[i]) / span : 0.5;
    out[i] = currentBbox.min[i] + frac * (currentBbox.max[i] - currentBbox.min[i]);
  }
  return out;
}

interface EdgeFinderBuilder {
  containsPoint: (point: [number, number, number], tolerance?: number) => EdgeFinderBuilder;
  inDirection: (direction: [number, number, number]) => EdgeFinderBuilder;
  ofLength: (length: number, tolerance?: number) => EdgeFinderBuilder;
  /** OR-combine with another finder. Multi-edge selection composes
   *  per-edge finders with .or() so OCCT matches any of them. */
  either?: (finders: EdgeFinderBuilder[]) => EdgeFinderBuilder;
  or?: (other: EdgeFinderBuilder) => EdgeFinderBuilder;
}

/** Dynamic-import lookup so this module doesn't drag `replicad` into the
 *  type graph at compile time. Returns null when replicad hasn't been
 *  initialised (e.g. on the server before WASM load, or in unit tests
 *  without the OCCT_FEASIBILITY flag). */
async function getEdgeFinderConstructor(): Promise<{ new(): EdgeFinderBuilder } | null> {
  try {
    const rc = (await import('replicad')) as unknown as { EdgeFinder?: new () => EdgeFinderBuilder };
    return rc.EdgeFinder ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a replicad EdgeFinder predicate from a NexyFab edge selection.
 *
 * Strategy (single-edge case): combine `containsPoint` with the click
 * location + an `ofLength` filter using the recorded edge length. This
 * is more discriminating than position alone — two edges meeting at the
 * click point share `containsPoint`, but the length filter breaks ties.
 *
 * Returns `null` when replicad isn't available (the caller should fall
 * back to the previous "fillet every edge" behaviour rather than crash).
 */
export async function buildEdgeFinderFromSelection(
  selection: EdgeSelectionInfo,
  opts: { positionTolerance?: number; lengthTolerance?: number; currentBbox?: BBox3 } = {},
): Promise<ReplicadEdgeFinder | null> {
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;
  // replicad's EdgeFinder may throw if OCCT WASM hasn't initialised yet
  // (e.g. tests that load the module but skip ensureOcctReady). Failing
  // fast with `null` matches the "no replicad" path so the caller's
  // fallback path is the same.
  try {
    // Scale-aware: remap the click point through any dimension change so the
    // finder follows the edge; anchor with the edge direction (robust to
    // movement) and only fall back to ofLength when no direction was captured.
    const pt = remapPointThroughBbox(selection.position, selection.bbox, opts.currentBbox);
    let f = new Ctor().containsPoint(pt, opts.positionTolerance ?? 0.5);
    if (selection.direction) {
      f = f.inDirection(selection.direction);
    } else if (Number.isFinite(selection.length) && selection.length > 0) {
      f = f.ofLength(selection.length, opts.lengthTolerance ?? 0.1);
    }
    return f as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}

/**
 * Outcome of re-resolving a stored edge reference against the current solid.
 *
 * ⚠ The three cases are NOT interchangeable, and collapsing them into `null`
 * is the bug ADR-017 §D1 exists to prevent:
 *
 *  - `matched`     — we know which edge this is. Use the finder.
 *  - `unavailable` — we could not even try (no stored direction, no candidate
 *                    signatures, replicad not loaded). The caller's click-point
 *                    fallback is legitimate here: nothing has been ruled out.
 *  - `lost`        — we DID try and the matcher refused, because the best
 *                    candidate was unconvincing or indistinguishable from its
 *                    runner-up. **Falling back to the stale click point here is
 *                    exactly the silent guess** — the matcher already told us it
 *                    cannot identify the edge, and a stale absolute point is
 *                    strictly less informed than the signature it just rejected.
 *                    Callers must surface this and ask the user to re-select.
 */
export type EdgeRefResolution =
  | { status: 'matched'; finder: ReplicadEdgeFinder; /** K7-S3 — index of the matched candidate (A/B control-group comparison). */ index?: number }
  | { status: 'unavailable'; reason: 'no_stored_direction' | 'no_candidates' | 'replicad_unavailable' | 'finder_threw' }
  | { status: 'lost'; reason: EdgeMatchRejection; suggestion: EdgeSig | null };

/** User-facing notice for a lost edge reference. Severity is 'blocked': the
 *  feature cannot be applied to the edge the user chose, and guessing a
 *  different edge would be worse than not applying it. */
export function makeReferenceLostNotice(
  op: string,
  reason: EdgeMatchRejection,
  featureId?: string,
): MeshDowngradeNotice {
  const why = reason === 'ambiguous'
    ? 'several edges of the rebuilt solid match it equally well'
    : reason === 'name_gone'
      ? 'its generative-history name no longer exists in the rebuilt solid'
    : reason === 'low_confidence'
      ? 'no edge of the rebuilt solid resembles it closely enough'
      : reason === 'no_parallel_candidate'
        ? 'no edge of the rebuilt solid runs in the same direction'
        : 'the rebuilt solid reported no edges';
  return {
    op,
    featureId,
    severity: 'blocked',
    i18nKey: 'reference.lost',
    fallbackMessage:
      `${op}: the selected edge could not be identified after the rebuild — ${why}. ` +
      `The feature was NOT applied to a guessed edge. Please re-select the edge.`,
    detail: reason,
  };
}

/**
 * Topology-tolerant resolution: match the stored selection against the CURRENT
 * solid's edge signatures and anchor the finder at the matched edge's *actual*
 * midpoint + direction. Unlike remapping a stale click point, this re-anchors
 * onto the real edge, so the selection survives topology changes (a feature
 * added elsewhere) as long as the target edge still exists.
 *
 * Reports `lost` vs `unavailable` distinctly — see `EdgeRefResolution`.
 */
export async function resolveEdgeFinderBySignature(
  selection: EdgeSelectionInfo,
  candidates: EdgeSig[],
  currentBbox?: BBox3,
): Promise<EdgeRefResolution> {
  if (!selection.direction) return { status: 'unavailable', reason: 'no_stored_direction' };
  if (candidates.length === 0) return { status: 'unavailable', reason: 'no_candidates' };
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return { status: 'unavailable', reason: 'replicad_unavailable' };
  // Remap the click point as the matcher's starting guess (helps when a
  // dimension also changed); direction does the heavy lifting.
  const targetMid = remapPointThroughBbox(selection.position, selection.bbox, currentBbox);
  const target: EdgeSig = { mid: targetMid, dir: selection.direction, length: selection.length };
  // Scale the midpoint term by the part size, matching how the ADR-017 spike
  // (and the gate calibration) drives the matcher.
  const scale = currentBbox
    ? Math.max(
        currentBbox.max[0] - currentBbox.min[0],
        currentBbox.max[1] - currentBbox.min[1],
        currentBbox.max[2] - currentBbox.min[2],
      )
    : undefined;
  const m = bestEdgeMatch(target, candidates, scale ? { scale } : {});
  if (m.lost) {
    return {
      status: 'lost',
      reason: m.reason!,
      // The candidate the gate refused — offer it for CONFIRMATION, never apply it.
      suggestion: m.rejectedIndex >= 0 ? candidates[m.rejectedIndex]! : null,
    };
  }
  const matched = candidates[m.index]!;
  try {
    return {
      status: 'matched',
      index: m.index,
      finder: new Ctor()
        .inDirection(matched.dir)
        .containsPoint(matched.mid, 0.5) as unknown as ReplicadEdgeFinder,
    };
  } catch {
    return { status: 'unavailable', reason: 'finder_threw' };
  }
}

/**
 * K7-S4 — 이중화 해석의 공용 진입점. fillet에서 검증된 S3 로직의 추출이며
 * chamfer·variableFillet·occtFilletAvoidance 가 같은 경로를 쓴다(소비처별
 * 재구현 금지). A안(생성-이력 이름) 우선, B안(서명)은 폴백+대조군:
 *   - 이름표 실재 + 이름 실재 → 앵커와 일치하는 현재 에지를 정확 서명으로
 *     해석(A 확정). B안을 병행 판정해 다른 에지를 골랐으면 경고 로그만
 *     남긴다(S5 강등 근거 수집).
 *   - 이름표 실재 + 이름 소멸 → {lost, 'name_gone'} — 추측 적용 금지(D1).
 *   - 이름표 부재·앵커 불일치·파인더 구성 불가 → 기존 B안 판정 그대로.
 */
export async function resolveEdgeRefDual(
  selection: EdgeSelectionInfo,
  handle: string,
  currentBbox?: BBox3,
  op = 'edge-ref',
): Promise<EdgeRefResolution> {
  const sigs = occtEdgeSignatures(handle);
  if (selection.topoName && occtTopoNames(handle)) {
    const anchor = occtTopoAnchor(handle, selection.topoName);
    if (!anchor) return { status: 'lost', reason: 'name_gone', suggestion: null };
    const aIndex = sigs.findIndex(sg =>
      Math.hypot(sg.mid[0] - anchor.x, sg.mid[1] - anchor.y, sg.mid[2] - anchor.z) <= 1e-2);
    if (aIndex >= 0) {
      const target = sigs[aIndex]!;
      const exact: EdgeSelectionInfo = {
        ...selection,
        position: [target.mid[0], target.mid[1], target.mid[2]],
        direction: [target.dir[0], target.dir[1], target.dir[2]],
        length: target.length,
        bbox: undefined, // 현재 좌표 그대로 — bbox 재사상은 항등이어야 한다
      };
      const resA = await resolveEdgeFinderBySignature(exact, sigs, undefined);
      if (resA.status === 'matched') {
        const resB = await resolveEdgeFinderBySignature(selection, sigs, currentBbox);
        // 불일치는 콘솔이 아니라 **내구 텔레메트리**로 — S5(B안 강등) 판단의
        // 유일한 증거 채널이다. 콘솔 로그는 프로덕션에서 아무도 못 본다.
        if (resB.status === 'matched' && resB.index !== undefined && resB.index !== aIndex) {
          reportWarning('feature_pipeline', new Error('k7_ab_mismatch_different_edge'), {
            op, topoName: selection.topoName, aIndex, bIndex: resB.index,
          });
        } else if (resB.status === 'lost') {
          reportWarning('feature_pipeline', new Error('k7_ab_mismatch_signature_lost'), {
            op, topoName: selection.topoName, aIndex, bReason: resB.reason,
          });
        }
        return resA;
      }
      // A 앵커는 실재하나 파인더 구성 불가(replicad 미가용 등) — B안 속행.
    }
    // 이름은 있으나 앵커가 현재 에지와 불일치(중점 이동) — 커널 히스토리 없는
    // 브라우저 합성의 한계다. 단정하지 않고 B안 판정에 맡긴다.
  }
  return resolveEdgeFinderBySignature(selection, sigs, currentBbox);
}

/**
 * @deprecated Collapses `lost` and `unavailable` into `null`, which loses the
 * one distinction that matters (see `EdgeRefResolution`). Kept for callers that
 * only need a finder-or-nothing; new code should use
 * `resolveEdgeFinderBySignature` and handle `lost` explicitly.
 */
export async function buildEdgeFinderBySignature(
  selection: EdgeSelectionInfo,
  candidates: EdgeSig[],
  currentBbox?: BBox3,
): Promise<ReplicadEdgeFinder | null> {
  const r = await resolveEdgeFinderBySignature(selection, candidates, currentBbox);
  return r.status === 'matched' ? r.finder : null;
}

interface FaceFinderBuilder {
  containsPoint: (point: [number, number, number], tolerance?: number) => FaceFinderBuilder;
  inDirection: (direction: [number, number, number]) => FaceFinderBuilder;
}

async function getFaceFinderConstructor(): Promise<{ new(): FaceFinderBuilder } | null> {
  try {
    const rc = (await import('replicad')) as unknown as { FaceFinder?: new () => FaceFinderBuilder };
    return rc.FaceFinder ?? null;
  } catch {
    return null;
  }
}

/**
 * Topology-tolerant face resolution: match a stored face selection against the
 * CURRENT solid's face signatures and build a FaceFinder anchored on the
 * matched face's actual centre. Used by shell (remove the picked face) so a
 * face selection survives rebuilds. Returns null when there's no candidate or
 * no match — callers fall back to their non-face path.
 */
export async function buildFaceFinderBySignature(
  selection: { position: [number, number, number]; normal: [number, number, number] },
  candidates: FaceSig[],
): Promise<unknown | null> {
  if (candidates.length === 0) return null;
  const Ctor = await getFaceFinderConstructor();
  if (!Ctor) return null;
  const target: FaceSig = { center: selection.position, normal: selection.normal };
  const idx = matchFaceBySignature(target, candidates);
  if (idx < 0) return null;
  const matched = candidates[idx]!;
  try {
    return new Ctor().containsPoint(matched.center, 0.5);
  } catch {
    return null;
  }
}

/** Pick a "shared direction" for a group of edges so a single
 *  `inDirection` filter captures the full loop (e.g. all four top
 *  edges of a box share +Z normal-of-face × axis-of-edge).
 *
 *  Heuristic: take the per-selection face normal, find the dominant
 *  axis (max-abs component) across the group. If a clear winner
 *  (≥ 75% agreement) exists, return the unit vector. Otherwise
 *  return null — caller should fall back to multi-edge .or() finder.
 */
export function inferLoopDirection(
  selections: EdgeSelectionInfo[],
): [number, number, number] | null {
  if (selections.length < 2) return null;
  const axisVotes = [0, 0, 0]; // X, Y, Z
  const axisSign = [0, 0, 0];  // +/- sign for the winning axis
  for (const sel of selections) {
    const n = sel.normal;
    const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const max = Math.max(...abs);
    const idx = abs.indexOf(max);
    axisVotes[idx]!++;
    axisSign[idx]! += n[idx]! >= 0 ? 1 : -1;
  }
  const winnerIdx = axisVotes.indexOf(Math.max(...axisVotes));
  const winnerVotes = axisVotes[winnerIdx]!;
  if (winnerVotes / selections.length < 0.75) return null;
  const sign = axisSign[winnerIdx]! >= 0 ? 1 : -1;
  const dir: [number, number, number] = [0, 0, 0];
  dir[winnerIdx] = sign;
  return dir;
}

/**
 * Build an EdgeFinder that matches a *loop* of edges by direction.
 * Cheaper to query than multi-edge .or() when the user really meant
 * "all top edges" rather than "these four specific edges".
 *
 * Returns null if direction can't be inferred (mixed normals) or
 * replicad isn't loaded — callers should chain to
 * `buildEdgeFinderFromMultiSelection` as the fallback.
 */
export async function buildEdgeFinderForLoop(
  selections: EdgeSelectionInfo[],
  opts: { positionTolerance?: number; currentBbox?: BBox3 } = {},
): Promise<ReplicadEdgeFinder | null> {
  const dir = inferLoopDirection(selections);
  if (!dir) return null;
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;
  try {
    const f = new Ctor().inDirection(dir);
    // Anchor the direction filter with a single representative point
    // (scale-aware: remapped through any dimension change) so we don't
    // match every parallel edge — only those sharing the loop's region.
    const rep = selections[0]!;
    const pt = remapPointThroughBbox(rep.position, rep.bbox, opts.currentBbox);
    return f.containsPoint(pt, opts.positionTolerance ?? 5.0) as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}

/**
 * Build a single finder that matches *any* of the supplied edges.
 *
 * replicad's `EdgeFinder` exposes two OR shapes across versions —
 * `.either([f1, f2, ...])` and `.or(other)`. We probe both at call time
 * because pinning to one breaks on upstream renames. If neither is
 * available, the single-edge fallback is the first selection — better
 * than returning null and filleting every edge.
 */
export async function buildEdgeFinderFromMultiSelection(
  selections: EdgeSelectionInfo[],
  opts: { positionTolerance?: number; lengthTolerance?: number; currentBbox?: BBox3 } = {},
): Promise<ReplicadEdgeFinder | null> {
  if (selections.length === 0) return null;
  if (selections.length === 1) {
    return buildEdgeFinderFromSelection(selections[0]!, opts);
  }
  const Ctor = await getEdgeFinderConstructor();
  if (!Ctor) return null;

  const posTol = opts.positionTolerance ?? 0.5;
  const lenTol = opts.lengthTolerance ?? 0.1;

  try {
    const finders: EdgeFinderBuilder[] = [];
    for (const sel of selections) {
      // Scale-aware: remap the click point + anchor with the edge direction
      // (robust to movement) like the single-edge case.
      const pt = remapPointThroughBbox(sel.position, sel.bbox, opts.currentBbox);
      let f = new Ctor().containsPoint(pt, posTol);
      if (sel.direction) {
        f = f.inDirection(sel.direction);
      } else if (Number.isFinite(sel.length) && sel.length > 0) {
        f = f.ofLength(sel.length, lenTol);
      }
      finders.push(f);
    }

    const head = finders[0]!;
    // Prefer .either([…]) if replicad exposes it.
    if (typeof head.either === 'function') {
      return head.either(finders.slice(1)) as unknown as ReplicadEdgeFinder;
    }
    // Fall back to chained .or() pairs.
    if (typeof head.or === 'function') {
      let combined: EdgeFinderBuilder = head;
      for (let i = 1; i < finders.length; i++) {
        combined = combined.or!(finders[i]!);
      }
      return combined as unknown as ReplicadEdgeFinder;
    }
    // Neither — degrade to the first selection alone.
    return head as unknown as ReplicadEdgeFinder;
  } catch {
    return null;
  }
}
