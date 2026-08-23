/**
 * POST /api/pattern-render
 *
 * Phase 2.4 bridge for linear / circular patterns: takes SolverSketchEditor
 * view-state + a child extrude depth + pattern params, runs the
 * linearPatternFromSketch / circularPatternFromSketch pipeline, and renders
 * to PNG (and optional STL) via the openscad CLI infrastructure.
 *
 * Sibling of /api/extrude-render and /api/revolve-render — same validation
 * envelope and response shape; only the per-feature math differs.
 *
 * Request body (discriminated by `kind`):
 *
 *   Linear:
 *     {
 *       kind: 'linear',
 *       sketch: { points: [...], lines: [...] },
 *       child: { depth: number },
 *       count: number,                       // 1..100
 *       direction: { x, y, z },
 *       spacing: number,                     // > 0
 *       views?, includeStl?
 *     }
 *
 *   Circular:
 *     {
 *       kind: 'circular',
 *       sketch: { points: [...], lines: [...] },
 *       child: { depth: number },
 *       count: number,                       // 2..100
 *       axisOrigin: { x, y, z },
 *       axisDirection: { x, y, z },
 *       totalAngleDegrees?: number,          // (0, 360], default 360
 *       views?, includeStl?
 *     }
 *
 * Response (success):
 *   { ok: true, scad: string, featureTree: FeatureTree, pngs: { label, base64 }[], stl?: string }
 *
 * Response (error):
 *   { ok: false, code: 'BAD_REQUEST' | 'EMPTY_SKETCH' | 'PIPELINE_ERROR' | 'TOO_LARGE' | ..., message: string }
 *
 * Validation note: `count` is capped at 100 in the API (perf safety) while
 * the underlying IR allows up to 1000 — the API talks to the openscad CLI
 * which scales poorly with hundreds of polygons, so we keep the
 * user-facing cap conservative.
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import {
  linearPatternFromSketch,
  circularPatternFromSketch,
} from '@/lib/sketch/patternFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { Vec3D } from '@/lib/cad/pattern';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatternRenderBodyCommon {
  sketch?: SolverViewState;
  child?: { depth?: number };
  views?: { label: string; camera: string }[];
  includeStl?: boolean;
}

interface LinearPatternRenderBody extends PatternRenderBodyCommon {
  kind: 'linear';
  count?: number;
  direction?: Vec3D;
  spacing?: number;
}

interface CircularPatternRenderBody extends PatternRenderBodyCommon {
  kind: 'circular';
  count?: number;
  axisOrigin?: Vec3D;
  axisDirection?: Vec3D;
  totalAngleDegrees?: number;
}

type PatternRenderBody = LinearPatternRenderBody | CircularPatternRenderBody;

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;
/** Lower than IR cap (1000) — openscad CLI scales poorly past ~100 copies. */
const MAX_COUNT = 100;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isFiniteVec3(v: unknown): v is Vec3D {
  return (
    !!v &&
    typeof v === 'object' &&
    isFiniteNum((v as Vec3D).x) &&
    isFiniteNum((v as Vec3D).y) &&
    isFiniteNum((v as Vec3D).z)
  );
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message }, { status: 400 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PatternRenderBody;
  try {
    body = await readBoundedJson<PatternRenderBody>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: `Body exceeds ${MAX_BODY_BYTES} bytes` }, { status: 413 });
    return badRequest('Body must be valid JSON');
  }

  if (body.kind !== 'linear' && body.kind !== 'circular') {
    return badRequest(`kind must be 'linear' or 'circular'`);
  }

  // ─── sketch validation (shared) ──────────────────────────────────────
  if (!body.sketch || !Array.isArray(body.sketch.points) || !Array.isArray(body.sketch.lines)) {
    return badRequest('sketch.points and sketch.lines required');
  }
  if (body.sketch.points.length > MAX_POINTS) {
    return NextResponse.json(
      {
        ok: false,
        code: 'TOO_LARGE',
        message: `Sketch has ${body.sketch.points.length} points (max ${MAX_POINTS})`,
      },
      { status: 413 },
    );
  }
  if (body.sketch.lines.length > MAX_LINES) {
    return NextResponse.json(
      {
        ok: false,
        code: 'TOO_LARGE',
        message: `Sketch has ${body.sketch.lines.length} lines (max ${MAX_LINES})`,
      },
      { status: 413 },
    );
  }

  // ─── child extrude depth (shared) ────────────────────────────────────
  const depth = body.child?.depth;
  if (!isFiniteNum(depth) || depth <= 0 || depth > MAX_DEPTH) {
    return badRequest(`child.depth must be a positive number ≤ ${MAX_DEPTH}`);
  }

  if (body.sketch.points.length === 0 || body.sketch.lines.length === 0) {
    return NextResponse.json(
      { ok: false, code: 'EMPTY_SKETCH', message: 'sketch is empty' },
      { status: 400 },
    );
  }

  // ─── per-kind validation + pipeline ──────────────────────────────────
  let pipeline;
  if (body.kind === 'linear') {
    const count = body.count;
    if (!isFiniteNum(count) || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      return badRequest(`count must be an integer in [1, ${MAX_COUNT}]`);
    }
    if (!isFiniteNum(body.spacing) || body.spacing <= 0) {
      return badRequest('spacing must be a positive number');
    }
    if (!isFiniteVec3(body.direction)) {
      return badRequest('direction must be { x, y, z } finite numbers');
    }
    const dLen = Math.hypot(body.direction.x, body.direction.y, body.direction.z);
    if (dLen < 1e-9) {
      return badRequest('direction is zero-length');
    }
    pipeline = linearPatternFromSketch(body.sketch, {
      child: { depth },
      count,
      direction: body.direction,
      spacing: body.spacing,
    });
  } else {
    const count = body.count;
    if (!isFiniteNum(count) || !Number.isInteger(count) || count < 2 || count > MAX_COUNT) {
      return badRequest(`count must be an integer in [2, ${MAX_COUNT}]`);
    }
    if (!isFiniteVec3(body.axisOrigin)) {
      return badRequest('axisOrigin must be { x, y, z } finite numbers');
    }
    if (!isFiniteVec3(body.axisDirection)) {
      return badRequest('axisDirection must be { x, y, z } finite numbers');
    }
    const dLen = Math.hypot(
      body.axisDirection.x,
      body.axisDirection.y,
      body.axisDirection.z,
    );
    if (dLen < 1e-9) {
      return badRequest('axisDirection is zero-length');
    }
    const angle = body.totalAngleDegrees ?? 360;
    if (!isFiniteNum(angle) || angle <= 0 || angle > 360) {
      return badRequest(`totalAngleDegrees must be in (0, 360], got ${angle}`);
    }
    pipeline = circularPatternFromSketch(body.sketch, {
      child: { depth },
      count,
      axisOrigin: body.axisOrigin,
      axisDirection: body.axisDirection,
      totalAngleDegrees: angle,
    });
  }

  if (!pipeline.ok) {
    return NextResponse.json(
      { ok: false, code: 'PIPELINE_ERROR', message: pipeline.error },
      { status: 422 },
    );
  }

  // ─── render ──────────────────────────────────────────────────────────
  const render = await renderScadToPng({
    scadSource: pipeline.scad,
    views: body.views,
  });
  if (!render.ok) {
    return NextResponse.json(
      { ok: false, code: render.code, message: render.message },
      { status: render.code === 'ENOENT' ? 503 : 500 },
    );
  }

  let stlBase64: string | undefined;
  if (body.includeStl) {
    const stl = await renderScadToStl({ scadSource: pipeline.scad });
    if (stl.ok) {
      stlBase64 = stl.bytes.toString('base64');
    }
    // STL failure isn't fatal — caller still gets PNG previews.
  }

  return NextResponse.json({
    ok: true,
    scad: pipeline.scad,
    featureTree: pipeline.tree,
    danglingLines: pipeline.danglingLines,
    pngs: render.views.map((v) => ({ label: v.label, base64: v.bytes.toString('base64') })),
    ...(stlBase64 ? { stl: stlBase64 } : {}),
  });
}
