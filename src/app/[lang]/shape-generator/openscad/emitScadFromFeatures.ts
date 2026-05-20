// emitScadFromFeatures
//
// Convert a NexyFab feature tree (base shape + FeatureInstance[]) into an
// OpenSCAD-shaped textual representation. The output is intentionally
// approximate — NexyFab's CSG/B-rep pipeline has features that don't map
// 1-to-1 to OpenSCAD primitives (fillet/chamfer/draft/topology-aware
// patterns), so those features are emitted as comments that name the
// operation, its parameters, and the upstream geometry it operates on.
//
// Use cases:
//   - Read-only "what does my model look like as SCAD?" panel.
//   - First half of Mode A ↔ Mode B parity (round-trip will come later).
//   - AI/share/export sidecar — sticking the SCAD next to the .nfab makes
//     the model legible to scripts and to the OpenSCAD ecosystem.
//
// Round-trip parsing (SCAD → feature tree) is intentionally out of scope
// here. That belongs to a separate `parseScadToFeatures` module so the
// emitter stays a pure projection.

import type { FeatureInstance } from '../features/types';

export interface EmitOpts {
  /** Selected base shape id from sceneStore (`box`, `cylinder`, ...). */
  baseShapeId: string;
  /** Numeric params keyed by name (sceneStore.params). */
  baseParams: Record<string, number>;
  /** Optional file-level header comment — usually project name + date. */
  header?: string;
}

const INDENT = '  ';

function fmt(n: number | undefined, fallback = 0): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.abs(v) < 1e-9 ? '0' : v.toString();
}

function emitBase(baseShapeId: string, p: Record<string, number>): string {
  switch (baseShapeId) {
    case 'box':
      return `cube([${fmt(p.width, 50)}, ${fmt(p.depth, 50)}, ${fmt(p.height, 50)}], center=true);`;
    case 'cylinder':
      return `cylinder(h=${fmt(p.height, 50)}, r=${fmt(p.radius, 25)}, center=true, $fn=64);`;
    case 'sphere':
      return `sphere(r=${fmt(p.radius, 25)}, $fn=64);`;
    case 'cone':
      return `cylinder(h=${fmt(p.height, 50)}, r1=${fmt(p.bottomRadius, 25)}, r2=${fmt(p.topRadius, 0)}, center=true, $fn=64);`;
    case 'torus':
      return `rotate_extrude($fn=64) translate([${fmt(p.majorRadius, 30)}, 0, 0]) circle(r=${fmt(p.minorRadius, 8)}, $fn=32);`;
    default:
      return `// unsupported base shape: ${baseShapeId}\ncube([10, 10, 10], center=true);`;
  }
}

