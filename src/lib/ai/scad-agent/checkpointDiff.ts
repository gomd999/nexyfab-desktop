/**
 * checkpointDiff.ts — Track H: Version diff between checkpoints.
 *
 * The agent already captures a checkpoint after every successful render
 * (see B2 in tools.ts → `revert_to_checkpoint`). What's been missing is
 * a way to compare two checkpoints — "what changed between the version
 * the user accepted at #3 and the version we're rejecting at #5?" —
 * without forcing the user to eyeball the SCAD source themselves.
 *
 * v1 diff:
 *   - SCAD source: byte + line counts + qualitative summary
 *     (identical / small_edit / rewritten / truncated / expanded).
 *     Full unified diff is a follow-up (line-by-line is noisier than
 *     useful in the chat surface and we already surface the source in
 *     a side panel).
 *   - Geometry metrics: bbox delta per axis, volume delta + percent,
 *     surface area delta + percent, through-hole count delta,
 *     triangle count delta. Each pulls from the GeometryStats snapshot
 *     ATTACHED to the checkpoint (new `stats?` field added to Checkpoint
 *     for future capture sites — existing checkpoints without stats just
 *     give null deltas, the diff still works for the scadSource part).
 *
 * Pure / additive — no mutation, no async, no network.
 */

import type { Checkpoint, GeometryStats } from './types';

export interface CheckpointDelta {
  /** Identifying labels. */
  fromLabel: string;
  toLabel: string;
  fromTsMs: number;
  toTsMs: number;
  /** SCAD source delta — line counts only (cheap & useful at-a-glance).
   *  Full unified diff is a follow-up. */
  scadSource: {
    fromBytes: number;
    toBytes: number;
    fromLines: number;
    toLines: number;
    /** Quick descriptor: 'identical' / 'small_edit' / 'rewritten' / 'truncated' /
     *  'expanded' based on byte delta + line delta. */
    summary: string;
  };
  /** Bbox delta per axis in mm. null when either side missing bbox. */
  bboxDeltaMm: { width: number; height: number; depth: number } | null;
  /** Volume delta mm³ + percent. */
  volume: { fromMm3: number | null; toMm3: number | null; deltaMm3: number | null; deltaPct: number | null };
  /** Surface area delta mm² + percent. */
  surfaceArea: { fromMm2: number | null; toMm2: number | null; deltaMm2: number | null; deltaPct: number | null };
  /** Genus delta (through-hole count). null when either side missing. */
  genus: { from: number | null; to: number | null; delta: number | null };
  /** Triangle count delta — a coarse "mesh churn" indicator. */
  triangleCount: { from: number | null; to: number | null; delta: number | null };
}

export interface CheckpointWithStats {
  checkpoint: Checkpoint;
  /** Optional GeometryStats snapshot captured WITH this checkpoint. */
  stats?: GeometryStats;
}

/** Count source lines — \n separated. Empty string ⇒ 0 lines. */
function countLines(s: string): number {
  if (!s) return 0;
  // String#split returns 1 for a non-newline string. We treat the file
  // as having 1 line even if it has no trailing newline.
  return s.split('\n').length;
}

/**
 * Compute the SCAD source qualitative summary.
 *
 *   bytes equal             → 'identical'
 *   byte delta < 5% of larger → 'small_edit'
 *   byte delta > 50%        → 'rewritten'
 *   to < from by > 30%      → 'truncated'  (takes precedence over 'rewritten' when shrinking)
 *   to > from by > 30%      → 'expanded'
 *   otherwise               → 'moderate_edit'
 *
 * Order matters: 'identical' wins, then 'truncated' / 'expanded' (since
 * a 60% shrink/grow is more informative than 'rewritten'), then
 * 'rewritten' (large bidirectional change), then 'small_edit' (tiny),
 * then 'moderate_edit'.
 */
function scadSummary(fromBytes: number, toBytes: number): string {
  if (fromBytes === toBytes) return 'identical';
  const larger = Math.max(fromBytes, toBytes);
  if (larger === 0) return 'identical';
  const delta = Math.abs(toBytes - fromBytes);
  const pctOfLarger = (delta / larger) * 100;
  // Direction-flavored summaries first.
  if (fromBytes > 0 && toBytes < fromBytes * 0.7) return 'truncated';
  if (fromBytes > 0 && toBytes > fromBytes * 1.3) return 'expanded';
  if (pctOfLarger > 50) return 'rewritten';
  if (pctOfLarger < 5) return 'small_edit';
  return 'moderate_edit';
}

/** Helper: deltaPct = (to - from) / from × 100, null when either side null
 *  or `from` is 0. */
function pctDelta(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}

function simpleDelta(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return to - from;
}

/**
 * Diff two checkpoints. Pure — no mutation. Either checkpoint may be
 * missing its `stats` snapshot; the geometry deltas just come back null
 * for the missing side. The scadSource summary always populates.
 */
