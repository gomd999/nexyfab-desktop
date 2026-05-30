/**
 * mateInference.ts — Track E: AI mate inference for 2-part pairs.
 *
 * Heuristic v1 mate suggester. Pairs naturally with the existing
 * `add_mate` / `solve_mates` tools (Stage 4 I): given two part
 * fingerprints (intent + measured bbox + optional detected holes) the
 * suggester proposes the most likely physical mate(s) between them —
 * face contact, axis alignment, hole pattern alignment, mirror — each
 * with a confidence score, a numeric hint, and any hard blockers.
 *
 * Why heuristic v1 (no ML): the same reason as materialRecommendation —
 * cheap, deterministic, cite-able. The 5 mate categories below cover
 * 90% of two-part assembly intents we observe in the agent traces.
 *
 * Output contract:
 *   - Always returns at most one suggestion per category that fires.
 *   - face_touch / face_offset run per axis (X/Y/Z) and emit one
 *     entry per axis so the agent can pick the most physical one.
 *   - Blockers populate when a category was checked but failed so the
 *     agent has diagnostic information without an empty list.
 *   - Sorted by confidence descending — top entry is the recommended
 *     starting point for `add_mate`.
 *
 * Pure / additive — no mutation of session, no network, no async.
 */

import type { IntentInput } from '../../openscad-render/intentToScad';
import type { MeasuredBbox } from './specVerification';

export type SuggestedMateType =
  /** Two flat faces touch with no gap (e.g. bracket on plate). */
  | 'face_touch'
  /** Two flat faces face each other across a known distance. */
  | 'face_offset'
  /** Two cylindrical holes (or hole + shaft) share an axis. */
  | 'concentric'
  /** Multiple matching hole positions across both parts (bolt pattern). */
  | 'hole_pattern_align'
  /** Parts share an axis line (e.g., stacked cylinders). */
  | 'axis_align'
  /** Parts mirror each other across a plane. */
  | 'mirror';

export interface SuggestedMate {
  type: SuggestedMateType;
  /** Headline reason shown to the user. */
  reason: string;
  /** 0..100 confidence. */
  confidence: number;
  /** Concrete numeric hint: distance (mm), axis, position, etc. */
  hint: Record<string, number | string | number[]>;
  /** Hard blockers when applicable (e.g. "no overlapping faces detected"). */
  blockers: string[];
}

export interface PartFingerprint {
  /** Intent the part was built from (drives hole-pattern matching). */
  intent: IntentInput;
  /** Measured bbox from a previous render/verify run. */
  bbox: MeasuredBbox;
  /** Detected hole positions across the 3 cardinal axes (from
   *  detectAllAxisAlignedHoles). Optional — when omitted, no
   *  hole_pattern_align suggestions surface. */
  holes?: Array<{ axis: 'x' | 'y' | 'z'; cx: number; cy: number; diameter: number }>;
}

export interface SuggestMatesOptions {
  partA: PartFingerprint;
  partB: PartFingerprint;
  /** Position the AI inferred for partB relative to partA (e.g. an
   *  assembly composition translate). When provided, the relative-
   *  position suggestions get higher confidence. */
  relativePositionMm?: [number, number, number];
  /** Tolerance for "matching" diameter / position (default 0.5 mm). */
  toleranceMm?: number;
}

const DEFAULT_TOL_MM = 0.5;

/** Shapes whose bbox is dominated by a cylindrical or pipe axis along Z.
 *  Drives both concentric and axis_align heuristics. */
const CYLINDRICAL_SHAPES = new Set<string>(['cylinder', 'pipe', 'disk']);

/** Per-axis bbox extents (center + min/max). */
interface AxisExtent { min: number; max: number; center: number; size: number; }

function axisExtent(bbox: MeasuredBbox, idx: 0 | 1 | 2): AxisExtent {
  const min = bbox.min[idx];
  const max = bbox.max[idx];
  return { min, max, center: (min + max) / 2, size: max - min };
}

const AXIS_LABEL: ['x', 'y', 'z'] = ['x', 'y', 'z'];

