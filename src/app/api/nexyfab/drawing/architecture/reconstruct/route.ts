import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { architectureReconstructionUnifiedProject, reconstructArchitectureDrawing } from '@/lib/ai/architectureDrawingReconstruction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const authoritative = z.object({
  value: z.number().finite(),
  authoritative: z.boolean(),
  sourceRef: z.string().trim().min(1).max(500),
}).strict();
const annotation = z.object({
  id: z.string().trim().min(1).max(200),
  track: z.enum(['STR', 'SPA', 'OBJ', 'OCR']),
  category: z.string().trim().min(1).max(200),
  confidence: z.number().min(0).max(1),
  sourceRef: z.string().trim().min(1).max(500),
  polygonPx: z.array(point).min(3).max(10_000).optional(),
  bboxPx: z.tuple([z.number().finite(), z.number().finite(), z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  text: z.string().max(10_000).optional(),
  quarantined: z.boolean().optional(),
}).strict().refine(value => value.polygonPx !== undefined || value.bboxPx !== undefined, { message: 'polygonPx or bboxPx is required' });
const requestSchema = z.object({
  input: z.object({
    drawingId: z.string().trim().min(1).max(200),
    widthPx: z.number().finite().positive().max(100_000),
    heightPx: z.number().finite().positive().max(100_000),
    annotations: z.array(annotation).min(1).max(20_000),
    scale: z.object({ pixelDistance: z.number().finite().positive(), realDistanceMm: z.number().finite().positive(), authoritative: z.boolean(), sourceRef: z.string().trim().min(1).max(500) }).strict().optional(),
    minimumConfidence: z.number().min(0).max(1).optional(),
    reprojectionTolerancePx: z.number().finite().nonnegative().max(100).optional(),
  }).strict(),
  requirements: z.object({
    storeyHeightMm: authoritative, wallThicknessMm: authoritative, slabThicknessMm: authoritative,
    ceilingElevationMm: authoritative, doorHeightMm: authoritative, windowHeightMm: authoritative,
    windowSillMm: authoritative, openingHostToleranceMm: authoritative, wallEvidenceToleranceMm: authoritative,
  }).strict(),
}).strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 15_000_000) return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  const ip = getTrustedClientIp(req.headers);
  const limit = rateLimit(`architecture-reconstruct:${ip}`, 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });

  let unknownBody: unknown;
  try { unknownBody = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const parsed = requestSchema.safeParse(unknownBody);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, { status: 400 });

  const result = reconstructArchitectureDrawing(parsed.data.input, parsed.data.requirements);
  const canonical = architectureReconstructionUnifiedProject(result, `drawing-${parsed.data.input.drawingId}`);
  const status = result.status === 'ready_for_exact_3d' ? 200 : result.status === 'blocked' ? 422 : 409;
  return NextResponse.json({ ok: result.status === 'ready_for_exact_3d' && canonical.issues.length === 0, ...result, unifiedProject: canonical.project, canonicalIssues: canonical.issues }, { status });
}