export function diffCheckpoints(
  a: CheckpointWithStats,
  b: CheckpointWithStats,
): CheckpointDelta {
  if (!a || !a.checkpoint || !b || !b.checkpoint) {
    throw new Error('diffCheckpoints requires { checkpoint } on both sides');
  }
  const aCp = a.checkpoint;
  const bCp = b.checkpoint;
  const fromBytes = aCp.scadSource ? aCp.scadSource.length : 0;
  const toBytes = bCp.scadSource ? bCp.scadSource.length : 0;
  const fromLines = countLines(aCp.scadSource ?? '');
  const toLines = countLines(bCp.scadSource ?? '');

  // Bbox delta — both sides must have a bbox.
  let bboxDeltaMm: CheckpointDelta['bboxDeltaMm'] = null;
  const aBox = a.stats?.bbox;
  const bBox = b.stats?.bbox;
  if (aBox && bBox) {
    const aw = aBox.max[0] - aBox.min[0];
    const ah = aBox.max[1] - aBox.min[1];
    const ad = aBox.max[2] - aBox.min[2];
    const bw = bBox.max[0] - bBox.min[0];
    const bh = bBox.max[1] - bBox.min[1];
    const bd = bBox.max[2] - bBox.min[2];
    bboxDeltaMm = {
      width: bw - aw,
      height: bh - ah,
      depth: bd - ad,
    };
  }

  const fromVol = typeof a.stats?.volume_mm3 === 'number' ? a.stats.volume_mm3 : null;
  const toVol = typeof b.stats?.volume_mm3 === 'number' ? b.stats.volume_mm3 : null;
  const fromArea = typeof a.stats?.surfaceArea_mm2 === 'number' ? a.stats.surfaceArea_mm2 : null;
  const toArea = typeof b.stats?.surfaceArea_mm2 === 'number' ? b.stats.surfaceArea_mm2 : null;
  // genus / triangleCount may be null on the source side (a manifold-fail
  // checkpoint legitimately has genus=null) — coerce undefined to null
  // but pass actual null through.
  const fromGenus: number | null = a.stats?.genus === undefined ? null : a.stats.genus;
  const toGenus: number | null = b.stats?.genus === undefined ? null : b.stats.genus;
  const fromTris = typeof a.stats?.triangleCount === 'number' ? a.stats.triangleCount : null;
  const toTris = typeof b.stats?.triangleCount === 'number' ? b.stats.triangleCount : null;

  return {
    fromLabel: aCp.label,
    toLabel: bCp.label,
    fromTsMs: aCp.ts,
    toTsMs: bCp.ts,
    scadSource: {
      fromBytes,
      toBytes,
      fromLines,
      toLines,
      summary: scadSummary(fromBytes, toBytes),
    },
    bboxDeltaMm,
    volume: {
      fromMm3: fromVol,
      toMm3: toVol,
      deltaMm3: simpleDelta(fromVol, toVol),
      deltaPct: pctDelta(fromVol, toVol),
    },
    surfaceArea: {
      fromMm2: fromArea,
      toMm2: toArea,
      deltaMm2: simpleDelta(fromArea, toArea),
      deltaPct: pctDelta(fromArea, toArea),
    },
    genus: {
      from: fromGenus,
      to: toGenus,
      delta: simpleDelta(fromGenus, toGenus),
    },
    triangleCount: {
      from: fromTris,
      to: toTris,
      delta: simpleDelta(fromTris, toTris),
    },
  };
}

/** Format a signed delta with a leading sign. */
function signed(n: number, digits: number = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

/**
 * Human-readable formatter for tool output. Skips lines for metrics
 * that are null on both sides so a stats-less diff stays clean.
 */
export function formatCheckpointDelta(d: CheckpointDelta): string {
  const elapsedSec = Math.round(Math.abs(d.toTsMs - d.fromTsMs) / 1000);
  const lines: string[] = [
    `Checkpoint diff: "${d.fromLabel}" → "${d.toLabel}"`,
    `  Elapsed: ${elapsedSec} s`,
  ];
  // SCAD line — always present.
  const sc = d.scadSource;
  const bytePct = sc.fromBytes > 0
    ? `, ${signed(((sc.toBytes - sc.fromBytes) / sc.fromBytes) * 100, 0)}%`
    : '';
  lines.push(
    `  SCAD: ${sc.fromBytes} → ${sc.toBytes} bytes${bytePct}, ${sc.fromLines} → ${sc.toLines} lines  [${sc.summary}]`,
  );
  // Bbox line.
  if (d.bboxDeltaMm) {
    lines.push(
      `  Bbox: width ${signed(d.bboxDeltaMm.width)} / height ${signed(d.bboxDeltaMm.height)} / depth ${signed(d.bboxDeltaMm.depth)} mm`,
    );
  }
  // Volume.
  if (d.volume.fromMm3 !== null || d.volume.toMm3 !== null) {
    const from = d.volume.fromMm3 === null ? '—' : d.volume.fromMm3.toFixed(0);
    const to = d.volume.toMm3 === null ? '—' : d.volume.toMm3.toFixed(0);
    const pct = d.volume.deltaPct !== null ? ` (${signed(d.volume.deltaPct)}%)` : '';
    lines.push(`  Volume: ${from} → ${to} mm³${pct}`);
  }
  // Surface area.
  if (d.surfaceArea.fromMm2 !== null || d.surfaceArea.toMm2 !== null) {
    const from = d.surfaceArea.fromMm2 === null ? '—' : d.surfaceArea.fromMm2.toFixed(0);
    const to = d.surfaceArea.toMm2 === null ? '—' : d.surfaceArea.toMm2.toFixed(0);
    const pct = d.surfaceArea.deltaPct !== null ? ` (${signed(d.surfaceArea.deltaPct)}%)` : '';
    lines.push(`  Surface area: ${from} → ${to} mm²${pct}`);
  }
  // Genus.
  if (d.genus.from !== null || d.genus.to !== null) {
    const from = d.genus.from === null ? '—' : String(d.genus.from);
    const to = d.genus.to === null ? '—' : String(d.genus.to);
    lines.push(`  Through-holes: ${from} → ${to}`);
  }
  // Triangle count.
  if (d.triangleCount.from !== null || d.triangleCount.to !== null) {
    const from = d.triangleCount.from === null ? '—' : String(d.triangleCount.from);
    const to = d.triangleCount.to === null ? '—' : String(d.triangleCount.to);
    lines.push(`  Triangle count: ${from} → ${to}`);
  }
  return lines.join('\n');
}
