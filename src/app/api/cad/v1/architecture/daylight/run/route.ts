import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildRadianceExecutionPlan, calculateAnnualDaylightMetrics, parseAnnualIlluminanceMatrix, parseRtraceRgbIlluminance } from '@/lib/ai/radianceExecution';
import { executeRadianceLocally, radianceExecutablePathsFromEnvironment } from '@/lib/ai/radianceLocalExecution';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
type Body = { kind: 'point_in_time' | 'annual'; sceneRad: string; sensorsPts: string; sensorCount: number; skyRad?: string; weatherWea?: string; timestepCount?: number; timestepHours?: number };
const MAX_DAYLIGHT_RUN_BODY_BYTES = 64 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-daylight-run:${ip}`, 5, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', releaseReady: false }, { status: 429 });
  let body: Body | null;
  try { body = await readBoundedJson<Body>(req, MAX_DAYLIGHT_RUN_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code, releaseReady: false }, { status: bounded.status }); body = null; }
  if (!body || (body.kind !== 'point_in_time' && body.kind !== 'annual') || typeof body.sceneRad !== 'string' || typeof body.sensorsPts !== 'string' || !Number.isInteger(body.sensorCount) || body.sensorCount <= 0 || body.sceneRad.length + body.sensorsPts.length > 16 * 1024 * 1024) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', releaseReady: false }, { status: 400 });
  if (body.kind === 'point_in_time' && typeof body.skyRad !== 'string') return NextResponse.json({ ok: false, code: 'SKY_REQUIRED', releaseReady: false }, { status: 400 });
  if (body.kind === 'annual' && (typeof body.weatherWea !== 'string' || !Number.isInteger(body.timestepCount) || !body.timestepCount || body.timestepCount <= 0)) return NextResponse.json({ ok: false, code: 'WEATHER_AND_TIMESTEPS_REQUIRED', releaseReady: false }, { status: 400 });
  const plan = buildRadianceExecutionPlan(body.kind);
  try {
    const artifacts: Record<string, string | Uint8Array> = body.kind === 'point_in_time' ? { 'scene.rad': body.sceneRad, 'sensors.pts': body.sensorsPts, 'sky.rad': body.skyRad! } : { 'scene.rad': body.sceneRad, 'sensors.pts': body.sensorsPts, 'weather.wea': body.weatherWea! };
    const result = await executeRadianceLocally({ plan, artifacts, executablePaths: radianceExecutablePathsFromEnvironment() });
    if (result.status !== 'pass') return NextResponse.json({ ok: true, status: result.status, releaseReady: false, plan, errors: result.errors, quoteOrRfqSideEffects: false });
    const outputName = body.kind === 'point_in_time' ? 'illuminance.rgb' : 'annual-illuminance.mtx';
    const output = result.outputs[outputName];
    if (!output) throw new Error(`missing_output:${outputName}`);
    const text = Buffer.from(output).toString('utf8');
    const evidence = body.kind === 'point_in_time' ? { illuminanceLux: parseRtraceRgbIlluminance(text, body.sensorCount) } : { metrics: calculateAnnualDaylightMetrics(parseAnnualIlluminanceMatrix(text, body.sensorCount, body.timestepCount!), body.timestepHours) };
    return NextResponse.json({
      ok: true,
      status: 'pass',
      // A local Radiance run is preview evidence, not an independently signed release receipt.
      releaseReady: false,
      evidenceAuthority: 'local_execution_preview',
      releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
      outputSha256: hash(output),
      ...evidence,
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, status: 'fail', code: 'RADIANCE_EXECUTION_FAILED', message: error instanceof Error ? error.message : 'Radiance execution failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  }
}
