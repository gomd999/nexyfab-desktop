/**
 * boundaryVisualizer.ts — Produce visual markers (arrows, anchors,
 * springs) for FEA boundary conditions on a 3D model.
 *
 * The FEA panel needs to *show* the user where their constraints
 * and loads are applied. Different BC types get different glyphs:
 *
 *   - Fixed (clamp): cone with hatched base.
 *   - Pinned: triangle with sphere at the apex.
 *   - Roller: triangle with circle (one-axis free).
 *   - Point load: arrow with arrowhead at the target.
 *   - Pressure: small arrows on a face grid.
 *   - Bearing: dual arrow (radial + axial).
 *   - Thermal: thermometer icon.
 *
 * This module emits the *vector primitives* (lines, arrows, circles)
 * that the Three.js layer turns into geometry. Cleanly decoupled
 * from rendering.
 */

export interface Vec3 { x: number; y: number; z: number }

export type BCKind = 'fixed' | 'pinned' | 'roller' | 'load' | 'pressure' | 'bearing' | 'thermal';

export interface BoundaryCondition {
  id: string;
  kind: BCKind;
  /** Target position (or face centroid). */
  position: Vec3;
  /** Surface normal at the target (for face-attached BCs). */
  normal?: Vec3;
  /** Force vector (for load BCs). */
  force?: Vec3;
  /** Pressure magnitude, MPa. */
  pressureMpa?: number;
  /** Temperature, °C. */
  tempC?: number;
}

export type GlyphPrimitive =
  | { kind: 'line'; start: Vec3; end: Vec3 }
  | { kind: 'arrow'; start: Vec3; end: Vec3; headSize: number }
  | { kind: 'sphere'; center: Vec3; radius: number }
  | { kind: 'cone'; apex: Vec3; base: Vec3; radius: number }
  | { kind: 'circle'; center: Vec3; radius: number; axis: Vec3 }
  | { kind: 'label'; position: Vec3; text: string };

export interface GlyphSet {
  bcId: string;
  bcKind: BCKind;
  primitives: GlyphPrimitive[];
}

export interface VisualizeOptions {
  /** Glyph base size (mm). */
  scaleMm: number;
  /** Color hint (caller-handled). */
  colorByKind?: Record<BCKind, string>;
}

export const DEFAULT_OPTIONS: VisualizeOptions = {
  scaleMm: 10,
};

// ── Top-level entry ────────────────────────────────────────────

export function visualizeBoundaryConditions(bcs: BoundaryCondition[], options: Partial<VisualizeOptions> = {}): GlyphSet[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return bcs.map(bc => buildGlyph(bc, opts));
}

function buildGlyph(bc: BoundaryCondition, opts: VisualizeOptions): GlyphSet {
  const s = opts.scaleMm;
  const primitives: GlyphPrimitive[] = [];
  const p = bc.position;
  const n = bc.normal ? normalize(bc.normal) : { x: 0, y: 0, z: 1 };

  switch (bc.kind) {
    case 'fixed': {
      const base = { x: p.x - n.x * s, y: p.y - n.y * s, z: p.z - n.z * s };
      primitives.push({ kind: 'cone', apex: p, base, radius: s * 0.4 });
      // Hatching lines on the base.
      for (let k = -1; k <= 1; k++) {
        primitives.push({ kind: 'line', start: shift(base, [k * s * 0.3, 0, 0]), end: shift(base, [k * s * 0.3 + s * 0.5, -s * 0.5, 0]) });
      }
      primitives.push({ kind: 'label', position: shift(p, [0, 0, s * 0.5]), text: 'FIX' });
      break;
    }
    case 'pinned': {
      primitives.push({ kind: 'sphere', center: p, radius: s * 0.2 });
      const base = { x: p.x - n.x * s, y: p.y - n.y * s, z: p.z - n.z * s };
      primitives.push({ kind: 'line', start: p, end: base });
      primitives.push({ kind: 'label', position: shift(p, [0, 0, s * 0.4]), text: 'PIN' });
      break;
    }
    case 'roller': {
      primitives.push({ kind: 'circle', center: p, radius: s * 0.3, axis: n });
      primitives.push({ kind: 'label', position: shift(p, [0, 0, s * 0.4]), text: 'ROLL' });
      break;
    }
    case 'load': {
      const f = bc.force ?? { x: 0, y: 0, z: -1 };
      const mag = Math.hypot(f.x, f.y, f.z) || 1;
      const dir = { x: f.x / mag, y: f.y / mag, z: f.z / mag };
      const start = { x: p.x + dir.x * s, y: p.y + dir.y * s, z: p.z + dir.z * s };
      primitives.push({ kind: 'arrow', start, end: p, headSize: s * 0.3 });
      primitives.push({ kind: 'label', position: start, text: `${mag.toFixed(0)} N` });
      break;
    }
    case 'pressure': {
      // 3x3 grid of small arrows pointing along -normal.
      const arrowLen = s * 0.7;
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
          const offset = perpendicularOffset(n, r * s * 0.4, c * s * 0.4);
          const start = shift(p, [offset.x + n.x * arrowLen, offset.y + n.y * arrowLen, offset.z + n.z * arrowLen]);
          const end = shift(p, [offset.x, offset.y, offset.z]);
          primitives.push({ kind: 'arrow', start, end, headSize: s * 0.1 });
        }
      }
      const mpa = bc.pressureMpa ?? 0;
      primitives.push({ kind: 'label', position: shift(p, [0, 0, s]), text: `${mpa.toFixed(2)} MPa` });
      break;
    }
    case 'bearing': {
      const radial = shift(p, [s, 0, 0]);
      const axial = shift(p, [0, 0, s]);
      primitives.push({ kind: 'arrow', start: radial, end: p, headSize: s * 0.2 });
      primitives.push({ kind: 'arrow', start: axial, end: p, headSize: s * 0.2 });
      primitives.push({ kind: 'label', position: shift(p, [s, 0, s]), text: 'BEAR' });
      break;
    }
    case 'thermal': {
      // Vertical line + sphere at top (thermometer).
      const top = shift(p, [0, 0, s * 0.8]);
      primitives.push({ kind: 'line', start: p, end: top });
      primitives.push({ kind: 'sphere', center: top, radius: s * 0.15 });
      const t = bc.tempC ?? 20;
      primitives.push({ kind: 'label', position: shift(top, [0, 0, s * 0.3]), text: `${t}°C` });
      break;
    }
  }
  return { bcId: bc.id, bcKind: bc.kind, primitives };
}

// ── Helpers ────────────────────────────────────────────────────

function shift(p: Vec3, d: [number, number, number]): Vec3 {
  return { x: p.x + d[0], y: p.y + d[1], z: p.z + d[2] };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function perpendicularOffset(normal: Vec3, du: number, dv: number): Vec3 {
  const ref: Vec3 = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u: Vec3 = normalize(crossVec(normal, ref));
  const v: Vec3 = normalize(crossVec(normal, u));
  return { x: u.x * du + v.x * dv, y: u.y * du + v.y * dv, z: u.z * du + v.z * dv };
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface VisualizeSummary {
  bcCount: number;
  primitiveCount: number;
  primitivesByKind: Record<string, number>;
}

export function summarize(glyphs: GlyphSet[]): VisualizeSummary {
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const g of glyphs) {
    for (const p of g.primitives) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      total++;
    }
  }
  return {
    bcCount: glyphs.length,
    primitiveCount: total,
    primitivesByKind: byKind,
  };
}
