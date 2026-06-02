/**
 * POST /api/loft-render
 *
 * Phase 2.2 bridge for loft: takes 2+ section descriptors (sketch + z),
 * runs the loftFromSketch pipeline, and renders to PNG (and optional STL)
 * via the openscad CLI infrastructure.
 *
 * Sibling of /api/extrude-render + /api/revolve-render — same validation
 * envelope, same response shape, same caps; only the per-feature math
 * differs.
 *
 * Phase 1 limitation (mirrors loftFromSketch.ts):
 *   - Each section's sketch must yield a closed loop with matching point
 *     count to all other sections (buildLoft enforces this). The minimal
 *     useful case is 2 sections that share the same sketch at different
 *     z planes.
 *
 * Request body:
 *   {
 *     sections: [{ sketch: SolverViewState, z: number }, ...],   // 2+
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
import { loftFromSketch, type LoftSectionInput } from '@/lib/sketch/loftFromSketch';
import { renderScadToPng } from '@/lib/openscad-render/renderPng';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { SweepLoftMode } from '@/lib/cad/sweepLoft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoftSectionBody {
  sketch?: SolverViewState;
  z?: number;
}

interface LoftRenderBody {
  sections?: ReadonlyArray<LoftSectionBody>;
  mode?: SweepLoftMode;
  views?: { label: string; camera: string }[];
  /** When true, also include binary STL bytes (base64) for the Three.js viewer. */
  includeStl?: boolean;
}

const MAX_POINTS = 5000;
const MAX_LINES = 5000;
const MAX_SECTIONS = 32;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isSketchShape(s: unknown): s is SolverViewState {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return Array.isArray(obj.points) && Array.isArray(obj.lines);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: LoftRenderBody;
  try {
    body = (await req.json()) as LoftRenderBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.sections) || body.sections.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: `loft needs at least 2 sections, got ${Array.isArray(body.sections) ? body.sections.length : 0}`,
      },
      { status: 400 },
    );
  }
  if (body.sections.length > MAX_SECTIONS) {
    return NextResponse.json(
      {
        ok: false,
        code: 'TOO_LARGE',
        message: `loft has ${body.sections.length} sections (max ${MAX_SECTIONS})`,
      },
      { status: 413 },
    );
  }

  // Per-section validation.
  for (let i = 0; i < body.sections.length; i++) {
    const s = body.sections[i]!;
    if (!isSketchShape(s.sketch)) {
      return NextResponse.json(
        { ok: false, code: 'BAD_REQUEST', message: `section[${i}].sketch.points and .lines required` },
        { status: 400 },
      );
    }
    if (s.sketch.points.length > MAX_POINTS) {
      return NextResponse.json(
        { ok: false, code: 'TOO_LARGE', message: `section[${i}] has ${s.sketch.points.length} points (max ${MAX_POINTS})` },
        { status: 413 },
      );
    }
    if (s.sketch.lines.length > MAX_LINES) {
      return NextResponse.json(
        { ok: false, code: 'TOO_LARGE', message: `section[${i}] has ${s.sketch.lines.length} lines (max ${MAX_LINES})` },
        { status: 413 },
      );
    }
    if (s.sketch.points.length === 0 || s.sketch.lines.length === 0) {
      return NextResponse.json(
        { ok: false, code: 'EMPTY_SKETCH', message: `section[${i}] sketch is empty` },
        { status: 400 },
      );
    }
    if (!isFiniteNum(s.z)) {
      return NextResponse.json(
        { ok: false, code: 'BAD_REQUEST', message: `section[${i}].z must be a finite number` },
        { status: 400 },
      );
    }
  }

  // Monotonic-z check (echoed by pipeline; we surface a clean 400 here
  // rather than the pipeline's 422 so the client UX matches).
  for (let i = 1; i < body.sections.length; i++) {
    if (body.sections[i]!.z! <= body.sections[i - 1]!.z!) {
      return NextResponse.json(
        {
          ok: false,
          code: 'BAD_REQUEST',
          message: `sections must be monotonically ascending in z (section ${i} z=${body.sections[i]!.z} ≤ section ${i - 1} z=${body.sections[i - 1]!.z})`,
        },
        { status: 400 },
      );
    }
  }

  if (body.mode !== undefined && body.mode !== 'add' && body.mode !== 'cut') {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: `mode must be 'add' or 'cut'` },
      { status: 400 },
    );
  }

  // Build pipeline input. Use the first section's sketch as the "primary"
  // (the pipeline expects a primarySketch + section refs).
  const primary = body.sections[0]!.sketch!;
  const sections: LoftSectionInput[] = body.sections.map((s) => ({
    source: 'external' as const,
    sketch: s.sketch!,
    z: s.z!,
  }));

  const pipeline = loftFromSketch(primary, {
    sections,
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
