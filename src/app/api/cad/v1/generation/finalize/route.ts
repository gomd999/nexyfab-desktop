import { NextRequest, NextResponse } from 'next/server';
import { POST as verifyAnimationPost } from '@/app/api/cad/v1/assembly/animation/verify/route';
import { collisionGeometryFromFeatureTree } from '@/lib/assembly/featureTreePreciseInterference';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '@/lib/ai/aiAssemblyProgram';
import { finalizeGenerationRun, type PartFinalizationEvidence } from '@/lib/ai/finalizeGenerationRun';
import { buildGenerationCanonicalResponse } from '@/lib/ai/generationCanonicalResponse';
import type { GenerationRunState } from '@/lib/ai/generationRunState';
import type { AssemblyAnimation } from '@/lib/assembly/assemblyAnimation';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
type Body = {
  state?: GenerationRunState; program?: AiAssemblyProgram;
  motion?: { required: boolean; animation?: AssemblyAnimation; frameStep?: number };
  parts?: PartFinalizationEvidence[];
};

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-finalize:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as Body | null;
  if (!body?.state || body.state.schema !== 'nexyfab.generation-run.v1' || !body.program || !body.motion || !Array.isArray(body.parts)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'state, program, motion and parts are required' }, { status: 400 });
  }
  const issues = validateAiAssemblyProgram(body.program);
  if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_PROGRAM', issues }, { status: 422 });
  if (body.motion.required && !body.motion.animation) {
    try {
      const result = finalizeGenerationRun(body.state, { motion: { required: true }, parts: body.parts });
      return NextResponse.json({ ok: true, ...result, canonical: buildGenerationCanonicalResponse(result), recovery: { action: 'request_input', stage: 'motion', reason: 'A governed animation is required.' }, quoteOrRfqSideEffects: false });
    } catch (error) { return transitionError(error); }
  }
  try {
    let motionVerification: { ok?: boolean; releaseReady?: boolean; precise?: unknown; broad?: unknown; code?: string; message?: string } | undefined;
    if (body.motion.required && body.motion.animation) {
      const built = await Promise.all(body.program.parts.map(async part => [part.instanceId, await collisionGeometryFromFeatureTree(part.instanceId, part.featureTree)] as const));
      const unavailable = built.filter(([, geometry]) => !geometry.available);
      if (unavailable.length) motionVerification = { ok: false, releaseReady: false, code: 'MOTION_GEOMETRY_UNAVAILABLE', message: unavailable.map(([, geometry]) => geometry.reason).join('; ') };
      else {
        const localBoxes = Object.fromEntries(built.map(([id, geometry]) => {
          const bbox = geometry.geometry.bbox!; return [id, { min: { x: bbox.min[0], y: bbox.min[1], z: bbox.min[2] }, max: { x: bbox.max[0], y: bbox.max[1], z: bbox.max[2] } }];
        }));
        const animationRequest = new NextRequest(new URL('/api/cad/v1/assembly/animation/verify', req.url), {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ state: body.program.assembly, animation: body.motion.animation, localBoxes, featureTrees: Object.fromEntries(body.program.parts.map(part => [part.instanceId, part.featureTree])), frameStep: body.motion.frameStep }),
        });
        const response = await verifyAnimationPost(animationRequest); motionVerification = await response.json();
      }
    }
    const result = finalizeGenerationRun(body.state, { motion: { required: body.motion.required, verification: motionVerification }, parts: body.parts });
    const stopped = result.stoppedAt;
    const recovery = stopped === 'complete' ? undefined : {
      action: stopped === 'motion' ? 'retry_stage' : stopped === 'release' ? 'request_input' : 'retry_affected_parts',
      stage: stopped,
      affectedPartIds: result.state.stages[stopped].affectedPartIds,
      reason: result.state.stages[stopped].unresolved.join(' '),
    };
    return NextResponse.json({ ok: true, ...result, canonical: buildGenerationCanonicalResponse(result), recovery, quoteOrRfqSideEffects: false });
  } catch (error) { return transitionError(error); }
}

function transitionError(error: unknown) {
  return NextResponse.json({ ok: false, code: 'FINALIZE_FAILED', message: error instanceof Error ? error.message : 'Generation finalization failed' }, { status: 409 });
}
