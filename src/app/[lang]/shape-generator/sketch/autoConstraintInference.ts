/**
 * autoConstraintInference.ts — Infer geometric constraints from
 * sketch entity layout.
 *
 * When a user draws a sketch, most lines that *look* horizontal
 * within a small tolerance should be auto-constrained as horizontal.
 * Same for vertical, parallel, perpendicular, equal-length, etc.
 *
 * Inputs: a list of sketch entities (points / lines / arcs).
 * Output: suggested constraints with a confidence per suggestion.
 *
 * Heuristics:
 *
 *   - **Horizontal/Vertical**: line slope within ε of 0 / ±∞.
 *   - **Parallel**: two lines whose tangent dot product is > 1−ε.
 *   - **Perpendicular**: dot product within ε of 0.
 *   - **Equal length**: |L1 − L2| / max < ε.
 *   - **Coincident point**: |P1 − P2| < ε.
 *   - **Concentric**: two arcs with centers within ε.
 *   - **Equal radius**: two arcs with radius difference < ε.
 *
 * The caller decides which to accept (auto-apply vs prompt user).
 */

export interface Vec2 { x: number; y: number }

export type SketchEntity =
  | { id: string; kind: 'point'; position: Vec2 }
  | { id: string; kind: 'line'; start: Vec2; end: Vec2 }
  | { id: string; kind: 'arc'; center: Vec2; radius: number; startAngle: number; endAngle: number };

export type ConstraintKind =
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal-length'
  | 'coincident'
  | 'concentric'
  | 'equal-radius'
  | 'tangent';

export interface ConstraintSuggestion {
  kind: ConstraintKind;
  /** Entity ids involved (1 for unary, 2 for binary). */
  entityIds: string[];
  /** 0..1 confidence; higher = stronger signal. */
  confidence: number;
}

export interface InferenceOptions {
  /** Angle tolerance for horizontal/vertical/parallel/perp (radians). */
  angleToleranceRad: number;
  /** Length tolerance fraction for equal-length detection. */
  lengthTolerance: number;
  /** Distance tolerance for coincident detection (mm). */
  distanceToleranceMm: number;
}

export const DEFAULT_OPTIONS: InferenceOptions = {
  angleToleranceRad: 0.05,
  lengthTolerance: 0.02,
  distanceToleranceMm: 0.1,
};

// ── Top-level entry ────────────────────────────────────────────

export function inferConstraints(entities: SketchEntity[], options: Partial<InferenceOptions> = {}): ConstraintSuggestion[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const suggestions: ConstraintSuggestion[] = [];

  // Single-line unary constraints.
  for (const e of entities) {
    if (e.kind === 'line') {
      const angle = lineAngle(e);
      if (closeAngle(angle, 0, opts.angleToleranceRad) || closeAngle(angle, Math.PI, opts.angleToleranceRad)) {
        suggestions.push({ kind: 'horizontal', entityIds: [e.id], confidence: 1 - Math.abs(angle) / opts.angleToleranceRad });
      }
      if (closeAngle(angle, Math.PI / 2, opts.angleToleranceRad) || closeAngle(angle, -Math.PI / 2, opts.angleToleranceRad)) {
        const off = Math.min(Math.abs(angle - Math.PI / 2), Math.abs(angle + Math.PI / 2));
        suggestions.push({ kind: 'vertical', entityIds: [e.id], confidence: 1 - off / opts.angleToleranceRad });
      }
    }
  }

  // Pair-wise binary constraints.
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;
      const pair = inferPair(a, b, opts);
      suggestions.push(...pair);
    }
  }

  // Deduplicate identical suggestions (entity-set + kind), keep highest confidence.
  return mergeSuggestions(suggestions);
}

// ── Per-pair detection ────────────────────────────────────────

