/**
 * SVG path → polygon vertex list — W13 D3-5 (ADR-007).
 *
 * Parses the `d` attribute of an SVG <path> element into the same
 * `[[x, y], ...]` array consumed by `_polygon.buildPolygonDrawing`.
 * That lets extrude / revolve accept real CAD exports without growing
 * a parallel code path.
 *
 * Scope:
 *   - M / m   moveto (absolute / relative).
 *               First M starts the polygon; a second M (compound
 *               subpath) is rejected with a clean 400 — multi-loop
 *               profiles need true face boundaries and that's a
 *               follow-up item.
 *   - L / l   lineto (absolute / relative)
 *   - H / h   horizontal lineto
 *   - V / v   vertical lineto
 *   - C / c   cubic Bezier (3 control points per segment)
 *   - S / s   smooth cubic Bezier (reflects prev C's last control)
 *   - Q / q   quadratic Bezier (1 control point per segment)
 *   - T / t   smooth quadratic Bezier (reflects prev Q's control)
 *   - A / a   elliptical arc (W3C appendix B center-parameterization,
 *               split into ≤ 90° cubic Bezier segments, then flattened)
 *   - Z / z   closepath (REQUIRED — open paths can't extrude into a solid)
 *
 * Bezier commands flatten to line segments via recursive de Casteljau
 * subdivision (`_bezier.ts`). Chord-height tolerance defaults to
 * 0.1 mm — small enough for typical engineering precision, large
 * enough that simple curves don't explode into thousands of vertices.
 * Callers can override via `parseSvgPath(d, { tolerance })`.
 *
 * Output guarantees:
 *   - First and last points are NOT identical — the polygon validator
 *     downstream rejects that and SVG's Z often emits the start vertex
 *     again. We pop the duplicate before returning.
 *   - ≥ 3 points (otherwise downstream throws clean).
 */

import { flattenCubic, flattenQuadratic, reflect, type Point } from './_bezier.js';
import { arcToCubicBeziers } from './_arc.js';

const COMMAND_RE = /([MmLlHhVvZzCcQqSsTtAa])([^MmLlHhVvZzCcQqSsTtAa]*)/g;
const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

const DEFAULT_TOLERANCE_MM = 0.1;

export interface SvgParseOptions {
  /** Chord-height tolerance for Bezier flattening (mm). Default 0.1.
   *  Smaller = more vertices, finer curve approximation. */
  tolerance?: number;
}

export interface SvgParseResult {
  points: [number, number][];
  closed: boolean;
}

interface ParserState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  started: boolean;
  /** Previous cubic Bezier's last control point. Used by S/s to
   *  reflect across the current position for the implicit first
   *  control point. `null` when the previous command wasn't C/c/S/s. */
  prevCubicCtrl: Point | null;
  /** Previous quadratic Bezier's control point. Used by T/t for the
   *  same reflection pattern as S. */
  prevQuadCtrl: Point | null;
}

