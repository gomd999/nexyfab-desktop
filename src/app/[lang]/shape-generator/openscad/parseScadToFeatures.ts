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
  /** Maps to the existing base shape id in NexyFab. */
  baseShapeId: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';
  /** Numeric params keyed by NexyFab parameter name. */
  params: Record<string, number>;
  /** Phase 2-b — translate prefix offset captured during stripping. Caller
   *  decides whether to surface this as a moveCopy feature, a positionX/Y/Z
   *  param, or a transform on the base shape. Absent (or zero-vector) means
   *  the SCAD had no translate prefix. */
  translate?: { x: number; y: number; z: number };
  /** C2 — outermost rotate([x,y,z]) in degrees, if the SCAD had one. */
  rotate?: { x: number; y: number; z: number };
  /** C2 — combined scale factor, if the SCAD had any scale() prefix. */
  scale?: { x: number; y: number; z: number };
  /** C2 — outermost mirror([x,y,z]) axis, if present. */
  mirror?: { x: number; y: number; z: number };
}

/** Phase 2 — a subtractive feature recovered from a `difference()` body. Today
 *  only `hole` (a `translate(...) cylinder(...)` tool, the inverse of the
 *  emitter's hole feature); the shape mirrors NexyFab's FeatureInstance params
 *  so the caller can `addFeatureWithParams('hole', params)` directly. */
export interface ScadRecognisedFeature {
  type: 'hole';
  params: Record<string, number>;
}

export type ScadParseResult =
  | { ok: true; shape: ScadRecognisedShape; features?: ScadRecognisedFeature[] }
  | { ok: false; reason: 'empty' | 'unsupported' | 'unparseable'; detail?: string };

const NUM = '(-?\\d+(?:\\.\\d+)?)';

// Phase 2-a — strip an optional leading `translate([x,y,z])` prefix so the
// primitive matchers below still see e.g. `cube([...])`. The translation
// itself is discarded for now (NexyFab base shapes are origin-centred);
// phase 2-b will preserve it as a moveCopy feature node.
const TRANSLATE_PREFIX_RE = new RegExp(
  '^translate\\s*\\(\\s*\\[\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\]\\s*\\)\\s*',
);
// C2 — rotate / scale / mirror with a [x,y,z] vector argument.
const VEC3 = '\\[\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\]';
const ROTATE_PREFIX_RE = new RegExp('^rotate\\s*\\(\\s*' + VEC3 + '\\s*\\)\\s*');
const SCALE_PREFIX_RE = new RegExp('^scale\\s*\\(\\s*' + VEC3 + '\\s*\\)\\s*');
const SCALE_SCALAR_RE = new RegExp('^scale\\s*\\(\\s*' + NUM + '\\s*\\)\\s*');
const MIRROR_PREFIX_RE = new RegExp('^mirror\\s*\\(\\s*' + VEC3 + '\\s*\\)\\s*');

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
// `cylinder(h=h, r1=br, r2=tr, ...)` — a cone (tapered). Distinct from CYL_RE:
// the `r1=`/`r2=` keys mean CYL_RE's bare `r=` never matches this, so order is
// irrelevant, but we test cone first for clarity.
const CONE_RE = new RegExp(
  '^cylinder\\s*\\([^\\)]*?h\\s*=\\s*' + NUM + '[^\\)]*?r1\\s*=\\s*' + NUM + '[^\\)]*?r2\\s*=\\s*' + NUM,
);
// `rotate_extrude(...) translate([majorR, 0, 0]) circle(r=minorR, ...)` — the
// torus idiom our emitter writes (the inner translate is part of the idiom, not
// a transform prefix, so it isn't peeled by stripTransforms).
const TORUS_RE = new RegExp(
  '^rotate_extrude\\s*\\([^\\)]*\\)\\s*translate\\s*\\(\\s*\\[\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM +
  '\\s*\\]\\s*\\)\\s*circle\\s*\\(\\s*r\\s*=\\s*' + NUM,
);

interface StrippedTransforms {
  rest: string;
  offset: { x: number; y: number; z: number };
  /** Outermost rotate([x,y,z]) in degrees, if any. */
  rotate?: { x: number; y: number; z: number };
  /** Component-wise product of all scale() prefixes (commutative), if any. */
  scale?: { x: number; y: number; z: number };
  /** Outermost mirror([x,y,z]) axis, if any. */
  mirror?: { x: number; y: number; z: number };
}

