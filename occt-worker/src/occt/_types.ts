/**
 * Shared replicad type surfaces for the op handlers. Loose by design —
 * replicad's published .d.ts is thin and shape methods return chained
 * shapes; we narrow per-call inside each op.
 *
 * Each op file imports from here so the boolean / fillet / chamfer /
 * shell handlers stay consistent in how they cast replicad's any-like
 * surface.
 */

export interface ReplicadLike {
  makeBaseBox?: (x: number, y: number, z: number) => unknown;
  makeBaseCylinder?: (r: number, h: number) => unknown;
  makeBaseSphere?: (r: number) => unknown;
  exportSTL?: (shape: unknown) => Uint8Array | string;
  exportSTEP?: (shape: unknown) => string;
}

/** Shape with the ops we call across files. Methods are optional
 *  because replicad versions drift; each op file probes and falls back
 *  with a clear error message rather than crashing on undefined call. */
export interface OcctShape {
  cut?: (other: OcctShape) => OcctShape;
  fuse?: (other: OcctShape) => OcctShape;
  intersect?: (other: OcctShape) => OcctShape;
  translate?: (offset: [number, number, number]) => OcctShape;
  /** Edge / distance for chamfer + fillet take a 2nd optional selector
   *  (`(edge) => boolean`); we pass `() => true` so all edges qualify.
   *  Typed via spread so we don't pin a single arity. */
  fillet?: (...args: unknown[]) => OcctShape;
  chamfer?: (...args: unknown[]) => OcctShape;
  /** Shell removes the selected face(s) and offsets the rest inward by
   *  `thickness`. Selector arg pattern same as fillet/chamfer. */
  shell?: (...args: unknown[]) => OcctShape;
  volume?: number;
  surface?: number;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  isClosed?: () => boolean;
}

export interface ShapeMeta {
  /** Volume in mm³. */
  volume: number;
  /** Surface area in mm². */
  surface: number;
  /** AABB. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Tri count after tessellation (parsed from STL header). */
  triangles: number;
  /** OCCT manifold/closed check result. */
  manifold: boolean;
}

export interface SerializedResult {
  stl: Buffer;
  step: string;
  meta: ShapeMeta;
}