/**
 * v1 face contact / offset detection. For each axis we compute the
 * smaller of:
 *   - (A.max - B.min)  — "A is on the negative side of B"
 *   - (B.max - A.min)  — "B is on the negative side of A"
 * and report the signed gap (positive when faces are separated, 0 when
 * touching, negative when interpenetrating). Confidence 75 for touch
 * (|gap| ≤ tol), 50 for offset (0 < gap < 100 mm), no entry beyond
 * 100 mm — parts that far apart probably aren't mated face-to-face.
 */
function faceContactSuggestions(
  partA: PartFingerprint,
  partB: PartFingerprint,
  tolMm: number,
): SuggestedMate[] {
  const out: SuggestedMate[] = [];
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    const a = axisExtent(partA.bbox, i);
    const b = axisExtent(partB.bbox, i);
    const gapAplus = b.min - a.max; // positive = gap on +axis side of A
    const gapBplus = a.min - b.max; // positive = gap on +axis side of B
    // Pick the smaller absolute gap (the "more plausible" pairing).
    const useA = Math.abs(gapAplus) <= Math.abs(gapBplus);
    const gap = useA ? gapAplus : gapBplus;
    const planeDescr = useA ? 'A.max == B.min' : 'B.max == A.min';
    const axis = AXIS_LABEL[i];
    if (Math.abs(gap) <= tolMm) {
      out.push({
        type: 'face_touch',
        reason: `Bboxes touch along ${axis} (${planeDescr}, gap ${gap.toFixed(2)} mm).`,
        confidence: 75,
        hint: { axis, plane: planeDescr, gapMm: Number(gap.toFixed(3)) },
        blockers: [],
      });
    } else if (gap > 0 && gap < 100) {
      out.push({
        type: 'face_offset',
        reason: `Bboxes face each other along ${axis} with ${gap.toFixed(1)} mm gap.`,
        confidence: 50,
        hint: { axis, distanceMm: Number(gap.toFixed(3)) },
        blockers: [],
      });
    }
    // Beyond 100 mm we don't emit — the bboxes are too far apart to
    // suggest a face-mate.
  }
  return out;
}

/**
 * Extract a "primary" cylindrical hole feature from a part's hole list
 * along the given axis. Returns the closest-to-center hole when multiple
 * holes share the axis. Used as the canonical reference for concentric.
 */
function primaryHole(
  holes: PartFingerprint['holes'],
  axis: 'x' | 'y' | 'z',
): { cx: number; cy: number; diameter: number } | null {
  if (!holes || holes.length === 0) return null;
  const onAxis = holes.filter(h => h.axis === axis);
  if (onAxis.length === 0) return null;
  // Closest to (0,0) in the perpendicular plane wins — typical "main
  // bore" convention for primitives centered at origin.
  let best = onAxis[0]!;
  let bestR = Math.hypot(best.cx, best.cy);
  for (let i = 1; i < onAxis.length; i++) {
    const h = onAxis[i]!;
    const r = Math.hypot(h.cx, h.cy);
    if (r < bestR) { best = h; bestR = r; }
  }
  return { cx: best.cx, cy: best.cy, diameter: best.diameter };
}

/**
 * Detect a concentric mate. Triggered when:
 *   (a) both intents are cylindrical/pipe/disk (axis = Z by convention), OR
 *   (b) both parts have a detected hole on a shared axis whose centers
 *       match within tol and whose diameters are within tol.
 */