export function parseSvgPath(d: string, opts: SvgParseOptions = {}): SvgParseResult {
  if (typeof d !== 'string' || d.trim().length === 0) {
    throw new Error('invalid params: svgPath.d must be a non-empty string');
  }

  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE_MM;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error('invalid params: svgPath tolerance must be a positive finite number');
  }

  const state: ParserState = {
    x: 0, y: 0, startX: 0, startY: 0, started: false,
    prevCubicCtrl: null, prevQuadCtrl: null,
  };
  const points: [number, number][] = [];
  let closed = false;

  for (const match of d.matchAll(COMMAND_RE)) {
    const cmd = match[1]!;
    const args = (match[2]!.match(NUMBER_RE) ?? []).map(Number);

    // Bezier commands consume the previous-control-point state, so
    // we clear cubic/quadratic memory on every non-Bezier command
    // (per SVG spec — see comments in cubic/smoothCubic handlers).
    switch (cmd) {
      case 'M': moveAbs(state, points, args); break;
      case 'm': moveRel(state, points, args); break;
      case 'L': lineAbs(state, points, args); break;
      case 'l': lineRel(state, points, args); break;
      case 'H': horizAbs(state, points, args); break;
      case 'h': horizRel(state, points, args); break;
      case 'V': vertAbs(state, points, args); break;
      case 'v': vertRel(state, points, args); break;
      case 'C': cubicAbs(state, points, args, tolerance); break;
      case 'c': cubicRel(state, points, args, tolerance); break;
      case 'S': smoothCubicAbs(state, points, args, tolerance); break;
      case 's': smoothCubicRel(state, points, args, tolerance); break;
      case 'Q': quadAbs(state, points, args, tolerance); break;
      case 'q': quadRel(state, points, args, tolerance); break;
      case 'T': smoothQuadAbs(state, points, args, tolerance); break;
      case 't': smoothQuadRel(state, points, args, tolerance); break;
      case 'A': arcAbs(state, points, args, tolerance); break;
      case 'a': arcRel(state, points, args, tolerance); break;
      case 'Z':
      case 'z': {
        closed = true;
        state.x = state.startX;
        state.y = state.startY;
        // Z resets Bezier memory — a subsequent smooth command after
        // closure has no previous control to reflect from.
        state.prevCubicCtrl = null;
        state.prevQuadCtrl = null;
        break;
      }
    }

    // Reset Bezier memory after non-Bezier commands so an S/T that
    // follows e.g. an L or A falls back to "control = current point"
    // per SVG spec.
    if (!'CcSsQqTt'.includes(cmd)) {
      state.prevCubicCtrl = null;
      state.prevQuadCtrl = null;
    }
  }

  if (!state.started) {
    throw new Error('invalid params: SVG path empty or missing initial M command');
  }
  if (!closed) {
    throw new Error('invalid params: SVG path must end with Z (closepath) — open paths can\'t extrude');
  }

  // SVG normalises by sometimes emitting "M 0,0 L ... L 0,0 Z" where
  // the L returns to start. Drop the trailing duplicate to keep the
  // polygon validator happy.
  if (points.length >= 4) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) {
      points.pop();
    }
  }

  if (points.length < 3) {
    throw new Error(`invalid params: SVG path produced ${points.length} vertices (need ≥ 3)`);
  }

  return { points, closed };
}

// ─── command handlers ────────────────────────────────────────────────────────

function startSubpath(state: ParserState, x: number, y: number): void {
  if (state.started) {
    throw new Error('invalid params: multi-subpath SVG paths not supported (one M only)');
  }
  state.x = x;
  state.y = y;
  state.startX = x;
  state.startY = y;
  state.started = true;
}

function moveAbs(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length < 2) {
    throw new Error('invalid params: M needs 2 coordinates');
  }
  startSubpath(state, args[0]!, args[1]!);
  points.push([state.x, state.y]);
  // Per SVG spec, subsequent pairs after M are implicit L commands.
  for (let i = 2; i + 1 < args.length; i += 2) {
    state.x = args[i]!;
    state.y = args[i + 1]!;
    points.push([state.x, state.y]);
  }
}

function moveRel(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length < 2) {
    throw new Error('invalid params: m needs 2 coordinates');
  }
  // First relative m at start-of-path acts as M (per SVG spec).
  if (!state.started) {
    startSubpath(state, args[0]!, args[1]!);
    points.push([state.x, state.y]);
  } else {
    state.x += args[0]!;
    state.y += args[1]!;
    points.push([state.x, state.y]);
  }
  for (let i = 2; i + 1 < args.length; i += 2) {
    state.x += args[i]!;
    state.y += args[i + 1]!;
    points.push([state.x, state.y]);
  }
}

function lineAbs(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('invalid params: L needs pairs of coordinates');
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    state.x = args[i]!;
    state.y = args[i + 1]!;
    points.push([state.x, state.y]);
  }
}

function lineRel(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('invalid params: l needs pairs of coordinates');
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    state.x += args[i]!;
    state.y += args[i + 1]!;
    points.push([state.x, state.y]);
  }
}

function horizAbs(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0) {
    throw new Error('invalid params: H needs ≥ 1 coordinate');
  }
  for (const x of args) {
    state.x = x;
    points.push([state.x, state.y]);
  }
}

function horizRel(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0) {
    throw new Error('invalid params: h needs ≥ 1 coordinate');
  }
  for (const dx of args) {
    state.x += dx;
    points.push([state.x, state.y]);
  }
}

