/**
 * processSelection.ts — Track G: heuristic AI process selector.
 *
 * Given an IntentInput (+ optional measured stats from verify_spec and
 * user hints about material/quantity), score each manufacturing process
 * and return a ranked list with blockers/warnings. The agent calls this
 * BEFORE add_feature_intent when the user hasn't specified a process —
 * it gives them an informed choice instead of defaulting to whatever
 * the prompt-fast-path picks.
 *
 * v1 is pure heuristic — each process starts at 50 and applies the rules
 * below. Future v2 will fold in real shop quotes / DFM trace data to
 * learn the right modifiers. Pure / additive — no mutation of intent
 * or session.
 *
 * Score interpretation: 0..100, higher = better fit. A `blockers` entry
 * forces the score to 0 (effectively "do not pick"); `warnings` are soft
 * concerns the user should know about.
 */

import type { IntentInput, IntentFeature } from '../../openscad-render/intentToScad';
import type { ProcessForDfm } from './specVerification';

export interface ProcessScore {
  process: ProcessForDfm;
  /** 0..100, higher = better fit. */
  score: number;
  /** Headline rationale shown to user. */
  reason: string;
  /** Hard blockers (e.g. "Sharp internal corners require radius ≥ 1mm for milling"). */
  blockers: string[];
  /** Soft warnings (e.g. "Long tall part may warp during FDM"). */
  warnings: string[];
}

export interface SuggestProcessOptions {
  intent: IntentInput;
  /** Optional measured stats (from verify_spec run). Improves accuracy. */
  measured?: {
    volumeMm3?: number;
    bboxMm?: { wMm: number; hMm: number; dMm: number };
    minWallMm?: number | null;
    holeCount?: number;
    chamferEdgeCount?: number;
  };
  /** Optional production quantity. Below 100 favors print/CNC, above favors IM/die-cast. */
  quantityHint?: number;
  /** Material preference. Filters processes that can't handle it. */
  materialHint?: 'metal' | 'plastic' | 'any';
  /** Return all 6 processes instead of top 3 (UI "show full table" case). */
  returnAll?: boolean;
}

/** All 6 processes the v1 selector considers. */
const ALL_PROCESSES: ProcessForDfm[] = ['cnc_mill', 'fdm', 'sla', 'sheet', 'injection_molding', 'die_cast'];

/** Default headline rationales by process — appended/overridden per match. */
const DEFAULT_REASON: Record<ProcessForDfm, string> = {
  cnc_mill: 'Subtractive metal/plastic milling; good tolerances, slower per-part.',
  fdm: 'Fused deposition 3D printing; cheap one-offs in plastic.',
  sla: 'Resin print; smoother surface than FDM, smaller build volume.',
  sheet: 'Laser-cut + brake-formed flat stock; ideal for plate/enclosure parts.',
  injection_molding: 'High-volume plastic; tooling cost amortizes past ~1k units.',
  die_cast: 'High-volume metal (Al/Zn/Mg); tooling cost amortizes past ~5k units.',
};

