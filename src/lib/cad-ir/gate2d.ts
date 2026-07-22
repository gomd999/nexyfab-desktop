/**
 * gate2d.ts — 2D drawing verification gate (DWG-2D initiative).
 *
 * The 3D gate (gate.ts) judges a solid: bbox / genus / watertight / volume. Those are meaningless for
 * a 2D drawing. `verify2dReconstruction` compares a CANDIDATE interpretation against the SOURCE
 * drawing's own 2D evidence: dimension VALUES, circle RADII, entity counts by type, drawing extents,
 * and layers. Per LLM_METHODOLOGY.md the operative metric is the COUNT of mismatches (things caught
 * wrong), not a smoothed score — the score is informational for the UI badge only.
 *
 * Honesty rules (mirrors gate.ts):
 *   1. No evidence -> `unavailable`, never a fabricated pass. If the source has no dimensions, no
 *      circles and no extents, there is nothing to verify; we say so with a reason.
 *   2. Never hide a loss. A dimension the candidate dropped, a circle it invented, an entity type it
 *      failed to reproduce (spline->polyline approximation, tessellated arc, expanded block) — each is
 *      a surfaced, counted mismatch, not a silent truncation.
 *   3. A wrong PASS is worse than a wrong FAIL. Any hard-check mismatch -> `fail`.
 *
 * Hard checks (drive pass/fail, each mismatch counted):
 *   - dimensions   : multiset of measured values within tolerance
 *   - circles      : multiset of radii within tolerance
 *   - extents      : width & height within tolerance
 *   - entity counts: per DXF type (catches a dropped/invented/unmodeled entity)
 * Advisory (surfaced + counted separately, never the sole fail reason):
 *   - layers       : source layer names present in the candidate
 */

import type { Ir2d } from './schema2d';
import { ir2dHasEvidence } from './schema2d';

const TOL_PCT = 1.0; // relative tolerance for dimension/circle/extent values
const ABS_EPS = 0.01; // absolute floor so near-zero and rounding noise don't false-fail

export interface Gate2dCheck {
  name: string;
  expected: unknown;
  actual: unknown;
  /** true=match, false=mismatch. */
  passed: boolean;
  /** worst relative error (%) where meaningful, else null. */
  delta_pct: number | null;
  advisory?: boolean;
  note?: string;
}

export interface Gate2dResult {
  status: 'pass' | 'fail' | 'unavailable';
  /** informational only (1 - mismatches/checks); the verdict is mismatch-count driven. */
  score: number;
  /** number of HARD-check mismatches — the operative metric. */
  mismatches: number;
  checks: Gate2dCheck[];
  feedback: string;
  /** set when status==='unavailable'. */
  reason?: string;
}

function within(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(ABS_EPS, (TOL_PCT / 100) * Math.abs(b));
}

/** Greedy tolerant multiset match. Returns unmatched source values (missing) and leftover candidate values (extra). */
function matchMultiset(source: number[], candidate: number[]): { missing: number[]; extra: number[] } {
  const src = [...source].sort((a, b) => a - b);
  const cand = [...candidate].sort((a, b) => a - b);
  const used = new Array(cand.length).fill(false);
  const missing: number[] = [];
  for (const s of src) {
    let bestIdx = -1;
    let bestErr = Infinity;
    for (let i = 0; i < cand.length; i++) {
      if (used[i]) continue;
      if (!within(cand[i], s)) continue;
      const err = Math.abs(cand[i] - s);
      if (err < bestErr) { bestErr = err; bestIdx = i; }
    }
    if (bestIdx >= 0) used[bestIdx] = true;
    else missing.push(s);
  }
  const extra = cand.filter((_, i) => !used[i]);
  return { missing, extra };
}

function pct(exp: number, act: number): number {
  if (Math.abs(exp) < 1e-9) return Math.abs(act) < 1e-9 ? 0 : 100;
  return Math.round((Math.abs(act - exp) / Math.abs(exp)) * 100 * 1000) / 1000;
}

/**
 * Verify a candidate 2D interpretation against the source drawing's evidence.
 * @param candidate the interpretation to check (e.g. our re-emitted round-trip, or an LLM reading)
 * @param source    the ground-truth evidence extracted from the drawing
 */
