/**
 * extrudeProfile — convert a sketch profile (closed loops) into an extrude
 * IR (intermediate representation) and an OpenSCAD source string.
 *
 * Phase 2.1.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Why both an IR and a SCAD string?
 *   - The IR is the canonical, language-agnostic feature description that
 *     downstream OCCT/Parasolid integrations will consume (Phase 2.x+).
 *     Keeping it separate from the SCAD serializer means swapping kernels
 *     later doesn't require re-touching every extrude call site.
 *   - SCAD is the present-day execution backend (existing NexyFab
 *     openscad-render pipeline). This module renders the IR to SCAD source
 *     ready for that pipeline.
 *
 * Scope (Phase 2.1.2 — minimal):
 *   - Single profile (outer loop only), single solid extrude (no holes yet).
 *   - Two-sided / one-sided / midplane depth.
 *   - Optional draft angle (linear taper).
 *   - 'add' (boss) and 'cut' modes — cut yields a `difference()` wrapper.
 *
 * Out of scope (Phase 2.1.3+):
 *   - Multi-loop with hole detection (signedArea sign → inner/outer)
 *   - Thin-wall feature (offset + sweep) — needs Phase 2.x OCCT shell
 *   - Up-to-surface / between-surfaces termination
 *   - Sketch-driven pattern of the extruded body
 */

import type { ClosedLoop, ProfilePoint } from '@/lib/sketch/sketchProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

export type ExtrudeMode = 'add' | 'cut';
export type ExtrudeDirection = 'one_sided' | 'two_sided' | 'midplane';

export interface ExtrudeFeature {
  kind: 'extrude';
  /** Profile loop traversed CCW (positive signedArea). */
  loop: ReadonlyArray<{ x: number; y: number }>;
  /** Distance in sketch units (mm by convention). Must be > 0. */
  depth: number;
  /** Optional taper angle in degrees. 0 = straight extrude. Range [-30, +30]. */
  draftDegrees?: number;
  direction: ExtrudeDirection;
  mode: ExtrudeMode;
}

// ─── builders ─────────────────────────────────────────────────────────────

export interface ExtrudeOptions {
  depth: number;
  draftDegrees?: number;
  direction?: ExtrudeDirection;
  mode?: ExtrudeMode;
}

/**
 * Build an extrude feature from a single closed loop + a point lookup.
 * Re-orients the loop CCW if input has negative signed area.
 */
export function buildExtrudeFromLoop(
  loop: ClosedLoop,
  pointById: ReadonlyMap<string, ProfilePoint>,
  opts: ExtrudeOptions,
): ExtrudeFeature {
  if (opts.depth <= 0 || !Number.isFinite(opts.depth)) {
    throw new Error(`extrude depth must be positive, got: ${opts.depth}`);
  }
  if (opts.draftDegrees !== undefined && Math.abs(opts.draftDegrees) > 30) {
    throw new Error(`draft must be in [-30, +30] degrees, got: ${opts.draftDegrees}`);
  }
  const orderedIds = loop.signedArea >= 0 ? loop.points : [...loop.points].reverse();
  const pts: { x: number; y: number }[] = [];
  for (const id of orderedIds) {
    const p = pointById.get(id);
    if (!p) throw new Error(`extrude: point ${id} missing from input`);
    pts.push({ x: p.x, y: p.y });
  }
  return {
    kind: 'extrude',
    loop: pts,
    depth: opts.depth,
    draftDegrees: opts.draftDegrees,
    direction: opts.direction ?? 'one_sided',
    mode: opts.mode ?? 'add',
  };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

/**
 * Convert an ExtrudeFeature to an OpenSCAD source string. The output is
 * idempotent for identical input (deterministic for caching/diffing).
 *
 * `cut` mode wraps in a `difference()` with a sentinel marker the host
 * pipeline can pattern-match to splice into the parent body.
 */
export function extrudeToScad(feature: ExtrudeFeature): string {
  const polygonPoints = feature.loop
    .map((p) => `[${formatNum(p.x)}, ${formatNum(p.y)}]`)
    .join(', ');

  const draft = feature.draftDegrees ?? 0;
  // OpenSCAD's linear_extrude scale = ratio of top to bottom. Convert draft
  // angle to scale based on a typical edge run = bounding box max dimension.
  const scale = draftToScale(feature);
  const center = feature.direction === 'midplane';
  const heightArg = formatNum(feature.depth);

  // Two-sided = extrude full depth + translate -depth/2 (== center=true with
  // 2x depth would also work but breaks scale interpretation). Use center=true
  // for midplane, and explicit translate for two_sided symmetric.
  let extrudeBlock: string;
  if (feature.direction === 'two_sided') {
    extrudeBlock = `translate([0,0,-${formatNum(feature.depth)}]) linear_extrude(height=${formatNum(feature.depth * 2)}${draftClause(draft, scale)})\n  polygon([${polygonPoints}]);`;
  } else {
    extrudeBlock = `linear_extrude(height=${heightArg}, center=${center}${draftClause(draft, scale)})\n  polygon([${polygonPoints}]);`;
  }

  if (feature.mode === 'cut') {
    // The host pipeline is expected to wrap the parent body around the
    // `// NEXYFAB:EXTRUDE_CUT` marker; we emit the negative body here.
    return `// NEXYFAB:EXTRUDE_CUT\n${extrudeBlock}`;
  }
  return extrudeBlock;
}

function draftToScale(feature: ExtrudeFeature): number {
  const a = (feature.draftDegrees ?? 0) * (Math.PI / 180);
  if (a === 0) return 1;
  // Approximate: scale = 1 + (depth * tan(a)) / characteristic_radius.
  // Use bounding-box half-min as characteristic radius (conservative).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of feature.loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const half = Math.min(maxX - minX, maxY - minY) / 2;
  if (half <= 1e-6) return 1;
  const delta = feature.depth * Math.tan(a);
  // Scale = (half - delta) / half. Positive draft narrows the top.
  const s = (half - delta) / half;
  return Math.max(0.01, Math.min(100, s));
}

function draftClause(draft: number, scale: number): string {
  if (draft === 0) return '';
  return `, scale=${formatNum(scale)}`;
}

function formatNum(n: number): string {
  // 4-decimal precision balances determinism with OpenSCAD numeric noise.
  if (!Number.isFinite(n)) throw new Error(`extrude: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