/** Helper: read the intent's bbox max dimension when caller didn't measure. */
function intentBboxMaxMm(intent: IntentInput): number | null {
  const p = (intent.params ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const candidates = [
    num(p.width), num(p.height), num(p.depth),
    num(p.length), num(p.diameter), num(p.outerDiameter),
  ].filter((v): v is number => v !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/** Helper: count features of a given type in the intent. */
function countFeatures(intent: IntentInput, type: IntentFeature['type']): number {
  if (!Array.isArray(intent.features)) return 0;
  return intent.features.filter((f): f is IntentFeature => !!f && f.type === type).length;
}

/**
 * Score one process under the given options. Pure. The full table of
 * rules lives here — every modifier is commented inline so the user can
 * see why the score moved.
 */
function scoreOne(process: ProcessForDfm, opts: SuggestProcessOptions): ProcessScore {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 50;
  const reasons: string[] = [];

  const material = opts.materialHint ?? 'any';
  const quantity = typeof opts.quantityHint === 'number' && opts.quantityHint > 0 ? opts.quantityHint : null;

  // ─── Material compatibility ──────────────────────────────────────────
  if (material === 'metal' && (process === 'fdm' || process === 'sla')) {
    blockers.push('Cannot print metal on this process');
    score = 0;
  }
  if (material === 'plastic' && process === 'die_cast') {
    blockers.push('Die casting is for metal alloys, not plastic');
    score = 0;
  }
  if (material === 'plastic' && process === 'cnc_mill') {
    score -= 10;
    reasons.push('plastic CNC is unusual but works');
  }
  if (material === 'metal' && process === 'cnc_mill') {
    score += 20;
    reasons.push('default choice for metal one-offs');
  }

  // ─── Quantity sweet-spot ─────────────────────────────────────────────
  if (quantity !== null) {
    if (quantity >= 1000 && (process === 'fdm' || process === 'sla')) {
      score -= 30;
      warnings.push(`Print is slow at qty ${quantity}; consider IM after a few hundred`);
    }
    if (quantity >= 1000 && process === 'injection_molding') {
      score += 25;
      reasons.push(`sweet spot for qty ${quantity}`);
    }
    if (quantity < 50 && process === 'injection_molding') {
      score -= 30;
      warnings.push(`At qty ${quantity}, $2000 mold setup dominates per-part cost`);
    }
    if (quantity >= 5000 && process === 'die_cast') {
      score += 20;
      reasons.push(`high-volume metal is die-cast territory`);
    }
    if (quantity < 100 && process === 'die_cast') {
      score -= 35;
      warnings.push(`At qty ${quantity}, $5000 die tooling is hard to justify`);
    }
  }

  // ─── Wall thickness gates ────────────────────────────────────────────
  const minWall = opts.measured?.minWallMm ?? null;
  if (minWall !== null) {
    if (minWall < 0.6 && (process === 'cnc_mill' || process === 'injection_molding' || process === 'die_cast')) {
      blockers.push(`Min wall ${minWall.toFixed(2)}mm is below the practical floor for ${process}`);
      score = 0;
    }
    if (minWall < 0.4 && process === 'sla') {
      score -= 20;
      warnings.push(`Min wall ${minWall.toFixed(2)}mm is fragile in SLA`);
    }
    if (minWall < 0.8 && process === 'fdm') {
      score -= 25;
      warnings.push(`Min wall ${minWall.toFixed(2)}mm is below FDM nozzle stability`);
    }
  }

  // ─── Build / part size limits ────────────────────────────────────────
  // Prefer measured bbox; fall back to intent params.
  const bbox = opts.measured?.bboxMm;
  const maxDim = bbox
    ? Math.max(bbox.wMm, bbox.hMm, bbox.dMm)
    : intentBboxMaxMm(opts.intent);
  if (maxDim !== null && maxDim > 200 && process === 'sla') {
    score -= 20;
    warnings.push(`Part ${maxDim.toFixed(0)}mm exceeds typical SLA build volume (~190mm)`);
  }
  if (maxDim !== null && maxDim > 300 && process === 'fdm') {
    score -= 10;
    warnings.push(`Part ${maxDim.toFixed(0)}mm may exceed common FDM beds; ABS will warp at this size`);
  }

  // ─── Mold-complexity penalties ───────────────────────────────────────
  const holeCount = opts.measured?.holeCount ?? countFeatures(opts.intent, 'hole');
  if (holeCount > 20 && process === 'injection_molding') {
    score -= 15;
    warnings.push(`${holeCount} holes will inflate IM tooling cost (every hole needs a slide / core)`);
  }
  if (holeCount > 20 && process === 'die_cast') {
    score -= 20;
    warnings.push(`${holeCount} holes is heavy for die casting; many become drill-after-cast ops`);
  }

  // ─── Sheet-metal limitations ─────────────────────────────────────────
  const chamferEdges = opts.measured?.chamferEdgeCount ?? countFeatures(opts.intent, 'chamfer');
  if (chamferEdges > 50 && process === 'sheet') {
    blockers.push(`Sheet metal cannot produce ${chamferEdges} chamfered edges — process change required`);
    score = 0;
  }
  if (chamferEdges > 0 && process === 'sheet') {
    score -= 10;
    warnings.push(`Sheet metal handles bend radii but not true chamfers`);
  }
  // Sheet metal works best on plate-like envelopes (one tiny dim).
  if (bbox && process === 'sheet') {
    const dims = [bbox.wMm, bbox.hMm, bbox.dMm].sort((a, b) => a - b);
    if (dims[0]! > 10) {
      score -= 15;
      warnings.push(`Smallest dim ${dims[0]!.toFixed(1)}mm is too thick for sheet stock (>6mm is bar/plate)`);
    }
  }

  // ─── Material-default boosts ─────────────────────────────────────────
  if (material === 'plastic' && (process === 'fdm' || process === 'sla')) {
    score += 5;
    reasons.push(`good plastic print fit`);
  }

  // ─── Clamp + headline ────────────────────────────────────────────────
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  // If we hit a blocker mid-rule (score=0), surface the first blocker as
  // the headline. Otherwise lead with the strongest positive reason
  // accumulated, falling back to the per-process default copy.
  const headline = blockers.length > 0
    ? blockers[0]!
    : (reasons.length > 0
        ? `${DEFAULT_REASON[process]} (${reasons.join(', ')})`
        : DEFAULT_REASON[process]);

  return {
    process,
    score,
    reason: headline,
    blockers,
    warnings,
  };
}

/**
 * Score all six processes, return ranked (highest first). Returns top 3
 * by default; pass `returnAll: true` to get the full table.
 */
export function suggestProcessForPart(opts: SuggestProcessOptions): ProcessScore[] {
  if (!opts || !opts.intent || typeof opts.intent !== 'object') {
    throw new Error('suggestProcessForPart requires { intent: IntentInput, ... }');
  }
  const scores = ALL_PROCESSES.map(p => scoreOne(p, opts));
  scores.sort((a, b) => {
    // Blocked (score=0) processes always sort below scored ones, even at tie.
    if (a.score === 0 && b.score !== 0) return 1;
    if (b.score === 0 && a.score !== 0) return -1;
    return b.score - a.score;
  });
  return opts.returnAll ? scores : scores.slice(0, 3);
}

/**
 * Human-readable formatter for tool output. Renders each score line
 * followed by indented warnings / blockers when present.
 */
export function formatProcessScores(scores: ProcessScore[]): string {
  if (scores.length === 0) return 'No process recommendations available.';
  const lines: string[] = [`Process recommendations (${scores.length}, ranked):`];
  scores.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.process} (score ${s.score}): ${s.reason}`);
    for (const b of s.blockers) {
      lines.push(`     BLOCKER: ${b}`);
    }
    for (const w of s.warnings) {
      lines.push(`     warning: ${w}`);
    }
  });
  return lines.join('\n');
}
