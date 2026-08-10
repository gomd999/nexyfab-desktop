import { NextRequest, NextResponse } from 'next/server';
import { buildAdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import {
  createGenerationRun, invalidateGenerationForEdit, planGenerationStageRecovery,
  type GenerationRunStage, type GenerationRunState,
} from '@/lib/ai/generationRunState';
import { createServerGenerationState, loadServerGenerationState, saveServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody =
  | { action: 'initialize'; runId: string }
  | { action: 'record'; state: GenerationRunState; completion: unknown }
  | { action: 'recover'; state: GenerationRunState; stage: GenerationRunStage; previousFingerprints?: string[]; maxAttempts?: number }
  | { action: 'invalidate_edit'; state: GenerationRunState; transaction: { operations: Array<{ kind: string }>; affected: { parts: string[] } } }
  | { action: 'plan'; state: GenerationRunState };

const stateLike = (value: unknown): value is GenerationRunState => !!value && typeof value === 'object' && (value as { schema?: unknown }).schema === 'nexyfab.generation-run.v1';
const stateResponse = (state: GenerationRunState) => ({ ok: true, state, executionPlan: buildAdaptiveComplexProductExecutionPlan(state), quoteOrRfqSideEffects: false });

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-state:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as RequestBody | null;
  try {
    const owner = await generationRequestOwner(req, ip);
    if (body?.action === 'initialize' && typeof body.runId === 'string') {
      const state = createGenerationRun(body.runId);
      await createServerGenerationState(owner, state);
      return NextResponse.json(stateResponse(state));
    }
    if (body?.action === 'record') {
      return NextResponse.json({ ok: false, code: 'SERVER_STAGE_EXECUTOR_REQUIRED', message: 'Generation stages may be recorded only by their server executor.' }, { status: 403 });
    }
    if (body && 'state' in body && stateLike(body.state)) {
      const state = await loadServerGenerationState(owner, body.state.runId);
      if (state.revision !== body.state.revision) throw new Error('GENERATION_REVISION_CONFLICT');
      if (body.action === 'recover' && typeof body.stage === 'string') return NextResponse.json({ ok: true, plan: planGenerationStageRecovery(state, body.stage, body.previousFingerprints ?? [], body.maxAttempts), executionPlan: buildAdaptiveComplexProductExecutionPlan(state), quoteOrRfqSideEffects: false });
      if (body.action === 'invalidate_edit' && body.transaction?.affected && Array.isArray(body.transaction.operations)) {
        const next = invalidateGenerationForEdit(state, body.transaction);
        await saveServerGenerationState(owner, next, state.revision);
        return NextResponse.json(stateResponse(next));
      }
      if (body.action === 'plan') return NextResponse.json({ ok: true, state, executionPlan: buildAdaptiveComplexProductExecutionPlan(state), quoteOrRfqSideEffects: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generation state transition';
    const status = message === 'GENERATION_RUN_NOT_FOUND' ? 404 : message === 'GENERATION_STATE_REDIS_REQUIRED' ? 503 : 409;
    return NextResponse.json({ ok: false, code: message, message }, { status });
  }
  return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Unsupported or incomplete generation state action' }, { status: 400 });
}