function concentricSuggestion(
  partA: PartFingerprint,
  partB: PartFingerprint,
  tolMm: number,
): SuggestedMate | null {
  const aIsCyl = CYLINDRICAL_SHAPES.has(partA.intent.shapeId);
  const bIsCyl = CYLINDRICAL_SHAPES.has(partB.intent.shapeId);

  // Path (a): cylindrical primitives — their Z-axis is the cylinder axis.
  if (aIsCyl && bIsCyl) {
    const ax = axisExtent(partA.bbox, 0).center;
    const ay = axisExtent(partA.bbox, 1).center;
    const bx = axisExtent(partB.bbox, 0).center;
    const by = axisExtent(partB.bbox, 1).center;
    const dist = Math.hypot(ax - bx, ay - by);
    if (dist <= tolMm) {
      const ap = (partA.intent.params ?? {}) as Record<string, number>;
      const bp = (partB.intent.params ?? {}) as Record<string, number>;
      const aDia = ap.diameter ?? ap.outerDiameter ?? axisExtent(partA.bbox, 0).size;
      const bDia = bp.diameter ?? bp.outerDiameter ?? axisExtent(partB.bbox, 0).size;
      const dia = Math.max(aDia, bDia);
      return {
        type: 'concentric',
        reason: `Cylindrical primitives sharing a Z axis at (${ax.toFixed(1)}, ${ay.toFixed(1)}).`,
        confidence: 85,
        hint: { axis: 'z', x: Number(ax.toFixed(3)), y: Number(ay.toFixed(3)), diameter: Number(dia.toFixed(3)) },
        blockers: [],
      };
    }
  }

  // Path (b): detected holes on a shared axis.
  for (const axis of AXIS_LABEL) {
    const ha = primaryHole(partA.holes, axis);
    const hb = primaryHole(partB.holes, axis);
    if (!ha || !hb) continue;
    const dist = Math.hypot(ha.cx - hb.cx, ha.cy - hb.cy);
    const diaDelta = Math.abs(ha.diameter - hb.diameter);
    if (dist <= tolMm && diaDelta <= tolMm * 2) {
      return {
        type: 'concentric',
        reason: `Detected holes on ${axis} axis align at (${ha.cx.toFixed(1)}, ${ha.cy.toFixed(1)}) Ø${ha.diameter.toFixed(1)}.`,
        confidence: 85,
        hint: { axis, x: Number(ha.cx.toFixed(3)), y: Number(ha.cy.toFixed(3)), diameter: Number(((ha.diameter + hb.diameter) / 2).toFixed(3)) },
        blockers: [],
      };
    }
  }
  return null;
}

/**
 * Detect a bolt-pattern alignment. v1 simplification: try each pair
 * (a0 ∈ A.holes, b0 ∈ B.holes) as the anchor; for each anchor pair
 * compute T = a0 - b0 (the translation that would map B onto A), apply
 * to every other B hole, and check that every translated B-hole matches
 * some A-hole within tol. When such a T exists, return it. Multiple
 * candidate pairs may produce the same T; we take the first.
 *
 * Skips when either part has fewer than 2 holes (a single hole would
 * be handled by `concentric` already).
 */
function holePatternSuggestion(
  partA: PartFingerprint,
  partB: PartFingerprint,
  tolMm: number,
): SuggestedMate | null {
  if (!partA.holes || !partB.holes) return null;
  if (partA.holes.length < 2 || partB.holes.length < 2) return null;
  // Group by axis — only patterns sharing the same axis count.
  for (const axis of AXIS_LABEL) {
    const aOn = partA.holes.filter(h => h.axis === axis);
    const bOn = partB.holes.filter(h => h.axis === axis);
    if (aOn.length < 2 || bOn.length < 2) continue;
    if (aOn.length !== bOn.length) continue; // v1: sets must match in count

    // Try each candidate anchor in A vs each in B.
    for (const aAnchor of aOn) {
      for (const bAnchor of bOn) {
        const tx = aAnchor.cx - bAnchor.cx;
        const ty = aAnchor.cy - bAnchor.cy;
        // Verify every other B hole maps onto an A hole within tol.
        const matched = new Set<number>();
        let allMatched = true;
        for (const bh of bOn) {
          const sx = bh.cx + tx;
          const sy = bh.cy + ty;
          let foundIdx = -1;
          for (let ai = 0; ai < aOn.length; ai++) {
            if (matched.has(ai)) continue;
            const ah = aOn[ai]!;
            if (Math.hypot(ah.cx - sx, ah.cy - sy) <= tolMm
              && Math.abs(ah.diameter - bh.diameter) <= tolMm * 2) {
              foundIdx = ai; break;
            }
          }
          if (foundIdx < 0) { allMatched = false; break; }
          matched.add(foundIdx);
        }
        if (allMatched) {
          // Build the 3D translation vector — axis-perpendicular plane
          // maps to world coords per the perpAxes convention in
          // faceInspection. For Z-axis holes (cx, cy) = (worldX, worldY).
          const tVec: [number, number, number] = axis === 'z'
            ? [tx, ty, 0]
            : axis === 'x'
              ? [0, tx, ty]
              : [tx, 0, ty];
          return {
            type: 'hole_pattern_align',
            reason: `${aOn.length}-hole pattern on ${axis} axis aligns under translation (${tx.toFixed(1)}, ${ty.toFixed(1)}).`,
            confidence: 90,
            hint: { axis, translationMm: tVec, holeCount: aOn.length },
            blockers: [],
          };
        }
      }
    }
  }
  // Pattern was checked but no translation worked — surface a blocker.
  return {
    type: 'hole_pattern_align',
    reason: 'Hole sets do not align under any single translation.',
    confidence: 0,
    hint: { aHoleCount: partA.holes.length, bHoleCount: partB.holes.length },
    blockers: ['hole sets do not align under any single translation'],
  };
}