function vertAbs(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0) {
    throw new Error('invalid params: V needs ≥ 1 coordinate');
  }
  for (const y of args) {
    state.y = y;
    points.push([state.x, state.y]);
  }
}

function vertRel(state: ParserState, points: [number, number][], args: number[]): void {
  if (args.length === 0) {
    throw new Error('invalid params: v needs ≥ 1 coordinate');
  }
  for (const dy of args) {
    state.y += dy;
    points.push([state.x, state.y]);
  }
}

// ─── Bezier commands ─────────────────────────────────────────────────────────
// Each segment in C/c/Q/q consumes a fixed number of coords; multiple
// segments can chain after a single command letter. We loop through
// the args array, building each segment's control + endpoint points
// in current coordinates, and call into the flattener which appends
// the resulting polyline (excluding the starting endpoint) to `points`.

function cubicAbs(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 6 !== 0) {
    throw new Error('invalid params: C needs multiples of 6 coordinates');
  }
  for (let i = 0; i + 5 < args.length; i += 6) {
    const p0: Point = [state.x, state.y];
    const p1: Point = [args[i]!, args[i + 1]!];
    const p2: Point = [args[i + 2]!, args[i + 3]!];
    const p3: Point = [args[i + 4]!, args[i + 5]!];
    flattenCubic(p0, p1, p2, p3, tol, points);
    state.x = p3[0]; state.y = p3[1];
    state.prevCubicCtrl = p2;
  }
}

function cubicRel(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 6 !== 0) {
    throw new Error('invalid params: c needs multiples of 6 coordinates');
  }
  for (let i = 0; i + 5 < args.length; i += 6) {
    const p0: Point = [state.x, state.y];
    const p1: Point = [state.x + args[i]!, state.y + args[i + 1]!];
    const p2: Point = [state.x + args[i + 2]!, state.y + args[i + 3]!];
    const p3: Point = [state.x + args[i + 4]!, state.y + args[i + 5]!];
    flattenCubic(p0, p1, p2, p3, tol, points);
    state.x = p3[0]; state.y = p3[1];
    state.prevCubicCtrl = p2;
  }
}

/** Smooth cubic: P1 is reflection of previous segment's P2 across the
 *  current position. If no previous cubic, P1 = current position (per
 *  SVG spec). Multiple segments chain — each chained one reflects the
 *  PREVIOUS segment, not the original. */
function smoothCubicAbs(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 4 !== 0) {
    throw new Error('invalid params: S needs multiples of 4 coordinates');
  }
  for (let i = 0; i + 3 < args.length; i += 4) {
    const p0: Point = [state.x, state.y];
    const p1: Point = state.prevCubicCtrl ? reflect(p0, state.prevCubicCtrl) : p0;
    const p2: Point = [args[i]!, args[i + 1]!];
    const p3: Point = [args[i + 2]!, args[i + 3]!];
    flattenCubic(p0, p1, p2, p3, tol, points);
    state.x = p3[0]; state.y = p3[1];
    state.prevCubicCtrl = p2;
  }
}

function smoothCubicRel(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 4 !== 0) {
    throw new Error('invalid params: s needs multiples of 4 coordinates');
  }
  for (let i = 0; i + 3 < args.length; i += 4) {
    const p0: Point = [state.x, state.y];
    const p1: Point = state.prevCubicCtrl ? reflect(p0, state.prevCubicCtrl) : p0;
    const p2: Point = [state.x + args[i]!, state.y + args[i + 1]!];
    const p3: Point = [state.x + args[i + 2]!, state.y + args[i + 3]!];
    flattenCubic(p0, p1, p2, p3, tol, points);
    state.x = p3[0]; state.y = p3[1];
    state.prevCubicCtrl = p2;
  }
}

function quadAbs(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 4 !== 0) {
    throw new Error('invalid params: Q needs multiples of 4 coordinates');
  }
  for (let i = 0; i + 3 < args.length; i += 4) {
    const p0: Point = [state.x, state.y];
    const q1: Point = [args[i]!, args[i + 1]!];
    const q2: Point = [args[i + 2]!, args[i + 3]!];
    flattenQuadratic(p0, q1, q2, tol, points);
    state.x = q2[0]; state.y = q2[1];
    state.prevQuadCtrl = q1;
  }
}

