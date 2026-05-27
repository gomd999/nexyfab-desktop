/**
 * sketch3dEntity.ts — Entities for 3D sketching.
 *
 * 2D sketches in NexyFab live on a plane. 3D sketches live in
 * world space — points, lines, arcs, splines can have any
 * orientation. Used to draw sweep paths, weldment members,
 * routing for cables / pipes, and helix axes.
 *
 * Each entity has a stable id so constraints can reference it.
 * The container Sketch3D holds the entity list + a free-DOF
 * counter that the constraint solver uses.
 */

export interface Point3D {
  id: string;
  x: number; y: number; z: number;
  /** When true, the solver leaves this point alone. */
  fixed?: boolean;
}

export interface Line3D {
  id: string;
  startId: string;
  endId: string;
}

export interface Arc3D {
  id: string;
  centerId: string;
  /** Two points on the arc — start + end. */
  startId: string;
  endId: string;
  /** Plane normal (unit). The arc lives in the plane through center
   *  perpendicular to this normal. */
  normal: [number, number, number];
}

export interface Spline3D {
  id: string;
  /** Control point ids — at least 2. */
  controlPointIds: string[];
  /** Degree (default 3). */
  degree?: number;
}

export type Sketch3DEntity = Point3D | Line3D | Arc3D | Spline3D;

export interface Sketch3D {
  id: string;
  /** Indexed by entity id for O(1) lookup. */
  entities: Map<string, Sketch3DEntity>;
}

/** Build an empty Sketch3D. */
export function createSketch3D(id: string): Sketch3D {
  return { id, entities: new Map() };
}

/** Type narrowing helpers. */
export function isPoint(e: Sketch3DEntity): e is Point3D {
  return 'x' in e && 'y' in e && 'z' in e;
}
export function isLine(e: Sketch3DEntity): e is Line3D {
  return 'startId' in e && 'endId' in e && !('centerId' in e);
}
export function isArc(e: Sketch3DEntity): e is Arc3D {
  return 'centerId' in e;
}
export function isSpline(e: Sketch3DEntity): e is Spline3D {
  return 'controlPointIds' in e;
}

/** Add an entity. Throws if id already exists. */
export function addEntity(sketch: Sketch3D, entity: Sketch3DEntity): void {
  if (sketch.entities.has(entity.id)) {
    throw new Error(`Sketch3D entity id "${entity.id}" already exists`);
  }
  sketch.entities.set(entity.id, entity);
}

/** Remove an entity by id. Returns true on success. */
export function removeEntity(sketch: Sketch3D, id: string): boolean {
  return sketch.entities.delete(id);
}

/** Helper: convert all entities to a flat array. */
export function listEntities(sketch: Sketch3D): Sketch3DEntity[] {
  return Array.from(sketch.entities.values());
}

/** Helper: count entities by kind. */
export function entityCounts(sketch: Sketch3D): {
  points: number; lines: number; arcs: number; splines: number;
} {
  let points = 0, lines = 0, arcs = 0, splines = 0;
  for (const e of sketch.entities.values()) {
    if (isPoint(e)) points++;
    else if (isLine(e)) lines++;
    else if (isArc(e)) arcs++;
    else if (isSpline(e)) splines++;
  }
  return { points, lines, arcs, splines };
}

/** Look up a point by id. */
export function getPoint(sketch: Sketch3D, id: string): Point3D | null {
  const e = sketch.entities.get(id);
  return e && isPoint(e) ? e : null;
}

/** Compute total free DOFs in the sketch (used by solver). */
export function freeDofs(sketch: Sketch3D): number {
  let dof = 0;
  for (const e of sketch.entities.values()) {
    if (isPoint(e) && !e.fixed) dof += 3;
  }
  return dof;
}