/**
 * Detect a "stacked cylinders" axis alignment. When both parts are
 * cylindrical primitives, their XY centers match within tol, and their
 * Z extents are adjacent (stacked), suggest axis_align as an alternative
 * (or complement) to face_touch.
 */
function axisAlignSuggestion(
  partA: PartFingerprint,
  partB: PartFingerprint,
  tolMm: number,
): SuggestedMate | null {
  const aIsCyl = CYLINDRICAL_SHAPES.has(partA.intent.shapeId);
  const bIsCyl = CYLINDRICAL_SHAPES.has(partB.intent.shapeId);
  if (!aIsCyl || !bIsCyl) return null;
  const ax = axisExtent(partA.bbox, 0).center;
  const ay = axisExtent(partA.bbox, 1).center;
  const bx = axisExtent(partB.bbox, 0).center;
  const by = axisExtent(partB.bbox, 1).center;
  if (Math.hypot(ax - bx, ay - by) > tolMm) return null;
  const az = axisExtent(partA.bbox, 2);
  const bz = axisExtent(partB.bbox, 2);
  // Stacked = one's max is near the other's min (gap small relative to
  // either extent size).
  const stackedAB = Math.abs(bz.min - az.max) <= Math.max(tolMm, 0.5);
  const stackedBA = Math.abs(az.min - bz.max) <= Math.max(tolMm, 0.5);
  if (!stackedAB && !stackedBA) return null;
  const ap = (partA.intent.params ?? {}) as Record<string, number>;
  const bp = (partB.intent.params ?? {}) as Record<string, number>;
  const aDia = ap.diameter ?? ap.outerDiameter ?? az.size;
  const bDia = bp.diameter ?? bp.outerDiameter ?? bz.size;
  return {
    type: 'axis_align',
    reason: `Stacked cylinders share Z axis at (${ax.toFixed(1)}, ${ay.toFixed(1)}).`,
    confidence: 70,
    hint: { axis: 'z', shaftDiameter: Number(Math.max(aDia, bDia).toFixed(3)) },
    blockers: [],
  };
}

/**
 * Detect a mirror relationship: same shapeId, same dominant params,
 * and the relative position is a pure negation along exactly one axis.
 */
function mirrorSuggestion(
  partA: PartFingerprint,
  partB: PartFingerprint,
  relativePositionMm: [number, number, number] | undefined,
  tolMm: number,
): SuggestedMate | null {
  if (!relativePositionMm) return null;
  if (partA.intent.shapeId !== partB.intent.shapeId) return null;
  // Check param parity for the common dimensions.
  const ap = (partA.intent.params ?? {}) as Record<string, number>;
  const bp = (partB.intent.params ?? {}) as Record<string, number>;
  const keys = new Set([...Object.keys(ap), ...Object.keys(bp)]);
  for (const k of keys) {
    const va = ap[k];
    const vb = bp[k];
    if (typeof va !== 'number' || typeof vb !== 'number') continue;
    if (Math.abs(va - vb) > tolMm) return null;
  }
  // Position must be (±X, 0, 0) or (0, ±Y, 0) or (0, 0, ±Z) within tol.
  const [rx, ry, rz] = relativePositionMm;
  const nonZero: number[] = [];
  const nzAxes: Array<'x' | 'y' | 'z'> = [];
  if (Math.abs(rx) > tolMm) { nonZero.push(rx); nzAxes.push('x'); }
  if (Math.abs(ry) > tolMm) { nonZero.push(ry); nzAxes.push('y'); }
  if (Math.abs(rz) > tolMm) { nonZero.push(rz); nzAxes.push('z'); }
  if (nonZero.length !== 1) return null;
  return {
    type: 'mirror',
    reason: `partB is partA mirrored across the ${nzAxes[0]}-axis at offset ${nonZero[0]!.toFixed(1)} mm.`,
    confidence: 60,
    hint: { axis: nzAxes[0]!, offsetMm: Number(nonZero[0]!.toFixed(3)) },
    blockers: [],
  };
}