export function verify2dReconstruction(candidate: Ir2d, source: Ir2d): Gate2dResult {
  // ── honesty rule #1: no evidence -> unavailable ──
  if (!ir2dHasEvidence(source)) {
    const reason = 'source drawing has no measurable 2D evidence (no dimensions, circles or extents) — nothing to verify';
    return {
      status: 'unavailable',
      score: 0,
      mismatches: 0,
      checks: [],
      reason,
      feedback: `UNAVAILABLE. ${reason}. This is not a pass — a drawing with only free lines/text carries no values to check. Add dimensioned geometry, or verify a different way.`,
    };
  }

  const checks: Gate2dCheck[] = [];

  // ── dimensions (multiset of measured values) ──
  const srcDims = source.dimensions.map((d) => d.value);
  const candDims = candidate.dimensions.map((d) => d.value);
  const dimM = matchMultiset(srcDims, candDims);
  checks.push({
    name: 'dimensions',
    expected: srcDims,
    actual: candDims,
    passed: dimM.missing.length === 0 && dimM.extra.length === 0,
    delta_pct: null,
    note: dimM.missing.length || dimM.extra.length
      ? `missing ${JSON.stringify(dimM.missing)} / invented ${JSON.stringify(dimM.extra)} (tol ${TOL_PCT}%)`
      : `all ${srcDims.length} dimension value(s) matched within ${TOL_PCT}%`,
  });

  // ── circle radii (multiset) ──
  const srcR = source.circles.map((c) => c.r);
  const candR = candidate.circles.map((c) => c.r);
  const rM = matchMultiset(srcR, candR);
  checks.push({
    name: 'circle_radii',
    expected: srcR,
    actual: candR,
    passed: rM.missing.length === 0 && rM.extra.length === 0,
    delta_pct: null,
    note: rM.missing.length || rM.extra.length
      ? `missing r ${JSON.stringify(rM.missing)} / invented r ${JSON.stringify(rM.extra)} (tol ${TOL_PCT}%)`
      : `all ${srcR.length} circle radius(es) matched within ${TOL_PCT}%`,
  });

  // ── extents (w & h) ──
  if (source.extents) {
    if (!candidate.extents) {
      checks.push({ name: 'extents', expected: source.extents, actual: null, passed: false, delta_pct: 100, note: 'candidate has no extents' });
    } else {
      const dw = pct(source.extents.w, candidate.extents.w);
      const dh = pct(source.extents.h, candidate.extents.h);
      const ok = within(candidate.extents.w, source.extents.w) && within(candidate.extents.h, source.extents.h);
      checks.push({
        name: 'extents',
        expected: source.extents,
        actual: candidate.extents,
        passed: ok,
        delta_pct: Math.max(dw, dh),
        note: ok ? `w/h within ${TOL_PCT}%` : `w err ${dw}% / h err ${dh}% (tol ${TOL_PCT}%)`,
      });
    }
  }

  // ── entity counts per type (catches dropped / invented / unmodeled entities) ──
  const types = [...new Set([...Object.keys(source.entityCounts), ...Object.keys(candidate.entityCounts)])].sort();
  const countDiffs: string[] = [];
  for (const t of types) {
    const es = source.entityCounts[t] ?? 0;
    const as = candidate.entityCounts[t] ?? 0;
    if (es !== as) countDiffs.push(`${t}: ${es} vs ${as}`);
  }
  checks.push({
    name: 'entity_counts',
    expected: source.entityCounts,
    actual: candidate.entityCounts,
    passed: countDiffs.length === 0,
    delta_pct: null,
    note: countDiffs.length ? `type-count differences: ${countDiffs.join(', ')}` : `all ${types.length} entity type count(s) matched`,
  });

  // ── layers presence (advisory) ──
  const missingLayers = source.layers.filter((l) => !candidate.layers.includes(l));
  checks.push({
    name: 'layers',
    expected: source.layers,
    actual: candidate.layers,
    passed: missingLayers.length === 0,
    delta_pct: null,
    advisory: true,
    note: missingLayers.length ? `layers not carried through: ${missingLayers.join(', ')}` : `all ${source.layers.length} layer(s) present`,
  });

  const hardFails = checks.filter((c) => !c.advisory && !c.passed);
  const mismatches = hardFails.length;
  const status: Gate2dResult['status'] = mismatches === 0 ? 'pass' : 'fail';
  const score = Math.max(0, Math.round((1 - mismatches / checks.filter((c) => !c.advisory).length) * 1000) / 1000);

  return { status, score, mismatches, checks, feedback: buildFeedback(status, score, checks, candidate) };
}

function get(checks: Gate2dCheck[], name: string): Gate2dCheck | undefined {
  return checks.find((c) => c.name === name);
}

function buildFeedback(status: Gate2dResult['status'], score: number, checks: Gate2dCheck[], candidate: Ir2d): string {
  const lines: string[] = [];
  const scorePct = `${Math.round(score * 100)}%`;
  if (status === 'pass') {
    lines.push(`PASS. 2D evidence match ${scorePct} — no hard mismatch.`);
    for (const c of checks) if (!c.advisory) lines.push(`- ${c.name}: ${c.note}`);
    const adv = checks.filter((c) => c.advisory && !c.passed);
    if (adv.length) lines.push('Advisory (surfaced, not a fail): ' + adv.map((c) => `${c.name} — ${c.note}`).join('; '));
    if (candidate.approximations.length) lines.push('Approximations recorded (not hidden): ' + candidate.approximations.join('; '));
    return lines.join('\n');
  }
  lines.push(`MISMATCH. 2D evidence match ${scorePct}. The interpretation disagrees with the drawing's own values below.`);
  const d = get(checks, 'dimensions');
  if (d && !d.passed) lines.push(`■ Dimension values differ — ${d.note}. These are code-42 measured values; a wrong number here is a misread, not a rounding artifact.`);
  const r = get(checks, 'circle_radii');
  if (r && !r.passed) lines.push(`■ Circle radii differ — ${r.note}. A missing radius = a hole/bore we failed to read; an invented one = a circle not in the drawing.`);
  const ex = get(checks, 'extents');
  if (ex && !ex.passed) lines.push(`■ Drawing extents differ — ${ex.note}. The interpreted sheet is a different size than the source geometry spans.`);
  const ec = get(checks, 'entity_counts');
  if (ec && !ec.passed) lines.push(`■ Entity-type counts differ — ${ec.note}. Differences on non-modeled types (SPLINE/ARC/TEXT/INSERT) mean our 2D model does not fully reproduce that geometry — surfaced, not hidden.`);
  const ly = get(checks, 'layers');
  if (ly && !ly.passed) lines.push(`■ (advisory) ${ly.note}.`);
  if (candidate.approximations.length) lines.push('Approximations recorded (not hidden): ' + candidate.approximations.join('; '));
  return lines.join('\n');
}
