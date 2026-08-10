export type ReplicadProjectionView =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'XY'
  | 'XZ'
  | 'YZ'
  | 'YX'
  | 'ZX'
  | 'ZY';

export interface ReplicadDrawingLike {
  toSVGPaths(): string[];
  toSVGViewBox?(margin: number): string;
  toSVG?(margin?: number): string;
  serialize?(): string;
  boundingBox?: { width: number; height: number; minX?: number; minY?: number };
}

export interface ReplicadProjectionLike {
  visible: ReplicadDrawingLike;
  hidden: ReplicadDrawingLike;
  method: 'replicad-hlr' | 'analytic-sphere-fallback';
  analyticCurveEvidence: boolean;
}

interface ReplicadProjectionModuleLike {
  drawProjection(shape: unknown, view?: string): {
    visible: ReplicadDrawingLike;
    hidden: ReplicadDrawingLike;
  };
  drawCircle(radius: number): ReplicadDrawingLike & {
    translate(offset: [number, number]): ReplicadDrawingLike;
  };
  Drawing: new () => ReplicadDrawingLike;
}

interface ReplicadShapeLike {
  faces?: Array<{ geomType?: string }>;
  boundingBox?: {
    bounds?: [number[], number[]];
    min?: number[];
    max?: number[];
  };
}

function boundsOf(shape: ReplicadShapeLike): [number[], number[]] | null {
  const box = shape.boundingBox;
  if (!box) return null;
  const bounds = box.bounds ?? (box.min && box.max ? [box.min, box.max] as [number[], number[]] : null);
  if (!bounds || bounds[0].length < 3 || bounds[1].length < 3) return null;
  if (![...bounds[0], ...bounds[1]].every(Number.isFinite)) return null;
  return bounds;
}

function projectPoint(view: ReplicadProjectionView, point: [number, number, number]): [number, number] {
  const [x, y, z] = point;
  switch (view) {
    case 'front':
    case 'XZ': return [x, -z];
    case 'back': return [-x, -z];
    case 'right': return [-y, -z];
    case 'left':
    case 'YZ': return [y, -z];
    case 'bottom':
    case 'XY': return [x, -y];
    case 'top': return [x, y];
    case 'YX': return [y, -x];
    case 'ZX': return [z, -x];
    case 'ZY': return [z, -y];
  }
}

function analyticSphereProjection(
  rc: ReplicadProjectionModuleLike,
  shape: ReplicadShapeLike,
  view: ReplicadProjectionView,
): ReplicadProjectionLike | null {
  let faces: Array<{ geomType?: string }>;
  try {
    faces = shape.faces ?? [];
  } catch {
    return null;
  }
  if (faces.length !== 1 || faces[0]?.geomType !== 'SPHERE') return null;
  const bounds = boundsOf(shape);
  if (!bounds) return null;
  const [min, max] = bounds;
  const diameters = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const diameter = diameters.reduce((sum, value) => sum + value, 0) / 3;
  const tolerance = Math.max(1e-7, diameter * 1e-7);
  if (diameter <= tolerance || diameters.some(value => Math.abs(value - diameter) > tolerance)) return null;
  const center: [number, number, number] = [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ];
  const center2d = projectPoint(view, center);
  const visible = rc.drawCircle(diameter / 2).translate(center2d);
  return {
    visible,
    hidden: new rc.Drawing(),
    method: 'analytic-sphere-fallback',
    analyticCurveEvidence: true,
  };
}

/**
 * Exact orthographic projection with a deliberately narrow analytic fallback.
 *
 * Replicad's OCCT HLR path is authoritative. Its current Drawing conversion
 * throws for an edge-less single spherical face even though the orthographic
 * silhouette is exactly one circle. Only that mathematically closed case is
 * recovered. Unknown/free-form HLR failures remain errors and can never be
 * silently promoted through a mesh projection.
 */
export function projectReplicadShapeExact(
  rc: ReplicadProjectionModuleLike,
  shape: ReplicadShapeLike,
  view: ReplicadProjectionView,
): ReplicadProjectionLike {
  try {
    const projected = rc.drawProjection(shape, view);
    const serialized = projected.visible.serialize?.() ?? '';
    return {
      ...projected,
      method: 'replicad-hlr',
      // Replicad Drawing.serialize() is JSON whose curve payload starts with
      // OCCT curve type 8 for an analytic circle. Inspect the JSON payload,
      // not the approximated SVG polyline.
      analyticCurveEvidence: /"8\s/.test(serialized),
    };
  } catch (cause) {
    const sphere = analyticSphereProjection(rc, shape, view);
    if (sphere) return sphere;
    throw cause;
  }
}