/**
 * v1 mate suggester. Pure — no mutation, no async. Returns sorted by
 * confidence descending. Categories that fired with blockers (e.g.
 * hole_pattern checked but didn't match) stay in the list so the agent
 * sees diagnostic information instead of silent omission.
 */
export function suggestMatesForPair(opts: SuggestMatesOptions): SuggestedMate[] {
  if (!opts || typeof opts !== 'object') {
    throw new Error('suggestMatesForPair requires { partA, partB }');
  }
  if (!opts.partA || !opts.partB) {
    throw new Error('suggestMatesForPair requires both partA and partB');
  }
  const tolMm = opts.toleranceMm ?? DEFAULT_TOL_MM;
  const results: SuggestedMate[] = [];

  // 1. Face touch / offset — emit one per axis (up to 3 entries).
  results.push(...faceContactSuggestions(opts.partA, opts.partB, tolMm));

  // 2. Concentric.
  const conc = concentricSuggestion(opts.partA, opts.partB, tolMm);
  if (conc) results.push(conc);

  // 3. Hole pattern align.
  const pat = holePatternSuggestion(opts.partA, opts.partB, tolMm);
  if (pat) results.push(pat);

  // 4. Axis align (stacked cylinders).
  const ax = axisAlignSuggestion(opts.partA, opts.partB, tolMm);
  if (ax) results.push(ax);

  // 5. Mirror.
  const mir = mirrorSuggestion(opts.partA, opts.partB, opts.relativePositionMm, tolMm);
  if (mir) results.push(mir);

  // Apply position-confidence bump: when the caller passed a relative
  // position AND the suggestion's hint matches that position, bump
  // confidence by +10 (capped at 100). Drives more agreement when the
  // agent already knows partB's transform.
  if (opts.relativePositionMm) {
    const [rx, ry, rz] = opts.relativePositionMm;
    for (const s of results) {
      const axisHint = s.hint.axis;
      if (typeof axisHint !== 'string') continue;
      // For face_offset on axis X, bump when relativePosition's X component is non-trivial.
      const idx = axisHint === 'x' ? 0 : axisHint === 'y' ? 1 : 2;
      const r = [rx, ry, rz][idx]!;
      if (s.type === 'face_offset' && Math.abs(r) > 0) {
        s.confidence = Math.min(100, s.confidence + 10);
      }
    }
  }

  // Stable sort by confidence descending. Ties keep insertion order
  // (faceContact then concentric then pattern then axis_align then mirror).
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * Human-readable formatter for tool output. Lists every suggestion with
 * rank + type + confidence + reason + hint; appends blockers when
 * present. Mirrors formatMaterialScores / formatProcessScores so the
 * agent's tool-result rendering stays uniform across the suggester family.
 */
export function formatMateSuggestions(mates: SuggestedMate[]): string {
  if (mates.length === 0) return 'No mate suggestions for this pair.';
  const lines: string[] = [`Mate suggestions (${mates.length}, ranked):`];
  mates.forEach((m, i) => {
    const hintBits: string[] = [];
    for (const [k, v] of Object.entries(m.hint)) {
      if (Array.isArray(v)) hintBits.push(`${k}=[${v.map(x => typeof x === 'number' ? x.toFixed(2) : String(x)).join(', ')}]`);
      else if (typeof v === 'number') hintBits.push(`${k}=${v.toFixed(2)}`);
      else hintBits.push(`${k}=${v}`);
    }
    const hintStr = hintBits.length > 0 ? `  hint: ${hintBits.join(', ')}` : '';
    lines.push(`${i + 1}. ${m.type} (confidence ${m.confidence}): ${m.reason}`);
    if (hintStr) lines.push(`   ${hintStr.trim()}`);
    for (const b of m.blockers) lines.push(`     BLOCKER: ${b}`);
  });
  return lines.join('\n');
}
