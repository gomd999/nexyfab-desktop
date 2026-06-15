/**
 * explodeImport — Phase 3.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Parse + validate the JSON keyframe sequence emitted by the assembly
 * modal's "Export steps" action, and turn it back into an `ExplodedState`
 * so the viewer can replay an imported disassembly (instead of the
 * freshly-computed one).
 *
 * Pure logic — no DOM / Three.js. The modal owns the file <input>; this
 * module just consumes the resulting text. Does NOT modify explodeView.ts
 * (it only re-uses its public ExplodeStep / ExplodedState types).
 */

import type { AssemblyState, PartInstance } from './assemblyState';
import type { ExplodeStep, ExplodedState, ExplodeTrailLine } from './explodeView';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { add, scale } from '@/lib/sketch/sketchPlane';

// ─── public types ──────────────────────────────────────────────────────────

export interface ImportedExplodeStep {
  partId: string;
  order: number;
  axis: Vec3;
  /** Millimetres along `axis`; always ≥ 0. */
  distance: number;
}

export interface ImportedExplode {
  assembly?: string;
  heuristic?: string;
  scale?: number;
  steps: ImportedExplodeStep[];
}

export type ParseResult =
  | { ok: true; value: ImportedExplode }
  | { ok: false; error: string };

// ─── parse + validate ────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return (
    typeof v === 'object' &&
    v !== null &&
    isFiniteNumber((v as Vec3).x) &&
    isFiniteNumber((v as Vec3).y) &&
    isFiniteNumber((v as Vec3).z)
  );
}

/**
 * Parse the exported JSON text into a validated {@link ImportedExplode}.
 * Tolerant of the extra `from` / `to` keyframe fields the exporter writes —
 * only the replay-relevant fields (partId, axis, distance, order) are
 * required. Returns a discriminated result rather than throwing so callers
 * can surface the message inline.
 */
export function parseExplodeImport(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'expected a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) {
    return { ok: false, error: 'missing "steps" array' };
  }
  const steps: ImportedExplodeStep[] = [];
  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i] as Record<string, unknown>;
    if (typeof s !== 'object' || s === null) {
      return { ok: false, error: `step ${i}: not an object` };
    }
    if (typeof s.partId !== 'string' || s.partId === '') {
      return { ok: false, error: `step ${i}: missing partId` };
    }
    if (!isVec3(s.axis)) {
      return { ok: false, error: `step ${i} (${s.partId}): axis must be {x,y,z} finite numbers` };
    }
    if (!isFiniteNumber(s.distance) || s.distance < 0) {
      return { ok: false, error: `step ${i} (${s.partId}): distance must be a number ≥ 0` };
    }
    if (!isFiniteNumber(s.order)) {
      return { ok: false, error: `step ${i} (${s.partId}): order must be a number` };
    }
    steps.push({
      partId: s.partId,
      order: s.order,
      axis: { x: s.axis.x, y: s.axis.y, z: s.axis.z },
      distance: s.distance,
    });
  }
  const value: ImportedExplode = { steps };
  if (typeof obj.assembly === 'string') value.assembly = obj.assembly;
  if (typeof obj.heuristic === 'string') value.heuristic = obj.heuristic;
  if (isFiniteNumber(obj.scale)) value.scale = obj.scale;
  return { ok: true, value };
}

// ─── rebuild an ExplodedState for the viewer ───────────────────────────────

/**
 * Turn imported steps into an {@link ExplodedState} bound to the CURRENT
 * assembly: each part that has a matching step is displaced by `axis ×
 * distance` from its assembled position. Steps whose partId is absent from
 * the assembly are ignored (the assembly may have changed since export).
 * The result plugs straight into `interpolateExplode`.
 */
export function explodedStateFromImport(
  state: AssemblyState,
  imported: ImportedExplode,
): ExplodedState {
  const stepById = new Map(imported.steps.map((s) => [s.partId, s]));
  const trailLines: ExplodeTrailLine[] = [];
  const displacedParts: PartInstance[] = state.parts.map((part) => {
    const s = stepById.get(part.id);
    if (!s || s.distance === 0) {
      trailLines.push({ partId: part.id, start: part.position, end: part.position });
      return { ...part };
    }
    const newPos = add(part.position, scale(s.axis, s.distance));
    trailLines.push({ partId: part.id, start: part.position, end: newPos });
    return { ...part, position: newPos };
  });

  // Only keep steps that target a real part, so movingCount / ordering match
  // the assembly actually on screen.
  const presentIds = new Set(state.parts.map((p) => p.id));
  const steps: ExplodeStep[] = imported.steps
    .filter((s) => presentIds.has(s.partId))
    .map((s) => ({ partId: s.partId, axis: s.axis, distance: s.distance, order: s.order }));

  return {
    steps,
    displacedState: { parts: displacedParts, mates: state.mates },
    trailLines,
  };
}
