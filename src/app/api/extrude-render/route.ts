/**
 * POST /api/extrude-render
 *
 * Phase 2.A bridge: takes SolverSketchEditor view-state + extrude depth,
 * builds the SCAD pipeline (Phase 2.A.2 extrudeFromSketch), and renders
 * to PNG via the existing OpenSCAD CLI infrastructure (renderScadToPng).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },   // SolverViewState
 *     depth: number,
 *     draftDegrees?: number,
 *     direction?: 'one_sided' | 'two_sided' | 'midplane',
 *     mode?: 'add' | 'cut',
 *     views?: { label: string; camera: string }[]  // optional camera overrides
 *   }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     scad: string,
 *     pngs: { label: string; base64: string }[]
 *   }
 *
 * Response (error):
 *   { ok: false, code: 'EMPTY_SKETCH' | 'PIPELINE_ERROR' | 'RENDER_ERROR' | 'TOO_LARGE' | ..., message: string }
 *
 * Auth: requires a logged-in session (any tier). Rate-limited per user.
 * The OpenSCAD CLI is a finite resource; we cap to 16MB SCAD source and
 * 30s render timeout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extrudeFromSketch } from '@/lib/sketch/extrudeFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ExtrudeRenderBody {
  sketch?: SolverViewState;
  depth?: number;
  draftDegrees?: number;
  direction?: 'one_sided' | 'two_sided' | 'midplane';
  mode?: 'add' | 'cut';
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes in the response (base64).
   *  Powers the interactive Three.js viewer (StlViewer). */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ExtrudeRenderBody;
  try {
    body = (await req.json()) as ExtrudeRenderBody;
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
  if (typeof body.depth !== 'number' || !Number.isFinite(body.depth) || body.depth <= 0 || body.depth > MAX_DEPTH) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `depth must be a positive number ≤ ${MAX_DEPTH}` },
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
  const pipeline = extrudeFromSketch(body.sketch, {
    depth: body.depth,
    draftDegrees: body.draftDegrees,
    direction: body.direction,
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
