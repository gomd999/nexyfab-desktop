/**
 * POST /api/fillet-render
 *
 * Phase 2.2 bridge for fillet: takes SolverSketchEditor view-state +
 * extrude depth + fillet radius + edge selection, runs the
 * filletFromSketch pipeline, and renders to PNG (and optional STL) via
 * the openscad CLI.
 *
 * Mirror of /api/shell-render and /api/extrude-render. Same validation
 * envelope, same response shape, same caps; the per-feature math is the
 * fillet-specific safety guard (0 < radius < depth/3 when top/bottom
 * edges are selected, 0 < radius < min(bboxW,bboxH)/3 always).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },     // SolverViewState
 *     depth: number,                                // 0 < depth ≤ MAX_DEPTH
 *     radius: number,                               // 0 < radius
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
import { filletFromSketch } from '@/lib/sketch/filletFromSketch';
import type { FilletEdgeSelection } from '@/lib/cad/filletProfile';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FilletRenderBody {
  sketch?: SolverViewState;
  depth?: number;
  radius?: number;
  /** Phase 3 — per-vertex radii (rect-only). Length must equal extracted
   *  loop length. Precedence: vertexRadii > edgeRadii > radius. */
  vertexRadii?: number[];
  /** Phase 3 — per-edge radii (rect-only). Auto-converted. */
  edgeRadii?: number[];
  edgeSelection?: FilletEdgeSelection;
  views?: { label: string; camera: string }[];
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;
const ALLOWED_EDGES: readonly FilletEdgeSelection[] = ['all', 'top', 'bottom', 'vertical'];

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FilletRenderBody;
  try {
    body = (await req.json()) as FilletRenderBody;
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
    Array.isArray(body.vertexRadii) || Array.isArray(body.edgeRadii);
  if (!hasVariableInput && (!isFiniteNum(body.radius) || body.radius <= 0)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'radius must be a positive number' },
      { status: 400 },
    );
  }
  // Per-vertex / per-edge arrays: structural validation only (length &
  // positivity are re-checked inside the IR builder against the actual
  // extracted loop length).
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
  const vrErr = validatePosArray(body.vertexRadii, 'vertexRadii');
  if (vrErr) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: vrErr }, { status: 400 });
  }
  const erErr = validatePosArray(body.edgeRadii, 'edgeRadii');
  if (erErr) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: erErr }, { status: 400 });
  }
  const edgeSelection: FilletEdgeSelection = body.edgeSelection ?? 'all';
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
  // Safety guard: keep radius well below depth (when top/bottom edges
  // participate) so the math layer never sees a fully-collapsed crown.
  // buildFilletFeature enforces < depth/2 in those cases; the API uses
  // a tighter < depth/3 cap so users hit a clear 400 first.
  // For variable-radius inputs the max entry is the effective probe.
  const touchesTopOrBottom =
    edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
  const effectiveMaxRadius = Array.isArray(body.vertexRadii)
    ? Math.max(...body.vertexRadii)
    : Array.isArray(body.edgeRadii)
      ? Math.max(...body.edgeRadii)
      : (body.radius as number);
  if (touchesTopOrBottom && effectiveMaxRadius >= body.depth / 3) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: `radius ${effectiveMaxRadius} must be < depth/3 = ${body.depth / 3} when filleting top/bottom edges`,
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

  const pipeline = filletFromSketch(body.sketch, {
    depth: body.depth,
    // When only variable arrays are supplied, the IR ignores `radius` but
    // the field is required by the type; fall back to the max entry so
    // any uniform-radius safety probes still see a sensible value.
    radius: isFiniteNum(body.radius) && body.radius > 0 ? body.radius : effectiveMaxRadius,
    edgeSelection,
    ...(Array.isArray(body.vertexRadii) ? { vertexRadii: body.vertexRadii } : {}),
    ...(Array.isArray(body.edgeRadii) ? { edgeRadii: body.edgeRadii } : {}),
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