/** C2 — peel leading transform prefixes (translate / rotate / scale / mirror,
 *  in any order) so the bare primitive call is exposed to the matchers, and
 *  surface the captured transforms. Translates accumulate additively and
 *  scales multiply (both order-independent); rotate/mirror keep the OUTERMOST
 *  occurrence (composing arbitrary rotations is out of scope for this
 *  deterministic recogniser). */
function stripTransforms(line: string): StrippedTransforms {
  let next = line;
  let ox = 0, oy = 0, oz = 0;
  let rotate: { x: number; y: number; z: number } | undefined;
  let mirror: { x: number; y: number; z: number } | undefined;
  let sx = 1, sy = 1, sz = 1, sawScale = false;
  // Cap nesting — defends against pathological inputs.
  for (let i = 0; i < 8; i++) {
    let m = TRANSLATE_PREFIX_RE.exec(next);
    if (m) { ox += parseFloat(m[1]); oy += parseFloat(m[2]); oz += parseFloat(m[3]); next = next.slice(m[0].length); continue; }
    m = ROTATE_PREFIX_RE.exec(next);
    if (m) { if (!rotate) rotate = { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }; next = next.slice(m[0].length); continue; }
    m = SCALE_PREFIX_RE.exec(next);
    if (m) { sx *= parseFloat(m[1]); sy *= parseFloat(m[2]); sz *= parseFloat(m[3]); sawScale = true; next = next.slice(m[0].length); continue; }
    m = SCALE_SCALAR_RE.exec(next);
    if (m) { const s = parseFloat(m[1]); sx *= s; sy *= s; sz *= s; sawScale = true; next = next.slice(m[0].length); continue; }
    m = MIRROR_PREFIX_RE.exec(next);
    if (m) { if (!mirror) mirror = { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }; next = next.slice(m[0].length); continue; }
    break;
  }
  return {
    rest: next.trim(),
    offset: { x: ox, y: oy, z: oz },
    rotate,
    scale: sawScale ? { x: sx, y: sy, z: sz } : undefined,
    mirror,
  };
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

/** Split a boolean-container body into its top-level children, respecting
 *  `{}` / `()` / `[]` nesting. The first child may be a nested boolean BLOCK
 *  (`difference() { … }`, no trailing `;`); the rest are `;`-terminated
 *  statements (the subtractive tools). Comments are stripped first. */
function splitTopLevelChildren(body: string): string[] {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const children: string[] = [];
  let brace = 0, paren = 0, bracket = 0, buf = '';
  for (const ch of clean) {
    buf += ch;
    if (ch === '{') brace++;
    else if (ch === '}') { brace--; if (brace === 0 && paren === 0 && bracket === 0) { children.push(buf); buf = ''; } }
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === ';' && brace === 0 && paren === 0 && bracket === 0) { children.push(buf); buf = ''; }
  }
  if (buf.trim()) children.push(buf);
  return children.map((c) => c.replace(/;\s*$/, '').trim()).filter(Boolean);
}

// A subtractive cylinder tool: `cylinder(h=…, r=…, …)` (the bare call after its
// transform prefix is peeled). Mirrors the base CYL_RE.
const HOLE_CYL_RE = new RegExp('^cylinder\\s*\\([^\\)]*?h\\s*=\\s*' + NUM + '[^\\)]*?r\\s*=\\s*' + NUM);

/** Recognise a `difference()` tool statement as a NexyFab `hole` feature — the
 *  inverse of emitFeature's hole case `translate([posX, posZ, posY])
 *  cylinder(h=depth, r=dia/2)`. Returns null for tools we don't model as holes
 *  (e.g. cube pockets), so the base shape still applies losslessly. */
function parseHoleTool(stmt: string): ScadRecognisedFeature | null {
  const { rest, offset } = stripTransforms(stmt);
  const m = HOLE_CYL_RE.exec(rest);
  if (!m) return null;
  const depth = parseFloat(m[1]!);
  const r = parseFloat(m[2]!);
  // SCAD vector is [posX, posZ, posY] (NexyFab is Y-up, SCAD Z-up) → invert.
  return {
    type: 'hole',
    params: { posX: offset.x, posY: offset.z, posZ: offset.y, diameter: r * 2, depth },
  };
}

