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
  /** 2D profile builders for extrude / revolve. Each returns a
   *  DrawingLike that's chained into sketchOnPlane → extrude/revolve. */
  drawRectangle?: (w: number, h: number) => DrawingLike;
  drawCircle?: (r: number) => DrawingLike;
  /** Open-ended builder for polygon profiles. Caller chains moveTo →
   *  lineTo* → close to produce a DrawingLike. */
  draw?: () => DrawBuilder;
  exportSTL?: (shape: unknown) => Uint8Array | string;
  exportSTEP?: (shape: unknown) => string;
}

/** 2D drawing handle returned by replicad's draw* helpers. */
export interface DrawingLike {
  sketchOnPlane?: (plane: 'XY' | 'XZ' | 'YZ', offset?: number) => SketchLike;
}

/** Open drawing builder used to construct custom polygon profiles
 *  vertex-by-vertex. replicad's `draw()` returns a chain that we drive
 *  with moveTo/lineTo and close with `close()` → returns a closed
 *  DrawingLike ready for sketchOnPlane. */
export interface DrawBuilder {
  moveTo?: (x: number, y: number) => DrawBuilder;
  lineTo?: (x: number, y: number) => DrawBuilder;
  close?: () => DrawingLike;
}

/** A sketched 2D profile sitting on a plane in 3-space. */
export interface SketchLike {
  /** Linear extrusion by `height` along the sketch's plane normal. */
  extrude?: (height: number) => OcctShape;
  /** Revolve the sketch around an axis by `angle` (degrees, default
   *  360 in replicad). Axis defaults to Y for XZ-plane sketches. */
  revolve?: (axis?: [number, number, number], angle?: number) => OcctShape;
  /** Sweep the sketch along a polyline path expressed as a list of
   *  3D points. replicad's `sweepAlong` / `sweepSketch` API surface
   *  varies by version — handlers probe with optional method names. */
  sweepAlong?: (path: [number, number, number][]) => OcctShape;
  /** Loft between this sketch and one or more other sketches. */
  loftWith?: (others: SketchLike[]) => OcctShape;
}

/** Shape with the ops we call across files. Methods are optional
 *  because replicad versions drift; each op file probes and falls back
 *  with a clear error message rather than crashing on undefined call. */
export interface OcctShape {
  cut?: (other: OcctShape) => OcctShape;
  fuse?: (other: OcctShape) => OcctShape;
  intersect?: (other: OcctShape) => OcctShape;
  translate?: (offset: [number, number, number]) => OcctShape;
  /** Rotate the shape by `angleDeg` around an axis through `origin`
   *  with direction `direction`. Used by the circular-pattern op. */
  rotate?: (
    angleDeg: number,
    origin: [number, number, number],
    direction: [number, number, number],
  ) => OcctShape;
  /** Reflect the shape across a plane. The plane is identified by its
   *  normal axis ('X' | 'Y' | 'Z') through origin OR a plane object,
   *  depending on replicad version — handlers probe both call shapes. */
  mirror?: (...args: unknown[]) => OcctShape;
  /** Clone — needed by the linear-pattern fuse loop so we don't
   *  mutate the original shape between translations. */
  clone?: () => OcctShape;
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
