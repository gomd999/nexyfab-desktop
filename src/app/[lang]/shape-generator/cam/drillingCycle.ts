/**
 * drillingCycle.ts — Drilling cycle preview (G81 / G83-style).
 *
 * Drilling is conceptually simpler than pocket clearing — for each
 * hole the toolpath is:
 *   1. Rapid to the hole's XY position (at safe Z).
 *   2. Plunge to depth (G81 = single move, G83 = peck-and-retract).
 *   3. Rapid back to safe Z.
 *
 * We don't emit G-code here (that's `gcodeEmitter`); we just build
 * the segment list so the viewport / time estimate / safety check
 * all share one source of truth.
 */

export interface HoleSpec {
  /** XY centre of the hole in workpiece coords (mm). */
  x: number;
  y: number;
  /** Hole depth (mm), positive value. */
  depth: number;
}

export interface DrillingParams {
  /** Drill bit diameter (mm). Used for safety + time estimates. */
  diameter: number;
  /** Top of stock (Z). Default 0. */
  topZ?: number;
  /** Rapid clearance above topZ. Default 5 mm. */
  safeClearance?: number;
  /** Peck depth — 0 = G81 single plunge, > 0 = G83 peck-and-retract. */
  peckDepth?: number;
  /** Retract distance between pecks (G83 only). Default 1 mm. */
  retract?: number;
}

import type { ToolpathSegment } from './pocketToolpath';

export interface DrillingResult {
  segments: ToolpathSegment[];
  /** Total cut (plunge) length, mm. */
  cutLengthMm: number;
  /** Total rapid length, mm. */
  rapidLengthMm: number;
  /** Cycle type: 'G81' or 'G83'. */
  cycle: 'G81' | 'G83';
}

/** Build a single hole's segments (rapid → plunge → rapid). */
function singleHoleSegments(
  hole: HoleSpec,
  params: DrillingParams,
): ToolpathSegment[] {
  const topZ = params.topZ ?? 0;
  const safeZ = topZ + (params.safeClearance ?? 5);
  const targetZ = topZ - hole.depth;
  const segments: ToolpathSegment[] = [];
  // Position above hole (rapid).
  segments.push({ kind: 'rapid', start: [hole.x, hole.y, safeZ], end: [hole.x, hole.y, safeZ] });

  if ((params.peckDepth ?? 0) <= 0) {
    // G81: single plunge.
    segments.push({ kind: 'plunge', start: [hole.x, hole.y, safeZ], end: [hole.x, hole.y, targetZ] });
  } else {
    // G83: peck cycle. Plunge `peckDepth`, retract to topZ + retract, repeat.
    const peck = params.peckDepth!;
    const retract = params.retract ?? 1;
    let zCurrent = topZ;
    while (zCurrent - peck >= targetZ - 1e-9) {
      const next = Math.max(targetZ, zCurrent - peck);
      segments.push({ kind: 'plunge', start: [hole.x, hole.y, zCurrent], end: [hole.x, hole.y, next] });
      zCurrent = next;
      if (zCurrent <= targetZ + 1e-9) break;
      segments.push({ kind: 'rapid', start: [hole.x, hole.y, zCurrent], end: [hole.x, hole.y, topZ + retract] });
      segments.push({ kind: 'rapid', start: [hole.x, hole.y, topZ + retract], end: [hole.x, hole.y, zCurrent] });
    }
    // Final partial peck if not at depth.
    if (zCurrent > targetZ + 1e-9) {
      segments.push({ kind: 'plunge', start: [hole.x, hole.y, zCurrent], end: [hole.x, hole.y, targetZ] });
    }
  }
  // Retract.
  segments.push({ kind: 'rapid', start: [hole.x, hole.y, targetZ], end: [hole.x, hole.y, safeZ] });
  return segments;
}

function segLen(s: ToolpathSegment): number {
  const dx = s.end[0] - s.start[0];
  const dy = s.end[1] - s.start[1];
  const dz = s.end[2] - s.start[2];
  return Math.hypot(dx, dy, dz);
}

/** Build the full drilling toolpath for a hole list. Holes are
 *  processed in supplied order — caller can sort by XY to minimise
 *  rapid travel. */
export function buildDrillingCycle(
  holes: HoleSpec[],
  params: DrillingParams,
): DrillingResult {
  const all: ToolpathSegment[] = [];
  for (const h of holes) all.push(...singleHoleSegments(h, params));
  let cutLen = 0, rapidLen = 0;
  for (const s of all) {
    const len = segLen(s);
    if (s.kind === 'plunge' || s.kind === 'feed') cutLen += len;
    else rapidLen += len;
  }
  const cycle = (params.peckDepth ?? 0) > 0 ? 'G83' : 'G81';
  return { segments: all, cutLengthMm: cutLen, rapidLengthMm: rapidLen, cycle };
}
