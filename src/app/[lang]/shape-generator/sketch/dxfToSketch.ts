/**
 * dxfToSketch.ts — Convert parsed DXF entities into NexyFab sketch.
 *
 * The existing `io/dxfParser.ts` parses DXF ASCII into geometric
 * primitives (LINE, ARC, CIRCLE, LWPOLYLINE, ...). This module
 * bridges those to the NexyFab **sketch model** — typed sketch
 * entities + auto-inferred coincidence / tangent / parallel
 * constraints so the imported geometry is editable, not just
 * frozen.
 *
 * The conversion:
 *
 *   1. Translate every DXF entity to a `SketchEntity`.
 *   2. Cluster nearby endpoints — if two endpoints are within
 *      `weldTolerance`, weld them into a shared sketch point.
 *   3. Detect tangency between adjacent line and arc segments
 *      (within angle tolerance).
 *   4. Detect parallels / perpendiculars between long-enough lines.
 *
 * Output is a `SketchModel` ready for the constraint solver. The
 * caller can drop / accept the inferred constraints individually.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type DxfEntity =
  | { kind: 'LINE'; start: Point2D; end: Point2D }
  | { kind: 'CIRCLE'; center: Point2D; radius: number }
  | { kind: 'ARC'; center: Point2D; radius: number; startAngle: number; endAngle: number }
  | { kind: 'LWPOLYLINE'; vertices: Point2D[]; closed?: boolean }
  | { kind: 'SPLINE'; controlPoints: Point2D[]; degree: number };

export type SketchEntityKind = 'point' | 'line' | 'arc' | 'circle' | 'spline';

export interface SketchEntity {
  id: string;
  kind: SketchEntityKind;
  /** Optional reference to a shared sketch point id (welded endpoint). */
  pointRefs?: string[];
  /** Geometry payload — kind-specific. */
  geometry: SketchEntityGeometry;
}

export type SketchEntityGeometry =
  | { kind: 'point'; position: Point2D }
  | { kind: 'line'; start: Point2D; end: Point2D }
  | { kind: 'arc'; center: Point2D; radius: number; startAngle: number; endAngle: number }
  | { kind: 'circle'; center: Point2D; radius: number }
  | { kind: 'spline'; controlPoints: Point2D[]; degree: number };

export type SketchConstraintKind =
  | 'coincident' | 'tangent' | 'parallel' | 'perpendicular'
  | 'horizontal' | 'vertical' | 'equal-length' | 'equal-radius';

export interface SketchConstraint {
  id: string;
  kind: SketchConstraintKind;
  entityIds: string[];
  /** Inferred (not user-authored). */
  inferred: true;
  /** Confidence 0..1 — UI can let user reject low-confidence. */
  confidence: number;
}

export interface SketchModel {
  entities: SketchEntity[];
  /** Shared sketch points referenced by entities. */
  points: Map<string, Point2D>;
  /** Inferred constraints. */
  constraints: SketchConstraint[];
}

export interface ConvertOptions {
  /** Distance below which endpoints weld into a shared point. */
  weldToleranceMm: number;
  /** Angle below which an arc-line junction is "tangent". */
  tangentToleranceDeg: number;
  /** Min line length for parallel/perpendicular detection. */
  minLineLengthMm: number;
  /** Angle window for parallel detection (degrees). */
  parallelToleranceDeg: number;
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
  weldToleranceMm: 0.05,
  tangentToleranceDeg: 1,
  minLineLengthMm: 1,
  parallelToleranceDeg: 0.5,
};

// ── Top-level entry ─────────────────────────────────────────────

