/**
 * POST /api/nexyfab/verify-spec
 *
 * Render the supplied SCAD via OpenSCAD CLI, parse the STL, and run the
 * full spec-verification battery (bbox / hole count / volume / surface area /
 * hole positions / fillet / threads / intent self-consistency) against the
 * supplied intent. Returns a SpecVerificationResult the client renders via
 * VerifySpecPanel.
 *
 * The intent the caller passes is the user's "what I asked for" snapshot
 * — typically the same intent that produced the SCAD via scad-intent-from-nl,
 * but verify-spec also works on hand-authored SCAD as long as the caller
 * supplies a plausible intent shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { runOpenScadCli } from '@/lib/openscad-render/runOpenScadCli';
import { verifyStlBuffer } from '@/lib/ai/scad-agent/serverAdapters';
import {
  verifyAgainstSpec,
  type SpecVerificationResult,
} from '@/lib/ai/scad-agent/specVerification';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hard cap on incoming SCAD source. Matches the panel's "verify against my
 *  current editor" use case; long-form library files belong on the async
 *  render path, not on this synchronous verify route. */
const MAX_SCAD_BYTES = 100_000;
/** Per (ip,user) hourly cap. Verify is heavier than scad-intent-from-nl
 *  (CLI render + STL parse + topology checks) so we cap it more conservatively. */
const RATE_LIMIT_PER_HOUR = 60;

interface ErrorResponse {
  ok: false;
  error: string;
  code?: string;
}

interface SuccessResponse {
  ok: true;
  result: SpecVerificationResult;
}

function err(message: string, status: number, code?: string): NextResponse<ErrorResponse> {
  return NextResponse.json<ErrorResponse>(
    code ? { ok: false, error: message, code } : { ok: false, error: message },
    { status },
  );
}

/** Narrow an arbitrary body.intent into a structurally-valid IntentInput. We
 *  intentionally don't reject extra keys — verifyAgainstSpec inspects only
 *  the fields it knows about. */
function parseIntent(raw: unknown): IntentInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.shapeId !== 'string' || r.shapeId.length === 0) return null;
  const params: Record<string, number> =
    r.params && typeof r.params === 'object' && !Array.isArray(r.params)
      ? (r.params as Record<string, number>)
      : {};
  const features = Array.isArray(r.features)
    ? (r.features as IntentInput['features'])
    : undefined;
  const facets = typeof r.facets === 'number' ? r.facets : undefined;
  return {
    shapeId: r.shapeId,
    params,
    ...(features ? { features } : {}),
    ...(facets !== undefined ? { facets } : {}),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse<ErrorResponse | SuccessResponse>> {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) {
    return planCheck.response as NextResponse<ErrorResponse>;
  }

  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`verify-spec:${ip}:${planCheck.userId}`, RATE_LIMIT_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return err('Rate limit exceeded', 429, 'RATE_LIMIT');
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const scad = typeof body.scad === 'string' ? body.scad : '';
  if (!scad.trim()) {
    return err('scad source is required', 400, 'SCAD_REQUIRED');
  }
  if (Buffer.byteLength(scad, 'utf8') > MAX_SCAD_BYTES) {
    return err(`scad exceeds ${MAX_SCAD_BYTES} bytes`, 400, 'SCAD_TOO_LARGE');
  }
  const intent = parseIntent(body.intent);
  if (!intent) {
    return err('intent must be an object with a string shapeId', 400, 'INTENT_INVALID');
  }

  // Render synchronously — the verify use-case is a single-shot, panel-bound
  // interaction. Long-running renders should use the async pipeline.
  const render = await runOpenScadCli({ scadSource: scad, format: 'stl' });
  if (!render.ok) {
    const stderr = 'stderr' in render && render.stderr ? `\n${render.stderr}` : '';
    return err(`OpenSCAD render failed: ${render.message}${stderr}`, 502, render.code);
  }

  let stats: Awaited<ReturnType<typeof verifyStlBuffer>>;
  try {
    stats = await verifyStlBuffer(render.buffer);
  } catch (e) {
    return err(`STL verification failed: ${e instanceof Error ? e.message : String(e)}`, 502, 'STL_PARSE_FAILED');
  }
  if (!stats.bbox) {
    return err('rendered STL has no measurable bounding box', 502, 'BBOX_MISSING');
  }

  const result = verifyAgainstSpec(intent, stats.bbox, {
    ...(stats.genus !== undefined ? { detectedGenus: stats.genus } : {}),
    ...(stats.volume_mm3 !== undefined ? { detectedVolumeMm3: stats.volume_mm3 } : {}),
    ...(stats.surfaceArea_mm2 !== undefined ? { detectedSurfaceAreaMm2: stats.surfaceArea_mm2 } : {}),
    ...(stats.detectedHoles ? { detectedHoles: stats.detectedHoles } : {}),
    ...(stats.dihedralStats ? { detectedDihedralStats: stats.dihedralStats } : {}),
  });

  return NextResponse.json<SuccessResponse>({ ok: true, result });
}