export function parseScadToFeatures(scad: string): ScadParseResult {
  if (!scad || !scad.trim()) return { ok: false, reason: 'empty' };

  // Phase 2/3 — a top-level boolean container. For `difference()` we now invert
  // it into a base shape + subtractive `hole` features (nested differences =
  // multiple holes, peeled by recursion). `union`/`intersection` keep the prior
  // behaviour (recurse to the first recognised primitive as the base).
  // Strip comments first so the emitter's file-level header (always prepended)
  // doesn't hide the `difference()` that follows it.
  const stripped = scad.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const wrapped = unwrapTopLevelContainer(stripped);
  if (wrapped) {
    if (wrapped.kind === 'difference') {
      const children = splitTopLevelChildren(wrapped.body);
      if (children.length === 0) {
        return { ok: false, reason: 'unsupported', detail: 'empty difference body' };
      }
      const baseRes = parseScadToFeatures(children[0]!);
      if (!baseRes.ok) return baseRes;
      const features: ScadRecognisedFeature[] = [...(baseRes.features ?? [])];
      for (const tool of children.slice(1)) {
        const hole = parseHoleTool(tool);
        if (hole) features.push(hole); // unrecognised tools skipped (lossy, base intact)
      }
      return features.length
        ? { ok: true, shape: baseRes.shape, features }
        : baseRes;
    }
    return parseScadToFeatures(wrapped.body);
  }

  const lines = preprocess(scad);
  if (lines.length === 0) return { ok: false, reason: 'empty' };

  // First non-comment statement is the base primitive in our projection.
  for (const raw of lines) {
    const { rest: line, offset, rotate, scale, mirror } = stripTransforms(raw);
    const translate = (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) ? offset : undefined;
    const tf = { translate, rotate, scale, mirror };
    let m = CUBE_ARRAY_RE.exec(line);
    if (m) {
      const [w, d, h] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      // emitter writes [w, depth, height], so map back accordingly.
      return { ok: true, shape: { baseShapeId: 'box', params: { width: w, depth: d, height: h }, ...tf } };
    }
    m = CUBE_SCALAR_RE.exec(line);
    if (m) {
      const s = parseFloat(m[1]);
      return { ok: true, shape: { baseShapeId: 'box', params: { width: s, depth: s, height: s }, ...tf } };
    }
    m = CONE_RE.exec(line);
    if (m) {
      const [h, r1, r2] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      // SCAD radii → NexyFab diameters (scene stores bottom/topDiameter).
      return { ok: true, shape: { baseShapeId: 'cone', params: { height: h, bottomDiameter: r1 * 2, topDiameter: r2 * 2 }, ...tf } };
    }
    m = TORUS_RE.exec(line);
    if (m) {
      const [majorR, , , minorR] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
      return { ok: true, shape: { baseShapeId: 'torus', params: { majorDiameter: majorR * 2, tubeDiameter: minorR * 2 }, ...tf } };
    }
    m = CYL_RE.exec(line);
    if (m) {
      const [h, r] = [parseFloat(m[1]), parseFloat(m[2])];
      return { ok: true, shape: { baseShapeId: 'cylinder', params: { height: h, diameter: r * 2 }, ...tf } };
    }
    m = SPHERE_RE.exec(line);
    if (m) {
      const r = parseFloat(m[1]);
      return { ok: true, shape: { baseShapeId: 'sphere', params: { diameter: r * 2 }, ...tf } };
    }
    // Skip comment-only or unrecognised line and look at the next one.
  }

  return { ok: false, reason: 'unsupported', detail: 'no recognised primitive on first statement' };
}

// ── Round-trip feature tags (C1) ────────────────────────────────────────────

export interface NfabFeatureTag {
  type: string;
  params: Record<string, number>;
}

const NFAB_TAG_RE = /^\s*\/\/\s*@nfab\s+([A-Za-z]\w*)\s*(.*)$/;
const NFAB_KV_RE = /([A-Za-z]\w*)=(-?\d+(?:\.\d+)?)/g;

/**
 * Recover the machine-readable feature tags emitted by `nfabTag`
 * (fillet/chamfer/shell/draft/thread/…). These are the features OpenSCAD can't
 * represent natively, so they ride along as `// @nfab …` comments — letting an
 * emit → parse round-trip restore the full feature list losslessly.
 *
 * Returned in feature-application order. (The emitter prepends each tag above
 * the prior geometry, so a tag's text position is reverse-application; we undo
 * that here.)
 */
export function parseNfabFeatures(scad: string): NfabFeatureTag[] {
  const out: NfabFeatureTag[] = [];
  for (const line of scad.split(/\r?\n/)) {
    const m = NFAB_TAG_RE.exec(line);
    if (!m) continue;
    const params: Record<string, number> = {};
    let kv: RegExpExecArray | null;
    NFAB_KV_RE.lastIndex = 0;
    while ((kv = NFAB_KV_RE.exec(m[2]!)) !== null) params[kv[1]!] = parseFloat(kv[2]!);
    out.push({ type: m[1]!, params });
  }
  return out.reverse();
}
