/**
 * POST /api/hole-render
 *
 * Phase 2.7 bridge: takes SolverSketchEditor view-state + parent extrude
 * depth + an array of hole requests, runs the holesFromSketch pipeline,
 * and renders to PNG (and optional STL) via the existing openscad CLI
 * infrastructure.
 *
 * Sibling of /api/extrude-render and /api/sweep-render — same validation
 * envelope, same response shape, same caps; only the per-feature math
 * differs (holes need per-hole sketch-point lookup + dimension validation).
 *
 * Request body:
 *   {
 *     sketch: { points: [...], lines: [...] },     // SolverViewState
 *     extrudeDepth: number,                         // parent body thickness, mm
 *     holes: [{                                     // 1..MAX_HOLES
 *       pointId: string,                            // must exist in sketch.points
 *       holeType: 'drilled' | 'counterbore' | 'countersink',
 *       diameter: number,
 *       depth: number,
 *       counterboreDiameter?: number,
 *       counterboreDepth?: number,
 *       countersinkAngleDegrees?: number,
 *       countersinkDepth?: number,
 *     }],
 *     views?: { label: string; camera: string }[],
 *     includeStl?: boolean
 *   }
 *
 * Response (success):
 *   { ok: true, scad: string, holeCount: number, pngs: { label, base64 }[], stl?: string }
 *
 * Response (error):
 *   { ok: false, code: 'BAD_REQUEST' | 'EMPTY_SKETCH' | 'PIPELINE_ERROR' | 'RENDER_ERROR' | 'TOO_LARGE' | 'ENOENT' | ..., message: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { holesFromSketch, type HoleRequest } from '@/lib/sketch/holesFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HoleRenderBody {
  sketch?: SolverViewState;
  extrudeDepth?: number;
  holes?: ReadonlyArray<HoleRequest>;
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes (base64) for the Three.js viewer. */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_DEPTH = 10_000;
/** Hole count cap mirrors sketch caps — keeps OpenSCAD render bounded. */
const MAX_HOLES = 200;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validateHoles(
  holes: ReadonlyArray<HoleRequest> | undefined,
): string | null {
  if (!holes || !Array.isArray(holes)) {
    return 'holes is required (array)';
  }
  if (holes.length === 0) {
    return 'at least 1 hole is required';
  }
  if (holes.length > MAX_HOLES) {
    return `holes has ${holes.length} entries (max ${MAX_HOLES})`;
  }
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    if (!h || typeof h !== 'object') {
      return `hole ${i + 1} must be an object`;
    }
    if (typeof h.pointId !== 'string' || h.pointId.length === 0) {
      return `hole ${i + 1}: pointId is required (non-empty string)`;
    }
    if (h.holeType !== 'drilled' && h.holeType !== 'counterbore' && h.holeType !== 'countersink') {
      return `hole ${i + 1}: holeType must be 'drilled' | 'counterbore' | 'countersink'`;
    }
    if (!isFiniteNum(h.diameter) || h.diameter <= 0) {
      return `hole ${i + 1}: diameter must be a positive number`;
    }
    if (!isFiniteNum(h.depth) || h.depth <= 0) {
      return `hole ${i + 1}: depth must be a positive number`;
    }
    if (h.holeType === 'counterbore') {
      if (!isFiniteNum(h.counterboreDiameter) || (h.counterboreDiameter as number) <= 0) {
        return `hole ${i + 1}: counterbore requires counterboreDiameter > 0`;
      }
      if (!isFiniteNum(h.counterboreDepth) || (h.counterboreDepth as number) <= 0) {
        return `hole ${i + 1}: counterbore requires counterboreDepth > 0`;
      }
    }
    if (h.holeType === 'countersink') {
      if (!isFiniteNum(h.countersinkAngleDegrees)) {
        return `hole ${i + 1}: countersink requires countersinkAngleDegrees`;
      }
      if (!isFiniteNum(h.countersinkDepth) || (h.countersinkDepth as number) <= 0) {
        return `hole ${i + 1}: countersink requires countersinkDepth > 0`;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: HoleRenderBody;
  try {
    body = await readBoundedJson<HoleRenderBody>(req, MAX_BODY_BYTES);
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
  if (!isFiniteNum(body.extrudeDepth) || body.extrudeDepth <= 0 || body.extrudeDepth > MAX_DEPTH) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `extrudeDepth must be a positive number ≤ ${MAX_DEPTH}` },
      { status: 400 },
    );
  }

  const holesError = validateHoles(body.holes);
  if (holesError) {
    const tooLarge = holesError.includes(`max ${MAX_HOLES}`);
    return NextResponse.json(
      { ok: false, code: tooLarge ? 'TOO_LARGE' : 'BAD_REQUEST', message: holesError },
      { status: tooLarge ? 413 : 400 },
    );
  }

  if (body.sketch.points.length === 0 || body.sketch.lines.length === 0) {
    return NextResponse.json(
      { ok: false, code: 'EMPTY_SKETCH', message: 'sketch is empty' },
      { status: 400 },
    );
  }

  // Phase 2.7 pipeline: state → SCAD source.
  const pipeline = holesFromSketch(body.sketch, {
    extrudeDepth: body.extrudeDepth!,
    holes: body.holes!,
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
    holeCount: pipeline.holeCount,
    danglingLines: pipeline.danglingLines,
    pngs: render.views.map((v) => ({ label: v.label, base64: v.bytes.toString('base64') })),
    ...(stlBase64 ? { stl: stlBase64 } : {}),
  });
}
