// parseScadToFeatures — Phase 1 OpenSCAD → NexyFab feature recogniser.
//
// This is **not** a full OpenSCAD parser. A real one (with `if`, `for`,
// `module`, variable resolution, expression evaluation) lives in
// `openscad-parser` style libraries and is multi-week. Phase 1 covers
// the deterministic "first-line primitive" subset our own emitter
// produces, so a user who hits *Edit → Apply* in the SCAD panel after a
// trivial change still gets a structured intent we can map back into
// the feature tree, without needing a round-trip through the server
// renderer.
//
// Supported (recognised → reported):
//   cube([w, h, d], center=true)
//   cube(s)
//   cylinder(h=h, r=r, center=true, $fn=64)
//   sphere(r=r, $fn=64)
//
// Anything else returns `{ ok: false, reason: 'unsupported' }` and the
// caller is expected to fall back to the server renderer path (already
// wired in `ScadCodePanel.handleApply`).
//
// Phase 2 will add unions / differences, translate / rotate, more
// primitives, expression evaluator, and feature tree round-trip.

export interface ScadRecognisedShape {
  /** Maps to the existing base shape id in NexyFab (`box`, `cylinder`, `sphere`). */
  baseShapeId: 'box' | 'cylinder' | 'sphere';
  /** Numeric params keyed by NexyFab parameter name. */
  params: Record<string, number>;
  /** Phase 2-b — translate prefix offset captured during stripping. Caller
   *  decides whether to surface this as a moveCopy feature, a positionX/Y/Z
   *  param, or a transform on the base shape. Absent (or zero-vector) means
   *  the SCAD had no translate prefix. */
  translate?: { x: number; y: number; z: number };
}

export type ScadParseResult =
  | { ok: true; shape: ScadRecognisedShape }
  | { ok: false; reason: 'empty' | 'unsupported' | 'unparseable'; detail?: string };

const NUM = '(-?\\d+(?:\\.\\d+)?)';

// Phase 2-a — strip an optional leading `translate([x,y,z])` prefix so the
// primitive matchers below still see e.g. `cube([...])`. The translation
// itself is discarded for now (NexyFab base shapes are origin-centred);
// phase 2-b will preserve it as a moveCopy feature node.
const TRANSLATE_PREFIX_RE = new RegExp(
  '^translate\\s*\\(\\s*\\[\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\]\\s*\\)\\s*',
);

// `cube([w, h, d], center=true)` — w/h/d float, center optional and ignored
// (NexyFab default already centers the box on origin).
const CUBE_ARRAY_RE = new RegExp(
  '^cube\\s*\\(\\s*\\[\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\]',
);
// `cube(s)` — single side length.
const CUBE_SCALAR_RE = new RegExp('^cube\\s*\\(\\s*' + NUM + '\\s*\\)');
// `cylinder(h=h, r=r, ...)` — height + radius. NexyFab uses diameter so we
// translate r → 2r.
const CYL_RE = new RegExp(
  '^cylinder\\s*\\([^\\)]*?h\\s*=\\s*' + NUM + '[^\\)]*?r\\s*=\\s*' + NUM,
);
// `sphere(r=r, ...)`.
const SPHERE_RE = new RegExp('^sphere\\s*\\([^\\)]*?r\\s*=\\s*' + NUM);

/** Strip any number of `translate([x,y,z])` prefixes from a statement and
 *  return the bare primitive call plus the accumulated offset. Multiple
 *  nested translates compose by simple addition (translate is commutative
 *  with itself); rotate / scale prefixes are still passed through
 *  unrecognised at this phase. */
function stripTransforms(line: string): { rest: string; offset: { x: number; y: number; z: number } } {
  let next = line;
  let ox = 0, oy = 0, oz = 0;
  // Cap at 4 nested transforms — defends against pathological inputs
  // while still covering `translate(...) translate(...) cube(...)`.
  for (let i = 0; i < 4; i++) {
    const m = TRANSLATE_PREFIX_RE.exec(next);
    if (!m) break;
    ox += parseFloat(m[1]);
    oy += parseFloat(m[2]);
    oz += parseFloat(m[3]);
    next = next.slice(m[0].length);
  }
  return { rest: next.trim(), offset: { x: ox, y: oy, z: oz } };
}

/** Strip `//` line comments and trim each line so the regex above matches
 *  what our emitter actually produces. Multi-line `/\* *\/` comments are
 *  also peeled because the projection emitter starts with one. */
function preprocess(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.split('\n')
    .map(line => line.replace(/\/\/.*$/, '').trim())
    .filter(line => line.length > 0);
}

/** Phase 3 — pull the body out of a top-level `union() { ... }` /
 *  `difference() { ... }` / `intersection() { ... }` so callers can
 *  recurse into the first inner statement. Returns null when the input
 *  is a plain statement (no wrapping container).
 *
 *  We deliberately match brace nesting by hand instead of a full AST:
 *  the goal is to recognise the simple difference-with-a-hole pattern
 *  our own emitter writes, not to parse arbitrary OpenSCAD. */
function unwrapTopLevelContainer(src: string): { kind: 'union' | 'difference' | 'intersection'; body: string } | null {
  const trimmed = src.trim();
  const m = /^(union|difference|intersection)\s*\(\s*\)\s*\{/.exec(trimmed);
  if (!m) return null;
  // Walk braces from the open `{` to find the matching close.
  let depth = 0;
  let openAt = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) openAt = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const body = trimmed.slice(openAt + 1, i);
        return { kind: m[1] as 'union' | 'difference' | 'intersection', body };
      }
    }
  }
  return null;
}

export function parseScadToFeatures(scad: string): ScadParseResult {
  if (!scad || !scad.trim()) return { ok: false, reason: 'empty' };

  // Phase 3 — if the file is wrapped in a top-level boolean container,
  // recurse into the body so the inner primitive becomes the recognised
  // base shape. Future phase: track the container kind + subsequent
  // children as hole / cut features in the returned shape.
  const wrapped = unwrapTopLevelContainer(scad);
  if (wrapped) {
    return parseScadToFeatures(wrapped.body);
  }

  const lines = preprocess(scad);
  if (lines.length === 0) return { ok: false, reason: 'empty' };

  // First non-comment statement is the base primitive in our projection.
  for (const raw of lines) {
    const { rest: line, offset } = stripTransforms(raw);
    const translate = (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) ? offset : undefined;
    let m = CUBE_ARRAY_RE.exec(line);
    if (m) {
      const [w, d, h] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      // emitter writes [w, depth, height], so map back accordingly.
      return { ok: true, shape: { baseShapeId: 'box', params: { width: w, depth: d, height: h }, translate } };
    }
    m = CUBE_SCALAR_RE.exec(line);
    if (m) {
      const s = parseFloat(m[1]);
      return { ok: true, shape: { baseShapeId: 'box', params: { width: s, depth: s, height: s }, translate } };
    }
    m = CYL_RE.exec(line);
    if (m) {
      const [h, r] = [parseFloat(m[1]), parseFloat(m[2])];
      return { ok: true, shape: { baseShapeId: 'cylinder', params: { height: h, diameter: r * 2 }, translate } };
    }
    m = SPHERE_RE.exec(line);
    if (m) {
      const r = parseFloat(m[1]);
      return { ok: true, shape: { baseShapeId: 'sphere', params: { diameter: r * 2 }, translate } };
    }
    // Skip comment-only or unrecognised line and look at the next one.
  }

  return { ok: false, reason: 'unsupported', detail: 'no recognised primitive on first statement' };
}