function emitFeature(f: FeatureInstance, prior: string): string {
  if (!f.enabled) return `${prior} /* ${f.type} disabled */`;
  const p = f.params;
  switch (f.type) {
    case 'hole': {
      const dia = p.diameter ?? 6.5;
      const depth = p.depth ?? 100;
      const x = p.posX ?? 0, y = p.posY ?? 0, z = p.posZ ?? 0;
      const hole = `translate([${fmt(x)}, ${fmt(z)}, ${fmt(y)}]) cylinder(h=${fmt(depth)}, r=${fmt(dia / 2)}, center=true, $fn=32);`;
      return `difference() {\n${INDENT}${prior}\n${INDENT}${hole}\n}`;
    }
    case 'sketchExtrude': {
      const op = f.sketchData?.operation === 'subtract' ? 'difference' : 'union';
      const depth = f.sketchData?.config?.depth ?? p.depth ?? 10;
      const stub = `linear_extrude(height=${fmt(depth)}) /* sketch profile */ square([10, 10], center=true);`;
      return `${op}() {\n${INDENT}${prior}\n${INDENT}${stub}\n}`;
    }
    case 'revolve': {
      return `rotate_extrude(angle=${fmt(p.angle, 360)}, $fn=64) /* profile */ square([10, 10]);\n// note: combines with prior via union\n${prior}`;
    }
    case 'mirror': {
      const ax = p.axisX ?? 1, ay = p.axisY ?? 0, az = p.axisZ ?? 0;
      return `mirror([${fmt(ax)}, ${fmt(ay)}, ${fmt(az)}]) ${prior}`;
    }
    case 'linearPattern': {
      const count = Math.max(1, Math.round(p.count ?? 2));
      const spacing = p.spacing ?? 20;
      const axis = p.axis ?? 0;
      const offset = axis === 0 ? `[${fmt(spacing)}*i, 0, 0]` : axis === 1 ? `[0, 0, ${fmt(spacing)}*i]` : `[0, ${fmt(spacing)}*i, 0]`;
      return `for (i = [0 : ${count - 1}]) translate(${offset}) ${prior}`;
    }
    case 'circularPattern': {
      const count = Math.max(1, Math.round(p.count ?? 4));
      const angle = p.totalAngle ?? 360;
      return `for (a = [0 : ${count - 1}]) rotate([0, ${fmt(angle / count)}*a, 0]) ${prior}`;
    }
    case 'boolean': {
      // Without the other operand inline, mark as op-only — round-trip
      // editor will resolve operand bodies once that exists.
      const op = p.op === 1 ? 'difference' : p.op === 2 ? 'intersection' : 'union';
      return `// boolean ${op} with auxiliary body (see feature tree)\n${prior}`;
    }
    case 'scale': {
      return `scale([${fmt(p.x, 1)}, ${fmt(p.y, 1)}, ${fmt(p.z, 1)}]) ${prior}`;
    }
    case 'moveCopy': {
      return `translate([${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}]) ${prior}`;
    }
    // Topology-aware features that have no direct OpenSCAD primitive —
    // emitted as informative comments so the reader knows what NexyFab
    // is doing, but the SCAD output stays purely additive (the prior
    // shape passes through unchanged).
    case 'fillet':
    case 'variableFillet':
      return `// fillet (radius=${fmt(p.radius, 3)}) — emitted as identity; OpenSCAD has no exact equivalent\n${prior}`;
    case 'chamfer':
      return `// chamfer (size=${fmt(p.size, 3)}) — emitted as identity\n${prior}`;
    case 'shell':
    case 'variableShell':
      return `// shell (thickness=${fmt(p.thickness, 2)}) — emitted as identity\n${prior}`;
    case 'draft':
      return `// draft (angle=${fmt(p.angle, 5)}°) — emitted as identity\n${prior}`;
    case 'bend':
    case 'flange':
    case 'hem':
    case 'jog':
    case 'flatPattern':
      return `// sheet metal ${f.type} — emitted as identity\n${prior}`;
    case 'sweep':
    case 'loft':
    case 'boundarySurface':
      return `// ${f.type} — emitted as identity (sketch profiles not yet serialized)\n${prior}`;
    case 'thread':
    case 'helix':
    case 'rib':
    case 'splitBody':
    case 'moldTools':
    case 'weldment':
    case 'nurbsSurface':
      return `// ${f.type} — emitted as identity\n${prior}`;
    case 'sketch':
      // Pure sketch nodes don't produce 3-D geometry on their own; they
      // feed sketchExtrude. Emit nothing, pass prior through.
      return prior;
  }
  // Exhaustiveness fallback for any future FeatureType added without an
  // emitter branch — TypeScript will catch the missing case here.
  const _exhaustive: never = f.type;
  return `// unhandled feature: ${String(_exhaustive)}\n${prior}`;
}

export function emitScadFromFeatures(features: FeatureInstance[], opts: EmitOpts): string {
  const lines: string[] = [];
  if (opts.header) lines.push(`// ${opts.header}`);
  lines.push('// Generated by NexyFab — feature tree → OpenSCAD projection.');
  lines.push('// Topology-aware features (fillet/chamfer/shell/draft) are emitted as');
  lines.push('// pass-through comments since OpenSCAD has no exact equivalent.');
  lines.push('');

  let body = emitBase(opts.baseShapeId, opts.baseParams);
  for (const f of features) {
    body = emitFeature(f, body);
  }
  lines.push(body);
  return lines.join('\n');
}
