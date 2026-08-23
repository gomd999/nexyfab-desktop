/**
 * POST /api/shell-render
 *
 * Phase 2.4 bridge for shell: takes SolverSketchEditor view-state + extrude
 * depth + wall thickness + open-face flags, runs the shellFromSketch
 * pipeline, and renders to PNG (and optional STL) via the openscad CLI.
 *
 * Sibling of /api/extrude-render and /api/sweep-render — same validation
 * envelope, same response shape, same caps; the per-feature math is the
 * shell-specific safety guard (0 < thickness < depth/3).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },     // SolverViewState
 *     depth: number,                                // 0 < depth ≤ MAX_DEPTH
 *     thickness: number,                            // 0 < thickness < depth/3
 *     openTop?: boolean,
 *     openBottom?: boolean,
 *     mode?: 'add' | 'cut',                         // accepted for API
 *                                                   //   parity; shell always
 *                                                   //   emits as additive
 *                                                   //   (the boolean is the
 *                                                   //   internal hollow)
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
import { shellFromSketch } from '@/lib/sketch/shellFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ShellRenderBody {
  sketch?: SolverViewState;
  depth?: number;
  thickness?: number;
  openTop?: boolean;
  openBottom?: boolean;
  mode?: 'add' | 'cut';
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes in the response (base64). */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ShellRenderBody;
  try {
    body = await readBoundedJson<ShellRenderBody>(req, MAX_BODY_BYTES);
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
  if (!isFiniteNum(body.depth) || body.depth <= 0 || body.depth > MAX_DEPTH) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `depth must be a positive number ≤ ${MAX_DEPTH}` },
      { status: 400 },
    );
  }
  if (!isFiniteNum(body.thickness) || body.thickness <= 0) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'thickness must be a positive number' },
      { status: 400 },
    );
  }
  // Safety guard: keep thickness well below depth so even with open faces
  // there's geometry left. shellProfile.buildShellFromExtrude enforces
  // < depth/2 when opening a face, but the API uses a tighter < depth/3
  // cap so users hit a clear 400 before reaching the math layer.
  if (body.thickness >= body.depth / 3) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: `thickness ${body.thickness} must be < depth/3 = ${body.depth / 3}`,
      },
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

  const pipeline = shellFromSketch(body.sketch, {
    depth: body.depth,
    thickness: body.thickness,
    openTopFace: body.openTop,
    openBottomFace: body.openBottom,
  });
  if (!pipeline.ok) {
    return NextResponse.json(
      { ok: false, code: 'PIPELINE_ERROR', message: pipeline.error },
      { status: 422 },
    );
  }

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
