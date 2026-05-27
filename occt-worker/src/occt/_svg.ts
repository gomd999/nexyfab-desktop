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
 *               profiles need true face boundaries and that's a W14
 *               item.
 *   - L / l   lineto (absolute / relative)
 *   - H / h   horizontal lineto
 *   - V / v   vertical lineto
 *   - Z / z   closepath (REQUIRED — open paths can't extrude into a solid)
 *
 *   - C / Q / S / T / A → REJECTED with explicit "tessellate client-side"
 *     message. W14 adds Bezier flattening with configurable chord-height
 *     tolerance; arcs (A) follow that.
 *
 * Output guarantees:
 *   - First and last points are NOT identical — the polygon validator
 *     downstream rejects that and SVG's Z often emits the start vertex
 *     again. We pop the duplicate before returning.
 *   - ≥ 3 points (otherwise downstream throws clean).
 */

const COMMAND_RE = /([MmLlHhVvZzCcQqSsTtAa])([^MmLlHhVvZzCcQqSsTtAa]*)/g;
const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

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
}

export function parseSvgPath(d: string): SvgParseResult {
  if (typeof d !== 'string' || d.trim().length === 0) {
    throw new Error('invalid params: svgPath.d must be a non-empty string');
  }

  const state: ParserState = { x: 0, y: 0, startX: 0, startY: 0, started: false };
  const points: [number, number][] = [];
  let closed = false;

  for (const match of d.matchAll(COMMAND_RE)) {
    const cmd = match[1]!;
    const args = (match[2]!.match(NUMBER_RE) ?? []).map(Number);

    // Bezier / arc commands — explicit reject so callers get a clear
    // 400 instead of an opaque OCCT failure later. W14 adds these.
    if ('CcQqSsTtAa'.includes(cmd)) {
      throw new Error(
        `invalid params: SVG command '${cmd}' (Bezier/arc) not supported yet — tessellate to line segments client-side or wait for W14`,
      );
    }

    switch (cmd) {
      case 'M': moveAbs(state, points, args); break;
      case 'm': moveRel(state, points, args); break;
      case 'L': lineAbs(state, points, args); break;
      case 'l': lineRel(state, points, args); break;
      case 'H': horizAbs(state, points, args); break;
      case 'h': horizRel(state, points, args); break;
      case 'V': vertAbs(state, points, args); break;
      case 'v': vertRel(state, points, args); break;
      case 'Z':
      case 'z': {
        closed = true;
        // Close geometrically — but DON'T emit the start vertex as a
        // new point; the downstream polygon validator rejects
        // explicit first/last duplicates. close() in replicad's draw
        // builder will weld the final segment for us.
        state.x = state.startX;
        state.y = state.startY;
        break;
      }
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
