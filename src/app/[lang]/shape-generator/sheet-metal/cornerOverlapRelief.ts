/**
 * cornerOverlapRelief.ts — Generate a corner relief notch where two
 * sheet-metal bends meet, so the flanges don't overlap or tear when
 * formed.
 *
 * When two adjacent bends share a corner, material accumulates in the
 * inner crease. The relief — a small notch on the inside corner of the
 * blank — gives the flanges room to fold without crushing.
 *
 * Three standard relief shapes are supported:
 *   - rectangular: a slot, depth = bend_offset, width = relief_width
 *   - obround    : same envelope with semi-circular ends
 *   - V-notch    : 90° (or configurable) notch with apex at corner
 *
 * Minimum width is computed from:
 *   w_min = max(material_thickness + 0.5 mm, 1.5 × bend_radius)
 */

export type ReliefShape = 'rectangular' | 'obround' | 'V-notch';

export interface BendDescriptor {
  bendRadiusMm: number;
  bendAngleDeg: number; // 0–180
}

export interface CornerReliefInput {
  bendA: BendDescriptor;
  bendB: BendDescriptor;
  materialThicknessMm: number;
  shape: ReliefShape;
  reliefWidthMm?: number; // override; default = computed minimum
  vNotchAngleDeg?: number; // for V-notch shape
}

export interface ReliefGeometry {
  shape: ReliefShape;
  widthMm: number;
  depthMm: number;
  vertices: { x: number; y: number }[]; // local coords at the corner
}

export interface CornerReliefResult {
  geometry: ReliefGeometry;
  minWidthMm: number;
  meetsMinimum: boolean;
  warnings: string[];
}

export function generateRelief(input: CornerReliefInput): CornerReliefResult {
  const warnings: string[] = [];
  const t = input.materialThicknessMm;
  if (t <= 0) warnings.push('Material thickness must be positive.');
  const rA = input.bendA.bendRadiusMm;
  const rB = input.bendB.bendRadiusMm;
  if (rA <= 0 || rB <= 0) warnings.push('Bend radii must be positive.');

  const minW = Math.max(t + 0.5, 1.5 * Math.max(rA, rB));
  const width = input.reliefWidthMm ?? minW;
  // Depth must clear both bend allowances at the corner.
  const depthA = rA + t;
  const depthB = rB + t;
  const depth = Math.max(depthA, depthB);

  const verts = buildVertices(input.shape, width, depth, input.vNotchAngleDeg ?? 90);

  return {
    geometry: { shape: input.shape, widthMm: width, depthMm: depth, vertices: verts },
    minWidthMm: minW,
    meetsMinimum: width >= minW - 1e-6,
    warnings,
  };
}

function buildVertices(shape: ReliefShape, width: number, depth: number, vAngle: number): { x: number; y: number }[] {
  // Corner is at the local origin. Sheet edges go along +x and +y; the
  // notch is cut INTO the first quadrant (into the material).
  switch (shape) {
    case 'rectangular':
      return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: depth },
        { x: 0, y: depth },
      ];
    case 'obround': {
      // rectangular body + two semicircles at the ends along width direction.
      const r = width / 2;
      const verts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
      const steps = 8;
      // Semicircle at (width, depth-r) sweeping into +y direction.
      for (let i = 0; i <= steps; i++) {
        const theta = -Math.PI / 2 + (i * Math.PI) / steps;
        verts.push({ x: width / 2 + r * Math.cos(theta), y: depth - r + r * Math.sin(theta) });
      }
      verts.push({ x: 0, y: depth - r });
      return verts;
    }
    case 'V-notch': {
      const halfAngle = (vAngle * Math.PI / 180) / 2;
      const apexDepth = depth;
      const half = Math.tan(halfAngle) * apexDepth;
      return [
        { x: -half, y: 0 },
        { x: half, y: 0 },
        { x: 0, y: apexDepth },
      ];
    }
  }
}

/** Approximate area of the cut-out relief. */
export function reliefArea(geom: ReliefGeometry): number {
  const v = geom.vertices;
  let area = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % v.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function suggestShape(input: Omit<CornerReliefInput, 'shape'>): { shape: ReliefShape; reason: string } {
  const t = input.materialThicknessMm;
  if (t < 1.0) return { shape: 'V-notch', reason: 'Thin gauge — V-notch avoids excess material loss.' };
  if (t > 3.0) return { shape: 'obround', reason: 'Thick stock — obround relieves stress concentration.' };
  return { shape: 'rectangular', reason: 'Mid-gauge — standard rectangular relief.' };
}

export function summarize(r: CornerReliefResult): { shape: ReliefShape; widthMm: number; meetsMinimum: boolean } {
  return { shape: r.geometry.shape, widthMm: r.geometry.widthMm, meetsMinimum: r.meetsMinimum };
}
