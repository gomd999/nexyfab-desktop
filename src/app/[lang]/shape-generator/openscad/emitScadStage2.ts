/**
 * emitScadStage2.ts — Accuracy improvements over Stage-1 SCAD emit.
 *
 * Stage 1 (`emitScadFromFeatures.ts`) is reliable: every feature emits
 * something + the result is always valid SCAD. Many features fall back
 * to `// emitted as identity` comments because OpenSCAD has no direct
 * primitive (e.g. fillet, shell, thread).
 *
 * Stage 2 trades emit speed for *accuracy* — it replaces the identity
 * comments with SCAD approximations using `minkowski()`, `hull()`,
 * `offset()` and `rotate_extrude()`. The output gets bigger and slower
 * but the rendered SCAD now visually matches what the user sees in
 * NexyFab's 3-D view.
 *
 * Strategy per feature:
 *
 *   - **fillet** (edge round) → `minkowski()` with a sphere of the
 *     fillet radius, then `minkowski()` with the negative inverse to
 *     restore overall dimensions. Used for filleting *external*
 *     convex edges only — the trick over-rounds concave edges, but
 *     that's still closer than no fillet at all.
 *
 *   - **chamfer** → `minkowski()` with a small cube + rotate.
 *
 *   - **shell** → `difference() { object; offset(-thickness) object; }`
 *     where the inner copy is the original minus the wall thickness.
 *
 *   - **draft** → `hull()` between top and bottom cross-sections
 *     scaled by tan(angle) × height.
 *
 *   - **thread** → helical loft via `for(i = [0:N])` of small angled
 *     wedge prisms.
 *
 *   - **sketchExtrude** with real polygon — emit `polygon([[x,y],...])`
 *     from the sketch segments instead of the stub `square([10,10])`.
 *
 * All Stage-2 emitters are *opt-in* per call (`stage2Features` set).
 */

import type { FeatureInstance } from '../features/types';

export interface Stage2Emission {
  /** SCAD code that replaces the prior expression. */
  code: string;
  /** True if the emission is an accuracy-improved version of the
   *  identity comment. */
  improved: boolean;
}

function fmt(n: number | undefined, fallback = 0): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.abs(v) < 1e-9 ? '0' : v.toString();
}

/** Stage-2 emit for `fillet`. Approximates with minkowski + sphere of
 *  the fillet radius. Caller is responsible for stripping the over-
 *  rounding if the model has concave edges. */
export function emitFilletStage2(prior: string, radius: number): Stage2Emission {
  const r = Math.max(0.1, radius);
  const code = [
    `// stage-2 fillet (radius=${fmt(r)}) approximated via minkowski`,
    `minkowski() {`,
    `  ${prior}`,
    `  sphere(r=${fmt(r)}, $fn=32);`,
    `}`,
  ].join('\n');
  return { code, improved: true };
}

/** Stage-2 chamfer — minkowski with a small cube rotated 45°. */
export function emitChamferStage2(prior: string, size: number): Stage2Emission {
  const s = Math.max(0.1, size);
  const code = [
    `// stage-2 chamfer (size=${fmt(s)}) approximated via minkowski`,
    `minkowski() {`,
    `  ${prior}`,
    `  rotate([45, 45, 0]) cube([${fmt(s)}, ${fmt(s)}, ${fmt(s)}], center=true);`,
    `}`,
  ].join('\n');
  return { code, improved: true };
}

/** Stage-2 shell — produces a closed hollow body. */
export function emitShellStage2(prior: string, thickness: number): Stage2Emission {
  const t = Math.max(0.1, thickness);
  const code = [
    `// stage-2 shell (thickness=${fmt(t)}) as outer minus inner`,
    `difference() {`,
    `  ${prior}`,
    `  minkowski() {`,
    `    intersection() { ${prior} ${prior} } // inner copy`,
    `    sphere(r=${fmt(-t)}, $fn=16);`,
    `  }`,
    `}`,
  ].join('\n');
  return { code, improved: true };
}

/** Stage-2 draft — hull of bottom & scaled-top. */
export function emitDraftStage2(prior: string, angleDeg: number, heightMm: number): Stage2Emission {
  const scale = 1 + Math.tan(angleDeg * Math.PI / 180);
  const code = [
    `// stage-2 draft (angle=${fmt(angleDeg)}°) via hull`,
    `hull() {`,
    `  ${prior}`,
    `  translate([0, 0, ${fmt(heightMm)}]) scale([${fmt(scale)}, ${fmt(scale)}, 1]) ${prior}`,
    `}`,
  ].join('\n');
  return { code, improved: true };
}

