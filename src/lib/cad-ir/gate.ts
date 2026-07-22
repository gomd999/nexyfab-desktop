/**
 * gate.ts — reconstruction verification gate (TypeScript port of 참고파일들/result/tools/gate.py).
 *
 * Given a candidate reconstruction as a triangle mesh and the source IR, measure the mesh
 * (bbox / volume / watertight / genus) and compare it against the IR. Accept ONLY on pass.
 *
 * The gate's value is not its pass rate but that it catches hallucinated reconstructions —
 * an LLM emits a plausible-but-wrong shape instead of saying "I don't know". Per
 * LLM_METHODOLOGY.md the operative metric is the count of WRONG reconstructions caught,
 * not a score. This gate is built to catch, at minimum:
 *   - axis flip     → per-axis bbox fails while sorted-axis matches (bbox_sorted)
 *   - missing hole  → genus below the IR's hole count
 *   - invented hole → genus above the IR's hole count (genus_max)
 *   - empty verify  → nothing compared → evidence_sufficient fails (never rubber-stamp)
 *
 * Design principles (from gate.py):
 *   1. Never pass on absent evidence. No IR volume → volume check is `skipped`, out of scoring.
 *   2. Units unknown (STL-derived) → don't widen absolute tolerance; substitute aspect ratios.
 *   3. A false negative (wrong passed) is worse than a false positive. Undecidable → skipped or fail.
 */

import type { Ir, Vec3 } from './schema';
import { unitsKnown } from './schema';
import type { IndexedMesh, MeshMeasurement, TriangleSoup } from './meshAnalysis';
import { analyzeIndexed, analyzeTriangles } from './meshAnalysis';

// Tolerances (%)
const TOL_BBOX_PCT = 2.0; // absolute dims (declared units only)
const TOL_ASPECT_PCT = 3.0; // aspect ratio (units-unknown substitute)
const TOL_VOLUME_PCT = 5.0; // measured mesh volume
const TOL_FILL_WEAK_PCT = 25.0; // b-rep weak fill-ratio fallback

const WEIGHTS: Record<string, number> = {
  bbox_x: 1.0, bbox_y: 1.0, bbox_z: 1.0, bbox_sorted: 1.0,
  aspect_ratio_1: 1.0, aspect_ratio_2: 1.0,
  volume: 2.0, volume_fill_plausible_weak: 0.3,
  genus: 2.0, genus_max: 1.0, watertight: 1.5, body_count: 0.5,
};

/** Advisory checks fail informationally — they never by themselves drop the gate. */
const ADVISORY = new Set(['volume_fill_plausible_weak', 'body_count']);

const MIN_SCORE_TO_PASS = 0.85;

export interface GateCheck {
  name: string;
  expected: unknown;
  actual: unknown;
  tol_pct: number | null;
  delta_pct: number | null;
  /** true=pass, false=fail, null=skipped (not counted either way). */
  passed: boolean | null;
  status?: 'skipped' | 'error';
  reason?: string;
  note?: string;
  advisory?: boolean;
  breakdown?: Record<string, unknown>;
}

export interface GateResult {
  passed: boolean;
  stage: 'render' | 'compare' | 'ok';
  score: number;
  checks: GateCheck[];
  render: {
    ok: boolean;
    triangles: number | null;
    watertight: boolean | null;
    genus: number | null;
    volume: number | null;
    extents: Vec3 | null;
    bodyCount: number | null;
    nonManifold: boolean | null;
    error: string | null;
  };
  feedback: string;
}

/** Candidate accepted as an indexed mesh, a triangle soup, or a pre-computed measurement. */
export type Candidate =
  | { kind: 'mesh'; mesh: IndexedMesh }
  | { kind: 'triangles'; triangles: TriangleSoup }
  | { kind: 'measurement'; measurement: MeshMeasurement };

function measure(candidate: Candidate): MeshMeasurement {
  if (candidate.kind === 'measurement') return candidate.measurement;
  if (candidate.kind === 'triangles') return analyzeTriangles(candidate.triangles);
  return analyzeIndexed(candidate.mesh);
}

function pctDelta(expected: number | null, actual: number | null): number {
  if (expected === null || actual === null) return Infinity;
  if (Math.abs(expected) < 1e-9) return Math.abs(actual) < 1e-9 ? 0 : Infinity;
  return (Math.abs(actual - expected) / Math.abs(expected)) * 100;
}