function inferPair(a: SketchEntity, b: SketchEntity, opts: InferenceOptions): ConstraintSuggestion[] {
  const out: ConstraintSuggestion[] = [];

  if (a.kind === 'point' && b.kind === 'point') {
    const d = distance(a.position, b.position);
    if (d < opts.distanceToleranceMm) {
      out.push({ kind: 'coincident', entityIds: [a.id, b.id], confidence: 1 - d / opts.distanceToleranceMm });
    }
  }

  if (a.kind === 'line' && b.kind === 'line') {
    const angleA = lineAngle(a);
    const angleB = lineAngle(b);
    const dAngle = wrapAngle(angleA - angleB);
    // Parallel (same or opposite direction).
    if (Math.abs(dAngle) < opts.angleToleranceRad || Math.abs(Math.abs(dAngle) - Math.PI) < opts.angleToleranceRad) {
      out.push({ kind: 'parallel', entityIds: [a.id, b.id], confidence: 1 - Math.min(Math.abs(dAngle), Math.abs(Math.abs(dAngle) - Math.PI)) / opts.angleToleranceRad });
    }
    // Perpendicular.
    if (Math.abs(Math.abs(dAngle) - Math.PI / 2) < opts.angleToleranceRad) {
      out.push({ kind: 'perpendicular', entityIds: [a.id, b.id], confidence: 1 - Math.abs(Math.abs(dAngle) - Math.PI / 2) / opts.angleToleranceRad });
    }
    // Equal length.
    const lenA = lineLength(a);
    const lenB = lineLength(b);
    const ratio = Math.abs(lenA - lenB) / Math.max(lenA, lenB, 1e-9);
    if (ratio < opts.lengthTolerance) {
      out.push({ kind: 'equal-length', entityIds: [a.id, b.id], confidence: 1 - ratio / opts.lengthTolerance });
    }
  }

  if (a.kind === 'arc' && b.kind === 'arc') {
    const dCenter = distance(a.center, b.center);
    if (dCenter < opts.distanceToleranceMm) {
      out.push({ kind: 'concentric', entityIds: [a.id, b.id], confidence: 1 - dCenter / opts.distanceToleranceMm });
    }
    const dR = Math.abs(a.radius - b.radius);
    if (dR < opts.lengthTolerance * Math.max(a.radius, b.radius)) {
      out.push({ kind: 'equal-radius', entityIds: [a.id, b.id], confidence: 1 - dR / (opts.lengthTolerance * Math.max(a.radius, b.radius)) });
    }
  }

  const lineEntity = a.kind === 'line' ? a : (b.kind === 'line' ? b : null);
  const arcEntity = a.kind === 'arc' ? a : (b.kind === 'arc' ? b : null);
  if (lineEntity && arcEntity) {
    const tangentDistance = Math.abs(distancePointToLine(arcEntity.center, lineEntity) - arcEntity.radius);
    if (tangentDistance < opts.distanceToleranceMm) {
      out.push({ kind: 'tangent', entityIds: [a.id, b.id], confidence: 1 - tangentDistance / opts.distanceToleranceMm });
    }
  }

  return out;
}

// ── Geometry helpers ──────────────────────────────────────────

function lineAngle(line: Extract<SketchEntity, { kind: 'line' }>): number {
  return Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
}

function lineLength(line: Extract<SketchEntity, { kind: 'line' }>): number {
  return distance(line.start, line.end);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToLine(p: Vec2, line: Extract<SketchEntity, { kind: 'line' }>): number {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return distance(p, line.start);
  const px = p.x - line.start.x;
  const py = p.y - line.start.y;
  return Math.abs((dx * py - dy * px) / len);
}

function closeAngle(actual: number, target: number, tol: number): boolean {
  return Math.abs(actual - target) < tol;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ── Merge duplicates ──────────────────────────────────────────

function mergeSuggestions(list: ConstraintSuggestion[]): ConstraintSuggestion[] {
  const map = new Map<string, ConstraintSuggestion>();
  for (const s of list) {
    const sorted = [...s.entityIds].sort().join('+');
    const key = `${s.kind}|${sorted}`;
    const prev = map.get(key);
    if (!prev || s.confidence > prev.confidence) map.set(key, s);
  }
  return [...map.values()];
}

// ── Summary ────────────────────────────────────────────────────

export interface InferenceSummary {
  totalSuggestions: number;
  byKind: Record<ConstraintKind, number>;
  averageConfidence: number;
  highConfidenceCount: number;
}

export function summarize(suggestions: ConstraintSuggestion[]): InferenceSummary {
  const byKind: Record<ConstraintKind, number> = {
    horizontal: 0, vertical: 0, parallel: 0, perpendicular: 0,
    'equal-length': 0, coincident: 0, concentric: 0,
    'equal-radius': 0, tangent: 0,
  };
  let conf = 0;
  let high = 0;
  for (const s of suggestions) {
    byKind[s.kind]++;
    conf += s.confidence;
    if (s.confidence > 0.9) high++;
  }
  return {
    totalSuggestions: suggestions.length,
    byKind,
    averageConfidence: suggestions.length > 0 ? conf / suggestions.length : 0,
    highConfidenceCount: high,
  };
}