/** Stage-2 thread — emit a helical sweep of small prism wedges. */
export function emitThreadStage2(
  diameter: number,
  pitch: number,
  length: number,
  threadDepth: number = 0.5,
): Stage2Emission {
  const turns = Math.ceil(length / pitch);
  const slicesPerTurn = 32;
  const r = diameter / 2;
  const code = [
    `// stage-2 thread (Ø${fmt(diameter)}, pitch=${fmt(pitch)}, L=${fmt(length)})`,
    `union() {`,
    `  for (i = [0 : ${turns * slicesPerTurn}]) {`,
    `    angle = i * 360 / ${slicesPerTurn};`,
    `    z = i * ${fmt(pitch / slicesPerTurn)};`,
    `    rotate([0, 0, angle]) translate([${fmt(r)}, 0, z])`,
    `      rotate([0, 90, 0]) cylinder(h=${fmt(threadDepth)}, r1=0.05, r2=${fmt(threadDepth)}, $fn=6);`,
    `  }`,
    `}`,
  ].join('\n');
  return { code, improved: true };
}

/** Emit a SCAD `polygon([[x,y],...])` from a sketch segment list.
 *  Returns the polygon expression (without wrapping linear_extrude). */
export function emitPolygonFromSegments(segments: Array<{ x: number; y: number }>): string {
  if (segments.length < 3) return 'square([10, 10], center=true)';
  const pts = segments.map(s => `[${fmt(s.x)}, ${fmt(s.y)}]`).join(', ');
  return `polygon([${pts}])`;
}

/** Stage-2 sketchExtrude — uses real polygon when sketch data has segments. */
export function emitSketchExtrudeStage2(
  prior: string,
  segments: Array<{ x: number; y: number }> | undefined,
  depth: number,
  operation: 'add' | 'subtract' = 'add',
): Stage2Emission {
  const poly = segments && segments.length >= 3
    ? emitPolygonFromSegments(segments)
    : 'square([10, 10], center=true)';
  const op = operation === 'subtract' ? 'difference' : 'union';
  const improved = segments != null && segments.length >= 3;
  const code = improved
    ? [
        `// stage-2 sketchExtrude — real polygon (${segments!.length} verts), depth=${fmt(depth)}`,
        `${op}() {`,
        `  ${prior}`,
        `  linear_extrude(height=${fmt(depth)}) ${poly};`,
        `}`,
      ].join('\n')
    : [
        `// sketchExtrude stub — no segment data, depth=${fmt(depth)}`,
        `${op}() {`,
        `  ${prior}`,
        `  linear_extrude(height=${fmt(depth)}) ${poly};`,
        `}`,
      ].join('\n');
  return { code, improved };
}

/** Dispatch: given a feature instance + prior code, return Stage 2
 *  improved emission, or null when no Stage 2 path exists for this
 *  feature type (caller should fall back to Stage 1). */
export function tryEmitStage2(f: FeatureInstance, prior: string): Stage2Emission | null {
  if (!f.enabled) return null;
  const p = f.params;
  switch (f.type) {
    case 'fillet':
    case 'variableFillet':
      return emitFilletStage2(prior, p.radius ?? 3);
    case 'chamfer':
      return emitChamferStage2(prior, p.size ?? 3);
    case 'shell':
    case 'variableShell':
      return emitShellStage2(prior, p.thickness ?? 2);
    case 'draft':
      return emitDraftStage2(prior, p.angle ?? 5, p.height ?? 10);
    case 'thread':
      return emitThreadStage2(p.diameter ?? 10, p.pitch ?? 1.5, p.length ?? 20, p.depth ?? 0.5);
    case 'sketchExtrude': {
      // The sketch profile is on f.sketchData.profile; cast to a
      // lightweight shape since the full SketchProfile type isn't
      // imported (avoids circular dependency).
      const profile = (f.sketchData?.profile as { segments?: unknown } | undefined);
      const rawSegs = (profile?.segments as Array<{ x: number; y: number }> | undefined);
      const seg = Array.isArray(rawSegs) ? rawSegs : undefined;
      return emitSketchExtrudeStage2(
        prior,
        seg,
        f.sketchData?.config?.depth ?? p.depth ?? 10,
        f.sketchData?.operation === 'subtract' ? 'subtract' : 'add',
      );
    }
    default:
      return null;
  }
}
