/**
 * POST /api/sweep-render
 *
 * Phase 2.2 bridge for sweep: takes SolverSketchEditor view-state + a 3D
 * polyline path + a mode flag, runs the sweepFromSketch pipeline, and
 * renders to PNG (and optional STL) via the openscad CLI infrastructure.
 *
 * Sibling of /api/revolve-render and /api/extrude-render — same validation
 * envelope, same response shape, same caps; only the per-feature math
 * differs (sweep needs path validation in 3D world space).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },     // SolverViewState
 *     path: [{ x, y, z }, ...],                    // 2+ points, no zero-length segments
 *     mode?: 'add' | 'cut',
 *     views?: { label: string; camera: string }[],
 *     includeStl?: boolean
 *   }
 *
 * Response (success):
 *   { ok: true, scad: string, pngs: { label, base64 }[], stl?: string }
 *
 * Response (error):
 *   { ok: false, code: 'BAD_REQUEST' | 'EMPTY_SKETCH' | 'PIPELINE_ERROR' | 'RENDER_ERROR' | 'TOO_LARGE' | ..., message: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { sweepFromSketch, type SweepPathPoint } from '@/lib/sketch/sweepFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { SweepLoftMode } from '@/lib/cad/sweepLoft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SweepRenderBody {
  sketch?: SolverViewState;
  path?: ReadonlyArray<SweepPathPoint>;
  mode?: SweepLoftMode;
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes (base64) for the Three.js viewer. */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
/** Path-segment cap mirrors sketch caps — keeps OpenSCAD render bounded. */
const MAX_PATH_POINTS = 1000;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validatePath(path: ReadonlyArray<SweepPathPoint> | undefined): string | null {
  if (!path || !Array.isArray(path)) {
    return 'path is required (array of {x,y,z})';
  }
  if (path.length < 2) {
    return `path must have at least 2 points, got ${path.length}`;
  }
  if (path.length > MAX_PATH_POINTS) {
    return `path has ${path.length} points (max ${MAX_PATH_POINTS})`;
  }
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!p || typeof p !== 'object') {
      return `path point ${i} must be an object {x,y,z}`;
    }
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y) || !isFiniteNum(p.z)) {
      return `path point ${i} must have finite x,y,z coordinates`;
    }
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1e-9) {
      return `path segment ${i - 1}→${i} is zero-length`;
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: SweepRenderBody;
  try {
    body = (await req.json()) as SweepRenderBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }

  if (!body.sketch || !Array.isArray(body.sketch.points) || !Array.isArray(body.sketch.lines)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'sketch.points and sketch.lines required' },
      { status: 400 },
    );
  }
  if (body.sketch.points.length > MAX_POINTS) {
    return NextResponse.json(
      { ok: false, code: 'TOO_LARGE', message: `Sketch has ${body.sketch.points.length} points (max ${MAX_POINTS})` },
      { status: 413 },
    );
  }
  if (body.sketch.lines.length > MAX_LINES) {
    return NextResponse.json(
      { ok: false, code: 'TOO_LARGE', message: `Sketch has ${body.sketch.lines.length} lines (max ${MAX_LINES})` },
      { status: 413 },
    );
  }

  const pathError = validatePath(body.path);
  if (pathError) {
    // path-too-large returns 413 like the sketch caps; everything else is 400.
    const tooLarge = pathError.includes(`max ${MAX_PATH_POINTS}`);
    return NextResponse.json(
      { ok: false, code: tooLarge ? 'TOO_LARGE' : 'BAD_REQUEST', message: pathError },
      { status: tooLarge ? 413 : 400 },
    );
  }

  if (body.mode !== undefined && body.mode !== 'add' && body.mode !== 'cut') {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `mode must be 'add' or 'cut'` },
      { status: 400 },
    );
  }

  if (body.sketch.points.length === 0 || body.sketch.lines.length === 0) {
    return NextResponse.json(
      { ok: false, code: 'EMPTY_SKETCH', message: 'sketch is empty' },
      { status: 400 },
    );
  }

  // Phase 2.2 pipeline: state → SCAD source.
  const pipeline = sweepFromSketch(body.sketch, {
    path: body.path!,
    mode: body.mode,
  });
  if (!pipeline.ok) {
    return NextResponse.json(
      { ok: false, code: 'PIPELINE_ERROR', message: pipeline.error },
      { status: 422 },
    );
  }

  // Render via existing openscad CLI infra.
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
    danglingLines: pipeline.danglingLines,
    pngs: render.views.map((v) => ({ label: v.label, base64: v.bytes.toString('base64') })),
    ...(stlBase64 ? { stl: stlBase64 } : {}),
  });
}