function quadRel(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 4 !== 0) {
    throw new Error('invalid params: q needs multiples of 4 coordinates');
  }
  for (let i = 0; i + 3 < args.length; i += 4) {
    const p0: Point = [state.x, state.y];
    const q1: Point = [state.x + args[i]!, state.y + args[i + 1]!];
    const q2: Point = [state.x + args[i + 2]!, state.y + args[i + 3]!];
    flattenQuadratic(p0, q1, q2, tol, points);
    state.x = q2[0]; state.y = q2[1];
    state.prevQuadCtrl = q1;
  }
}

function smoothQuadAbs(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('invalid params: T needs multiples of 2 coordinates');
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    const p0: Point = [state.x, state.y];
    const q1: Point = state.prevQuadCtrl ? reflect(p0, state.prevQuadCtrl) : p0;
    const q2: Point = [args[i]!, args[i + 1]!];
    flattenQuadratic(p0, q1, q2, tol, points);
    state.x = q2[0]; state.y = q2[1];
    state.prevQuadCtrl = q1;
  }
}

function smoothQuadRel(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('invalid params: t needs multiples of 2 coordinates');
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    const p0: Point = [state.x, state.y];
    const q1: Point = state.prevQuadCtrl ? reflect(p0, state.prevQuadCtrl) : p0;
    const q2: Point = [state.x + args[i]!, state.y + args[i + 1]!];
    flattenQuadratic(p0, q1, q2, tol, points);
    state.x = q2[0]; state.y = q2[1];
    state.prevQuadCtrl = q1;
  }
}

/** Elliptical arc — 7 args per segment: rx ry x-axis-rotation
 *  large-arc-flag sweep-flag x y. Each arc converts to ≤ 4 cubic
 *  Bezier segments (one per ≤ 90° sub-arc), then the existing
 *  flattener subdivides further to honour tolerance. */
function arcAbs(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 7 !== 0) {
    throw new Error('invalid params: A needs multiples of 7 coordinates');
  }
  for (let i = 0; i + 6 < args.length; i += 7) {
    const rx = args[i]!, ry = args[i + 1]!, phi = args[i + 2]!;
    const fA = args[i + 3]!, fS = args[i + 4]!;
    const x2 = args[i + 5]!, y2 = args[i + 6]!;
    if (fA !== 0 && fA !== 1) {
      throw new Error('invalid params: A large-arc-flag must be 0 or 1');
    }
    if (fS !== 0 && fS !== 1) {
      throw new Error('invalid params: A sweep-flag must be 0 or 1');
    }
    const beziers = arcToCubicBeziers(
      [state.x, state.y], [rx, ry], phi, fA as 0 | 1, fS as 0 | 1, [x2, y2],
    );
    for (const b of beziers) {
      flattenCubic(b.p0, b.p1, b.p2, b.p3, tol, points);
    }
    state.x = x2; state.y = y2;
  }
}

function arcRel(state: ParserState, points: [number, number][], args: number[], tol: number): void {
  if (args.length === 0 || args.length % 7 !== 0) {
    throw new Error('invalid params: a needs multiples of 7 coordinates');
  }
  for (let i = 0; i + 6 < args.length; i += 7) {
    const rx = args[i]!, ry = args[i + 1]!, phi = args[i + 2]!;
    const fA = args[i + 3]!, fS = args[i + 4]!;
    const x2 = state.x + args[i + 5]!;
    const y2 = state.y + args[i + 6]!;
    if (fA !== 0 && fA !== 1) {
      throw new Error('invalid params: a large-arc-flag must be 0 or 1');
    }
    if (fS !== 0 && fS !== 1) {
      throw new Error('invalid params: a sweep-flag must be 0 or 1');
    }
    const beziers = arcToCubicBeziers(
      [state.x, state.y], [rx, ry], phi, fA as 0 | 1, fS as 0 | 1, [x2, y2],
    );
    for (const b of beziers) {
      flattenCubic(b.p0, b.p1, b.p2, b.p3, tol, points);
    }
    state.x = x2; state.y = y2;
  }
}
