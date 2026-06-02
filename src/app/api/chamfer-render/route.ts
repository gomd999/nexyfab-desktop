/**
 * POST /api/chamfer-render
 *
 * Phase 2.2 bridge for chamfer. Mirror of /api/fillet-render; the
 * per-feature math is the chamfer-specific safety guard (0 < distance
 * < depth/3 when top/bottom edges are selected).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },     // SolverViewState
 *     depth: number,                                // 0 < depth ≤ MAX_DEPTH
 *     distance: number,                             // 0 < distance
 *     edgeSelection?: 'all'|'top'|'bottom'|'vertical', // default 'all'
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
import { chamferFromSketch } from '@/lib/sketch/chamferFromSketch';
import type { ChamferEdgeSelection } from '@/lib/cad/chamferProfile';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChamferRenderBody {
  sketch?: SolverViewState;
  depth?: number;
  distance?: number;
  /** Phase 3 — per-vertex chamfer distances (rect-only). */
  vertexDistances?: number[];
  /** Phase 3 — per-edge chamfer distances (rect-only). */
  edgeDistances?: number[];
  edgeSelection?: ChamferEdgeSelection;
  views?: { label: string; camera: string }[];
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;
const ALLOWED_EDGES: readonly ChamferEdgeSelection[] = ['all', 'top', 'bottom', 'vertical'];

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChamferRenderBody;
  try {
    body = (await req.json()) as ChamferRenderBody;
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
  if (!isFiniteNum(body.depth) || body.depth <= 0 || body.depth > MAX_DEPTH) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `depth must be a positive number ≤ ${MAX_DEPTH}` },
      { status: 400 },
    );
  }
  const hasVariableInput =
    Array.isArray(body.vertexDistances) || Array.isArray(body.edgeDistances);
  if (!hasVariableInput && (!isFiniteNum(body.distance) || body.distance <= 0)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'distance must be a positive number' },
      { status: 400 },
    );
  }
  const validatePosArray = (arr: unknown, label: string): string | null => {
    if (!Array.isArray(arr)) return null;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        return `${label}[${i}] must be a positive finite number`;
      }
    }
    return null;
  };
  const vdErr = validatePosArray(body.vertexDistances, 'vertexDistances');
  if (vdErr) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: vdErr }, { status: 400 });
  }
  const edErr = validatePosArray(body.edgeDistances, 'edgeDistances');
  if (edErr) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: edErr }, { status: 400 });
  }
  const edgeSelection: ChamferEdgeSelection = body.edgeSelection ?? 'all';
  if (!ALLOWED_EDGES.includes(edgeSelection)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: `edgeSelection must be one of ${ALLOWED_EDGES.join('|')}`,
      },
      { status: 400 },
    );
  }
  const touchesTopOrBottom =
    edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
  const effectiveMaxDistance = Array.isArray(body.vertexDistances)
    ? Math.max(...body.vertexDistances)
    : Array.isArray(body.edgeDistances)
      ? Math.max(...body.edgeDistances)
      : (body.distance as number);
  if (touchesTopOrBottom && effectiveMaxDistance >= body.depth / 3) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: `distance ${effectiveMaxDistance} must be < depth/3 = ${body.depth / 3} when chamfering top/bottom edges`,
      },
      { status: 400 },
    );
  }

  if (body.sketch.points.length === 0 || body.sketch.lines.length === 0) {
    return NextResponse.json(
      { ok: false, code: 'EMPTY_SKETCH', message: 'sketch is empty' },
      { status: 400 },
    );
  }

  const pipeline = chamferFromSketch(body.sketch, {
    depth: body.depth,
    distance: isFiniteNum(body.distance) && body.distance > 0 ? body.distance : effectiveMaxDistance,
    edgeSelection,
    ...(Array.isArray(body.vertexDistances) ? { vertexDistances: body.vertexDistances } : {}),
    ...(Array.isArray(body.edgeDistances) ? { edgeDistances: body.edgeDistances } : {}),
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
  }

  return NextResponse.json({
    ok: true,
    scad: pipeline.scad,
    danglingLines: pipeline.danglingLines,
    pngs: render.views.map((v) => ({ label: v.label, base64: v.bytes.toString('base64') })),
    ...(stlBase64 ? { stl: stlBase64 } : {}),
  });
}
