/**
 * POST /api/revolve-render
 *
 * Phase 2.A bridge for revolve: takes SolverSketchEditor view-state + an
 * axis line + a sweep angle, runs the revolveFromSketch pipeline, and
 * renders to PNG (and optional STL) via the openscad CLI infrastructure.
 *
 * Sibling of /api/extrude-render — same validation envelope, same response
 * shape, same caps; only the per-feature math differs.
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },   // SolverViewState
 *     axis: { a: { x, y }, b: { x, y } },        // AxisLine2D in sketch coords
 *     angleDegrees?: number,                     // (0, 360], default 360
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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { revolveFromSketch } from '@/lib/sketch/revolveFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { AxisLine2D, RevolveMode } from '@/lib/cad/revolveProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RevolveRenderBody {
  sketch?: SolverViewState;
  axis?: AxisLine2D;
  angleDegrees?: number;
  mode?: RevolveMode;
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes (base64) for the Three.js viewer. */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validateAxis(axis: AxisLine2D | undefined): string | null {
  if (!axis || typeof axis !== 'object') {
    return 'axis is required ({ a: {x,y}, b: {x,y} })';
  }
  if (!axis.a || !axis.b) {
    return 'axis.a and axis.b are required';
  }
  if (
    !isFiniteNum(axis.a.x) || !isFiniteNum(axis.a.y) ||
    !isFiniteNum(axis.b.x) || !isFiniteNum(axis.b.y)
  ) {
    return 'axis coordinates must be finite numbers';
  }
  if (Math.hypot(axis.b.x - axis.a.x, axis.b.y - axis.a.y) < 1e-9) {
    return 'axis points are coincident';
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RevolveRenderBody;
  try {
    body = await readBoundedJson<RevolveRenderBody>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: `Body exceeds ${MAX_BODY_BYTES} bytes` }, { status: 413 });
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

  const axisError = validateAxis(body.axis);
  if (axisError) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: axisError },
      { status: 400 },
    );
  }

  // angleDegrees default = 360. Validate range if supplied.
  const angle = body.angleDegrees ?? 360;
  if (!isFiniteNum(angle) || angle <= 0 || angle > 360) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `angleDegrees must be in (0, 360], got ${angle}` },
      { status: 400 },
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

  // Phase 2.A pipeline: state → SCAD source.
  const pipeline = revolveFromSketch(body.sketch, {
    axis: body.axis!,
    angleDegrees: angle,
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