export function dxfToSketch(
  dxfEntities: DxfEntity[],
  options: Partial<ConvertOptions> = {},
): SketchModel {
  const opts = { ...DEFAULT_CONVERT_OPTIONS, ...options };

  const points = new Map<string, Point2D>();
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  let entityCounter = 0;
  let pointCounter = 0;
  let constraintCounter = 0;

  const nextEntityId = () => `e${entityCounter++}`;
  const nextPointId = () => `p${pointCounter++}`;
  const nextConstraintId = () => `c${constraintCounter++}`;

  /** Find existing point within weld tolerance, or create one. */
  const sharedPoint = (p: Point2D): string => {
    for (const [id, existing] of points) {
      if (Math.hypot(existing.x - p.x, existing.y - p.y) < opts.weldToleranceMm) {
        return id;
      }
    }
    const id = nextPointId();
    points.set(id, { x: p.x, y: p.y });
    return id;
  };

  // ── Convert each DXF entity ────────────────────────────────
  for (const dxf of dxfEntities) {
    switch (dxf.kind) {
      case 'LINE': {
        const startId = sharedPoint(dxf.start);
        const endId = sharedPoint(dxf.end);
        entities.push({
          id: nextEntityId(),
          kind: 'line',
          pointRefs: [startId, endId],
          geometry: { kind: 'line', start: dxf.start, end: dxf.end },
        });
        break;
      }
      case 'CIRCLE': {
        entities.push({
          id: nextEntityId(),
          kind: 'circle',
          geometry: { kind: 'circle', center: dxf.center, radius: dxf.radius },
        });
        break;
      }
      case 'ARC': {
        const startPos: Point2D = {
          x: dxf.center.x + dxf.radius * Math.cos(dxf.startAngle),
          y: dxf.center.y + dxf.radius * Math.sin(dxf.startAngle),
        };
        const endPos: Point2D = {
          x: dxf.center.x + dxf.radius * Math.cos(dxf.endAngle),
          y: dxf.center.y + dxf.radius * Math.sin(dxf.endAngle),
        };
        const startId = sharedPoint(startPos);
        const endId = sharedPoint(endPos);
        entities.push({
          id: nextEntityId(),
          kind: 'arc',
          pointRefs: [startId, endId],
          geometry: { kind: 'arc', center: dxf.center, radius: dxf.radius, startAngle: dxf.startAngle, endAngle: dxf.endAngle },
        });
        break;
      }
      case 'LWPOLYLINE': {
        for (let i = 0; i < dxf.vertices.length - 1; i++) {
          const a = dxf.vertices[i]!;
          const b = dxf.vertices[i + 1]!;
          const startId = sharedPoint(a);
          const endId = sharedPoint(b);
          entities.push({
            id: nextEntityId(),
            kind: 'line',
            pointRefs: [startId, endId],
            geometry: { kind: 'line', start: a, end: b },
          });
        }
        if (dxf.closed && dxf.vertices.length >= 2) {
          const a = dxf.vertices[dxf.vertices.length - 1]!;
          const b = dxf.vertices[0]!;
          const startId = sharedPoint(a);
          const endId = sharedPoint(b);
          entities.push({
            id: nextEntityId(),
            kind: 'line',
            pointRefs: [startId, endId],
            geometry: { kind: 'line', start: a, end: b },
          });
        }
        break;
      }
      case 'SPLINE': {
        entities.push({
          id: nextEntityId(),
          kind: 'spline',
          geometry: { kind: 'spline', controlPoints: dxf.controlPoints, degree: dxf.degree },
        });
        break;
      }
    }
  }

  // ── Infer coincidence — points shared via pointRefs. ───────
  // The shared-point lookup already coincidence-welds; emit explicit
  // coincident constraints between every entity pair that touches.
  const pointToEntities = new Map<string, string[]>();
  for (const ent of entities) {
    for (const pid of ent.pointRefs ?? []) {
      const list = pointToEntities.get(pid) ?? [];
      list.push(ent.id);
      pointToEntities.set(pid, list);
    }
  }
  for (const [, ids] of pointToEntities) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        constraints.push({
          id: nextConstraintId(),
          kind: 'coincident',
          entityIds: [ids[i]!, ids[j]!],
          inferred: true,
          confidence: 1,
        });
      }
    }
  }

  // ── Infer horizontal / vertical lines ──────────────────────
  for (const ent of entities) {
    if (ent.geometry.kind !== 'line') continue;
    const dx = ent.geometry.end.x - ent.geometry.start.x;
    const dy = ent.geometry.end.y - ent.geometry.start.y;
    const len = Math.hypot(dx, dy);
    if (len < opts.minLineLengthMm) continue;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const closeTo = (target: number) => Math.abs(((angle - target + 540) % 360) - 180) < opts.parallelToleranceDeg;
    if (closeTo(0) || closeTo(180)) {
      constraints.push({
        id: nextConstraintId(),
        kind: 'horizontal',
        entityIds: [ent.id],
        inferred: true,
        confidence: 0.95,
      });
    } else if (closeTo(90) || closeTo(-90)) {
      constraints.push({
        id: nextConstraintId(),
        kind: 'vertical',
        entityIds: [ent.id],
        inferred: true,
        confidence: 0.95,
      });
    }
  }

  // ── Infer parallel / perpendicular pairs of lines ──────────
  const lineEntities = entities.filter(e => e.geometry.kind === 'line');
  for (let i = 0; i < lineEntities.length; i++) {
    for (let j = i + 1; j < lineEntities.length; j++) {
      const a = lineEntities[i]!.geometry as { kind: 'line'; start: Point2D; end: Point2D };
      const b = lineEntities[j]!.geometry as { kind: 'line'; start: Point2D; end: Point2D };
      const aLen = Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y);
      const bLen = Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y);
      if (aLen < opts.minLineLengthMm || bLen < opts.minLineLengthMm) continue;
      const angleA = Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x);
      const angleB = Math.atan2(b.end.y - b.start.y, b.end.x - b.start.x);
      let diff = Math.abs(((angleA - angleB) * 180) / Math.PI);
      diff = ((diff + 360) % 180);
      if (diff < opts.parallelToleranceDeg || Math.abs(diff - 180) < opts.parallelToleranceDeg) {
        constraints.push({
          id: nextConstraintId(),
          kind: 'parallel',
          entityIds: [lineEntities[i]!.id, lineEntities[j]!.id],
          inferred: true,
          confidence: 0.7,
        });
      } else if (Math.abs(diff - 90) < opts.parallelToleranceDeg) {
        constraints.push({
          id: nextConstraintId(),
          kind: 'perpendicular',
          entityIds: [lineEntities[i]!.id, lineEntities[j]!.id],
          inferred: true,
          confidence: 0.7,
        });
      }
    }
  }

  // ── Infer tangent line-arc at shared point ─────────────────
  for (const arc of entities) {
    if (arc.geometry.kind !== 'arc') continue;
    for (const line of entities) {
      if (line.geometry.kind !== 'line') continue;
      // Do they share a point ref?
      const shared = (arc.pointRefs ?? []).find(p => (line.pointRefs ?? []).includes(p));
      if (!shared) continue;
      // Compute tangent direction at the shared endpoint, then compare to line direction.
      const pos = points.get(shared);
      if (!pos) continue;
      const arcGeo = arc.geometry;
      const dx = pos.x - arcGeo.center.x;
      const dy = pos.y - arcGeo.center.y;
      // Tangent perpendicular to radius.
      const tangentAngle = Math.atan2(dx, -dy);
      const lineGeo = line.geometry;
      const lineAngle = Math.atan2(lineGeo.end.y - lineGeo.start.y, lineGeo.end.x - lineGeo.start.x);
      let diff = Math.abs(((lineAngle - tangentAngle) * 180) / Math.PI);
      diff = ((diff + 360) % 180);
      if (diff < opts.tangentToleranceDeg || Math.abs(diff - 180) < opts.tangentToleranceDeg) {
        constraints.push({
          id: nextConstraintId(),
          kind: 'tangent',
          entityIds: [line.id, arc.id],
          inferred: true,
          confidence: 0.8,
        });
      }
    }
  }

  // ── Infer equal-radius across circles/arcs ─────────────────
  const circular = entities.filter(e => e.geometry.kind === 'circle' || e.geometry.kind === 'arc');
  for (let i = 0; i < circular.length; i++) {
    for (let j = i + 1; j < circular.length; j++) {
      const a = circular[i]!.geometry as { radius: number };
      const b = circular[j]!.geometry as { radius: number };
      if (Math.abs(a.radius - b.radius) < opts.weldToleranceMm) {
        constraints.push({
          id: nextConstraintId(),
          kind: 'equal-radius',
          entityIds: [circular[i]!.id, circular[j]!.id],
          inferred: true,
          confidence: 0.85,
        });
      }
    }
  }

  return { entities, points, constraints };
}

// ── Stats ───────────────────────────────────────────────────────

export interface ConversionStats {
  inputEntityCount: number;
  outputEntityCount: number;
  pointCount: number;
  constraintsByKind: Record<SketchConstraintKind, number>;
}

export function summarizeConversion(input: DxfEntity[], output: SketchModel): ConversionStats {
  const bk: Record<string, number> = {};
  for (const c of output.constraints) bk[c.kind] = (bk[c.kind] ?? 0) + 1;
  return {
    inputEntityCount: input.length,
    outputEntityCount: output.entities.length,
    pointCount: output.points.size,
    constraintsByKind: bk as Record<SketchConstraintKind, number>,
  };
}