function mk(
  name: string,
  expected: unknown,
  actual: unknown,
  tol: number | null,
  delta: number | null,
  passed: boolean,
  extra: Partial<GateCheck> = {},
): GateCheck {
  return {
    name,
    expected,
    actual,
    tol_pct: tol,
    delta_pct: delta === null || !Number.isFinite(delta) ? null : Math.round(delta * 1000) / 1000,
    passed,
    ...extra,
  };
}

function skipped(name: string, reason: string, expected: unknown = null): GateCheck {
  return { name, expected, actual: null, tol_pct: null, delta_pct: null, passed: null, status: 'skipped', reason };
}

function numCheck(name: string, expected: number, actual: number, tol: number, extra: Partial<GateCheck> = {}): GateCheck {
  const d = pctDelta(expected, actual);
  return mk(name, expected, actual, tol, d, d <= tol, extra);
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

// ─────────────────────────────────────────────────────────────────────────────
// Expected through-hole count from IR (port of gate.py `_expected_holes`).
// ─────────────────────────────────────────────────────────────────────────────
interface HoleInfo {
  total: number;
  patternTotal: number;
  singles: number;
  throughKnown: boolean;
  throughTotal: number | null;
  hasAny: boolean;
}

const ELEM_D = /hole_d([0-9]*\.?[0-9]+)/;
const int1 = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

function axisThickness(axis: Vec3 | null, size: Vec3 | null): number | null {
  if (!axis || !size) return null;
  return axis.reduce((acc, a, i) => acc + Math.abs(a) * Math.abs(size[i]), 0);
}

function expectedHoles(ir: Ir): HoleInfo {
  const feats = ir.features;
  const size = ir.extent?.size ?? null;
  const holes = feats?.holes ?? [];
  const patterns = feats?.patterns ?? [];

  const patD: { d: number | null; n: number }[] = [];
  let patternTotal = 0;
  for (const p of patterns) {
    const n = int1(p.count);
    patternTotal += n;
    const m = ELEM_D.exec(String(p.element ?? ''));
    patD.push({ d: m ? parseFloat(m[1]) : null, n });
  }
  const matchesPattern = (d: number | null): boolean => {
    if (d === null) return false;
    return patD.some((p) => p.d !== null && Math.abs(p.d - d) <= Math.max(0.05, 0.02 * d));
  };
  const throughState = (h: (typeof holes)[number]): boolean | null => {
    if (h.through !== null) return h.through;
    const thick = axisThickness(h.axis, size);
    if (h.depth === null || !thick) return null;
    return h.depth >= 0.95 * thick;
  };

  let extra = 0;
  const states: (boolean | null)[] = [];
  for (const h of holes) {
    if (matchesPattern(h.diameter)) continue; // already counted in a pattern
    const n = int1(h.count_in_pattern);
    extra += n;
    for (let i = 0; i < n; i++) states.push(throughState(h));
  }
  const total = patternTotal + extra;
  const throughKnown = states.length > 0 && states.every((s) => s !== null);
  const throughTotal = throughKnown ? states.filter(Boolean).length : null;

  return {
    total,
    patternTotal,
    singles: extra,
    throughKnown,
    throughTotal,
    hasAny: holes.length > 0 || patterns.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry.
// ─────────────────────────────────────────────────────────────────────────────
export function verifyReconstruction(candidate: Candidate, ir: Ir): GateResult {
  const meas = measure(candidate);

  const render: GateResult['render'] = {
    ok: meas.ok,
    triangles: meas.triangles,
    watertight: meas.watertight,
    genus: meas.genus,
    volume: meas.volume,
    extents: meas.extents,
    bodyCount: meas.bodyCount,
    nonManifold: meas.nonManifold,
    error: meas.error,
  };

  // ── render stage: no measurable geometry ──
  if (!meas.ok || !meas.extents) {
    const checks = [mk('render', 'measurable mesh', 'empty', null, null, false, { reason: meas.error ?? 'no geometry' })];
    return {
      passed: false,
      stage: 'render',
      score: 0,
      checks,
      render,
      feedback: `Render produced no measurable geometry: ${meas.error ?? 'empty mesh'}. The candidate reconstruction is empty — check that the top-level solid is actually emitted.`,
    };
  }

  const checks: GateCheck[] = [];
  const expSize = ir.extent?.size ?? null;
  const actSize = meas.extents;
  const known = unitsKnown(ir);

  // ── 3a) dimensions ──
  let axisPermuted = false;
  if (!expSize) {
    checks.push(skipped('bbox_x', 'IR has no extent.size'));
    checks.push(skipped('bbox_sorted', 'IR has no extent.size'));
  } else if (known) {
    const names = ['bbox_x', 'bbox_y', 'bbox_z'];
    for (let i = 0; i < 3; i++) checks.push(numCheck(names[i], round4(expSize[i]), round4(actSize[i]), TOL_BBOX_PCT));
    const es = [...expSize].map(Number).sort((a, b) => a - b);
    const as = [...actSize].map(Number).sort((a, b) => a - b);
    const worst = Math.max(...es.map((e, i) => pctDelta(e, as[i])));
    checks.push(
      mk('bbox_sorted', es.map(round4), as.map(round4), TOL_BBOX_PCT, worst, worst <= TOL_BBOX_PCT, {
        note: 'sorted 3-axis lengths — separates an axis permutation from a genuine dimension miss',
      }),
    );
    const perAxisOk = checks.filter((c) => c.name.startsWith('bbox_') && c.name !== 'bbox_sorted').every((c) => c.passed);
    const sortedOk = checks[checks.length - 1].passed === true;
    axisPermuted = sortedOk && !perAxisOk;
  } else {
    checks.push(skipped('bbox_x', 'units unknown — absolute dims not compared; aspect ratio substituted', expSize.map(round4)));
    checks.push(skipped('bbox_y', 'units unknown — aspect substituted'));
    checks.push(skipped('bbox_z', 'units unknown — aspect substituted'));
    checks.push(skipped('bbox_sorted', 'units unknown — aspect substituted'));
    const es = [...expSize].map(Number).sort((a, b) => b - a);
    const as = [...actSize].map(Number).sort((a, b) => b - a);
    for (const k of [1, 2]) {
      if (es[k] < 1e-9 || as[k] < 1e-9) {
        checks.push(skipped(`aspect_ratio_${k}`, 'zero-length axis — ratio undefined'));
        continue;
      }
      checks.push(
        numCheck(`aspect_ratio_${k}`, round4(es[0] / es[k]), round4(as[0] / as[k]), TOL_ASPECT_PCT, {
          note: 'units unknown → longest-axis / k-th-axis ratio instead of absolute dimension',
        }),
      );
    }
  }

  // ── 3b) volume ──
  const irVolume = ir.mesh?.volume_mm3 ?? null;
  if (irVolume !== null && meas.volume !== null) {
    checks.push(
      numCheck('volume', round4(irVolume), round4(meas.volume), TOL_VOLUME_PCT, known ? {} : { note: 'units unknown — native-unit-equal assumption' }),
    );
  } else if (irVolume !== null && meas.volume === null) {
    checks.push(skipped('volume', 'render not closed — volume untrustworthy', round4(irVolume)));
  } else {
    checks.push(skipped('volume', 'IR has no measured volume (b-rep). Not passed on absent evidence — excluded from score'));
    if (meas.volume !== null && expSize) {
      const bboxVol = expSize[0] * expSize[1] * expSize[2];
      if (bboxVol > 1e-9) {
        const fill = meas.volume / bboxVol;
        const ok = fill >= 0.05 && fill <= 1.0;
        checks.push(
          mk('volume_fill_plausible_weak', '0.05~1.00 (fill vs bbox)', round4(fill), TOL_FILL_WEAK_PCT, ok ? 0 : Math.max(pctDelta(1.0, fill), pctDelta(0.05, fill)), ok, {
            advisory: true,
            note: 'source volume unknown → weak check: only catches a shell or a bbox overflow. Weight 0.3, never drops the gate alone',
          }),
        );
      }
    }
  }

  // ── 3c) holes / genus ──
  const holeInfo = expectedHoles(ir);
  const actGenus = meas.genus;
  if (!holeInfo.hasAny) {
    checks.push(skipped('genus', 'IR has no holes/patterns'));
    checks.push(skipped('genus_max', 'IR has no holes/patterns'));
  } else if (actGenus === null || !meas.watertight) {
    checks.push(skipped('genus', 'render not closed — genus invalid', holeInfo.total));
    checks.push(skipped('genus_max', 'render not closed — genus invalid'));
  } else {
    const expG = holeInfo.throughKnown ? (holeInfo.throughTotal as number) : holeInfo.total;
    const note = holeInfo.throughKnown
      ? 'IR through-flag gives exact through-hole count — strict compare'
      : 'IR has no through-flag → assume all holes are through. Blind holes cannot be judged → fail not pass';
    checks.push(
      mk('genus', expG, actGenus, null, pctDelta(expG, actGenus), actGenus === expG, {
        note,
        breakdown: { pattern_total: holeInfo.patternTotal, singles: holeInfo.singles },
      }),
    );
    checks.push(
      mk('genus_max', `<= ${holeInfo.total}`, actGenus, null, actGenus <= holeInfo.total ? 0 : pctDelta(holeInfo.total, actGenus), actGenus <= holeInfo.total, {
        note: 'catches an invented hole not present in IR',
      }),
    );
  }

  // ── 3d) watertight ──
  checks.push(
    mk('watertight', true, meas.watertight, null, meas.watertight ? 0 : 100, meas.watertight, {
      note: 'a non-closed solid is not a manufacturable shape',
    }),
  );

  // ── 3e) body count (advisory) ──
  const expSolids = ir.topology?.solids ?? null;
  if (expSolids) {
    const bc = meas.bodyCount || 1;
    checks.push(
      mk('body_count', expSolids, bc, null, pctDelta(expSolids, bc), bc === expSolids, {
        advisory: true,
        note: 'informational — CSG union can fuse bodies; not a standalone fail reason',
      }),
    );
  }

  // ── 4) evidence sufficiency: if no dimension check ran, the gate verified nothing ──
  const dimNames = new Set(['bbox_x', 'bbox_y', 'bbox_z', 'bbox_sorted', 'aspect_ratio_1', 'aspect_ratio_2']);
  const dimDone = checks.filter((c) => dimNames.has(c.name) && c.passed !== null);
  if (dimDone.length === 0) {
    checks.push(
      mk('evidence_sufficient', '>=1 dimension check', '0 evidence checks', null, null, false, {
        reason: 'IR has no extent.size — no dimensional comparison possible. Nothing verified → not passed.',
      }),
    );
  }

  // ── 5) score & verdict ──
  let num = 0;
  let den = 0;
  for (const c of checks) {
    if (c.passed === null) continue; // skipped → out of numerator and denominator
    const w = WEIGHTS[c.name] ?? 0.5;
    den += w;
    if (c.passed) num += w;
  }
  const score = den > 0 ? Math.round((num / den) * 1e4) / 1e4 : 0;
  const hardFails = checks.filter((c) => c.passed === false && !ADVISORY.has(c.name));
  const passed = hardFails.length === 0 && score >= MIN_SCORE_TO_PASS;

  return {
    passed,
    stage: passed ? 'ok' : 'compare',
    score,
    checks,
    render,
    feedback: buildFeedback(passed, checks, ir, axisPermuted, score),
  };
}

function get(checks: GateCheck[], name: string): GateCheck | undefined {
  return checks.find((c) => c.name === name);
}

function buildFeedback(passed: boolean, checks: GateCheck[], ir: Ir, axisPermuted: boolean, score: number): string {
  const lines: string[] = [];
  const skips = checks.filter((c) => c.passed === null);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  if (passed) {
    lines.push(`PASS. Overall match ${pct(score)}.`);
    for (const c of checks) {
      if (c.passed && c.delta_pct !== null && c.name.startsWith('bbox_') && c.name !== 'bbox_sorted') {
        lines.push(`- ${c.name}: expected ${c.expected} / measured ${c.actual} (err ${c.delta_pct}%)`);
      }
    }
    const g = get(checks, 'genus');
    if (g?.passed) lines.push(`- through-hole count ${g.actual} matches IR expectation.`);
    if (skips.length) lines.push('Not verified (insufficient evidence, not counted as pass): ' + skips.map((c) => `${c.name}(${c.reason ?? ''})`).join(', '));
    return lines.join('\n');
  }

  lines.push(`MISMATCH. Overall match ${pct(score)}. Fix the numbers below and regenerate.`);

  if (axisPermuted) {
    const bs = get(checks, 'bbox_sorted');
    const holeAxis = ir.features?.holes?.[0]?.axis ?? null;
    lines.push(
      `■ Axis permutation: sorted 3-axis lengths match (${JSON.stringify(bs?.expected)} vs ${JSON.stringify(bs?.actual)}, err ${bs?.delta_pct}%). ` +
        `Dimensions are right but axes are swapped. IR extent.size is ${JSON.stringify(ir.extent?.size)}; primary hole axis is ${JSON.stringify(holeAxis)}. Rotate the shape to that axis.`,
    );
  } else {
    for (const [nm, ax] of [['bbox_x', 'X'], ['bbox_y', 'Y'], ['bbox_z', 'Z']] as const) {
      const c = get(checks, nm);
      if (c && c.passed === false) {
        const e = c.expected as number;
        const a = c.actual as number;
        lines.push(`■ ${ax} length ${a} (expected ${e}) — ${c.delta_pct}% ${a > e ? 'too large' : 'too small'}. Tolerance ${c.tol_pct}%. Correct by ${round4(Math.abs(a - e))} units.`);
      }
    }
  }
  for (const k of [1, 2]) {
    const c = get(checks, `aspect_ratio_${k}`);
    if (c && c.passed === false) lines.push(`■ Aspect ratio (longest/${k + 1}th) ${c.actual} (expected ${c.expected}) — off ${c.delta_pct}%. Units unknown so only the ratio is checked.`);
  }

  const v = get(checks, 'volume');
  if (v && v.passed === false) {
    const e = v.expected as number;
    const a = v.actual as number;
    lines.push(`■ Volume ${a} is ${e ? Math.round((a / e) * 1000) / 10 : 0}% of expected ${e} (err ${v.delta_pct}%, tol ${v.tol_pct}%). ` + (a > e ? 'Material left over — a hole/pocket is missing or not through. Make the cut cylinder taller than the plate and straddle it.' : 'Material short — hole diameter too large or body under-filled.'));
  }

  const g = get(checks, 'genus');
  if (g && g.passed === false) {
    const e = g.expected as number;
    const a = g.actual as number;
    const bd = g.breakdown ?? {};
    lines.push(`■ Through-hole count (genus) is ${a}. IR expects ${e} (pattern ${bd.pattern_total} + singles ${bd.singles}).`);
    if (a < e) lines.push(`  → ${e - a} missing. Ensure every pattern is applied and each hole fully pierces the plate (±0.1 height margin).`);
    else lines.push(`  → ${a - e} extra. You invented a hole not in the IR, or holes overlapped and changed the topology.`);
    for (const p of ir.features?.patterns ?? []) lines.push(`    · ${p.kind} pattern ${p.count}, axis ${JSON.stringify(p.axis)}, radius ${p.radius}, start ${p.start_angle_deg}°, element ${p.element}`);
  }

  const gm = get(checks, 'genus_max');
  if (gm && gm.passed === false) lines.push(`■ Hole count exceeds IR upper bound ${gm.expected} (measured ${gm.actual}). A feature was invented.`);

  const w = get(checks, 'watertight');
  if (w && w.passed === false) lines.push('■ Not a closed solid (non-watertight). Coplanar faces or zero-thickness. Make subtractive cylinders/cubes clearly larger (+0.1 each side) to avoid coplanar contact.');

  const bcCheck = get(checks, 'body_count');
  if (bcCheck && bcCheck.passed === false) lines.push(`■ (info) ${bcCheck.actual} solid bodies; IR has ${bcCheck.expected}. Check for a detached piece. Not a standalone fail.`);

  const ev = get(checks, 'evidence_sufficient');
  if (ev && ev.passed === false) lines.push('■ Nothing to compare against (no extent.size). The gate verified nothing so it does not pass. This is an IR/routing problem, not a code problem — check layer-1 extraction, do not just retry.');

  if (skips.length) lines.push('Left unverified (not counted as pass): ' + skips.map((c) => `${c.name}(${c.reason ?? ''})`).join(', '));
  return lines.join('\n');
}
