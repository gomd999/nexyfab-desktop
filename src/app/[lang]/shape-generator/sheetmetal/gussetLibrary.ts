/**
 * gussetLibrary.ts — Standard sheet-metal corner reliefs + gussets.
 *
 * Two families of features:
 *
 *   - **Bend relief**: a notch at the end of a bend line that lets the
 *     material distort without tearing during forming. Shapes: tear,
 *     round, square (rectangular). Sized per material thickness.
 *
 *   - **Corner gusset**: a stiffener added to an inside corner where
 *     two flanges meet. Adds stiffness without requiring a second
 *     part. Parametric (height × leg-length × thickness).
 *
 * Both are emitted as 2-D feature definitions the flat-pattern emitter
 * and the 3-D folder can consume. We don't model the gusset's bend
 * lines here — that goes through the regular bend feature once placed.
 */

export type BendReliefShape = 'tear' | 'round' | 'square';

export interface BendReliefSpec {
  shape: BendReliefShape;
  /** Width of the relief along the flange direction (mm). Typically
   *  1.0–1.5 × thickness. */
  widthMm: number;
  /** Depth of the relief into the flange (mm). Typically 0.5×T + bend radius. */
  depthMm: number;
}

export interface CornerGussetSpec {
  /** Both legs (along the two flanges) have this length (mm). */
  legMm: number;
  /** Gusset height above the corner (mm). */
  heightMm: number;
  /** Thickness — should equal the parent sheet thickness. */
  thicknessMm: number;
}

export interface ReliefRecommendation {
  shape: BendReliefShape;
  widthMm: number;
  depthMm: number;
  rationale: string;
}

const MIN_RELIEF_WIDTH_FACTOR = 1.0;
const MIN_RELIEF_DEPTH_FACTOR = 0.5;

/** Recommend a relief for a given thickness + inside bend radius. */
export function recommendBendRelief(
  thicknessMm: number,
  insideRadiusMm: number,
  preferred?: BendReliefShape,
): ReliefRecommendation {
  const width = Math.max(thicknessMm * MIN_RELIEF_WIDTH_FACTOR, 0.5);
  const depth = thicknessMm * MIN_RELIEF_DEPTH_FACTOR + insideRadiusMm;
  const shape = preferred ?? (thicknessMm <= 1.5 ? 'round' : 'tear');
  const rationale = preferred
    ? `user preference (${preferred})`
    : (thicknessMm <= 1.5 ? 'thin sheet → round (less stress concentration)' : 'medium / thick sheet → tear (fast laser cut)');
  return {
    shape,
    widthMm: Math.round(width * 100) / 100,
    depthMm: Math.round(depth * 100) / 100,
    rationale,
  };
}

export interface ReliefGeometry {
  /** Polyline points (mm) the flat-pattern emitter cuts out. */
  cutout: Array<[number, number]>;
}

/** Build the cutout polyline for a relief, anchored at the bend-end. */
export function buildBendReliefGeometry(
  spec: BendReliefSpec,
  origin: [number, number] = [0, 0],
): ReliefGeometry {
  const [ox, oy] = origin;
  const w = spec.widthMm;
  const d = spec.depthMm;
  switch (spec.shape) {
    case 'square':
      return {
        cutout: [
          [ox,         oy        ],
          [ox + w,     oy        ],
          [ox + w,     oy - d    ],
          [ox,         oy - d    ],
        ],
      };
    case 'round': {
      const r = w / 2;
      const cx = ox + r;
      const cy = oy - d + r;
      const segs = 16;
      const arc: Array<[number, number]> = [];
      arc.push([ox, oy]);
      arc.push([ox, cy]);
      for (let i = 0; i <= segs; i++) {
        const a = Math.PI + (i / segs) * Math.PI;
        arc.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      arc.push([ox + w, oy]);
      return { cutout: arc };
    }
    case 'tear':
      // V-notch with rounded tip.
      return {
        cutout: [
          [ox,             oy ],
          [ox + w * 0.5,   oy - d ],
          [ox + w,         oy ],
        ],
      };
  }
}

/** Build the 2-D footprint for a corner gusset (triangular cutout
 *  that becomes a fold-up stiffener). */
export function buildCornerGussetFootprint(
  spec: CornerGussetSpec,
  origin: [number, number] = [0, 0],
): Array<[number, number]> {
  const [ox, oy] = origin;
  const leg = spec.legMm;
  const h = spec.heightMm;
  return [
    [ox,        oy],
    [ox + leg,  oy],
    [ox,        oy + leg],
    // Apex offset by `h` toward the inside of the corner
    [ox + leg * 0.25, oy + leg * 0.25 + h],
  ];
}

/** Estimate the additional material area (mm²) consumed by a relief. */
export function reliefArea(spec: BendReliefSpec): number {
  switch (spec.shape) {
    case 'square': return spec.widthMm * spec.depthMm;
    case 'round': {
      const r = spec.widthMm / 2;
      return Math.PI * r * r / 2 + (spec.widthMm * (spec.depthMm - r));
    }
    case 'tear': return spec.widthMm * spec.depthMm * 0.5;
  }
}
