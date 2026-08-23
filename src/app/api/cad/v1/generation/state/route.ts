import { NextRequest, NextResponse } from 'next/server';
import { bindAdaptiveComplexProductExecutionPlan, buildAdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import {
  createGenerationRun, invalidateGenerationForEdit, planGenerationStageRecovery,
  type GenerationRunStage, type GenerationRunState,
} from '@/lib/ai/generationRunState';
import { createServerGenerationState, loadServerGenerationState, saveServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { createCommercialGenerationRouteRun, loadCommercialGenerationRouteRun, resolveCommercialGenerationRouteContext, saveCommercialGenerationRouteRun } from '@/lib/ai/commercialGenerationRouteState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = (
  | { action: 'initialize'; runId?: string; projectId?: string }
  | { action: 'record'; state: GenerationRunState; completion: unknown }
  | { action: 'recover'; state: GenerationRunState; stage: GenerationRunStage }
  | { action: 'invalidate_edit'; state: GenerationRunState; transaction: { operations: Array<{ kind: string }>; affected: { parts: string[] } } }
  | { action: 'plan'; state: GenerationRunState }) & { projectId?: string };

const stateLike = (value: unknown): value is GenerationRunState => !!value && typeof value === 'object' && (value as { schema?: unknown }).schema === 'nexyfab.generation-run.v1';
const executionPlanFor = (state: GenerationRunState, projectId?: string) => bindAdaptiveComplexProductExecutionPlan(buildAdaptiveComplexProductExecutionPlan(state), state, projectId);
const stateResponse = (state: GenerationRunState, projectId?: string) => ({ ok: true, state, executionPlan: executionPlanFor(state, projectId), quoteOrRfqSideEffects: false });

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-state:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: RequestBody | null;
  try { body = await readBoundedJson<RequestBody>(req, 5 * 1024 * 1024); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded) return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); throw error; }
  try {
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !(await getAuthUser(req))) {
      return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'AUTHENTICATED_EDITOR_REQUIRED' }, { status: 401 });
    }
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && process.env.POSTGRES_MIGRATION_VERSION !== '2026082208') {
      return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'COMMERCIAL_GENERATION_MIGRATION_REQUIRED' }, { status: 503 });
    }
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      const projectId = body && 'projectId' in body && typeof body.projectId === 'string' ? body.projectId : '';
      if (body?.action === 'initialize') {
        const created = await createCommercialGenerationRouteRun(await resolveCommercialGenerationRouteContext(req, projectId));
        return NextResponse.json(stateResponse({ ...created.state, projectId }, projectId));
      }
      if (body?.action === 'record') return NextResponse.json({ ok: false, code: 'SERVER_STAGE_EXECUTOR_REQUIRED', message: 'Generation stages may be recorded only by their server executor.' }, { status: 403 });
      if (body && 'state' in body && stateLike(body.state)) {
        const current = await loadCommercialGenerationRouteRun(req, projectId, body.state.runId, body.state.revision);
        if (body.action === 'recover' && typeof body.stage === 'string') return NextResponse.json({ ok: true, plan: planGenerationStageRecovery(current.state, body.stage, [], 3), executionPlan: executionPlanFor(current.state, projectId), quoteOrRfqSideEffects: false });
        if (body.action === 'invalidate_edit' && body.transaction?.affected && Array.isArray(body.transaction.operations)) {
          const saved = await saveCommercialGenerationRouteRun(current, invalidateGenerationForEdit(current.state, body.transaction));
          return NextResponse.json(stateResponse(saved.state));
        }
        if (body.action === 'plan') return NextResponse.json({ ok: true, state: current.state, executionPlan: executionPlanFor(current.state, projectId), quoteOrRfqSideEffects: false });
      }
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Unsupported or incomplete commercial generation state action' }, { status: 400 });
    }
    const owner = await generationRequestOwner(req, ip);
    if (body?.action === 'initialize' && typeof body.runId === 'string') {
      const state = createGenerationRun(body.runId, body.projectId);
      await createServerGenerationState(owner, state);
      return NextResponse.json(stateResponse(state, body.projectId));
    }
    if (body?.action === 'record') {
      return NextResponse.json({ ok: false, code: 'SERVER_STAGE_EXECUTOR_REQUIRED', message: 'Generation stages may be recorded only by their server executor.' }, { status: 403 });
    }
    if (body && 'state' in body && stateLike(body.state)) {
      const state = await loadServerGenerationState(owner, body.state.runId);
      if (state.revision !== body.state.revision) throw new Error('GENERATION_REVISION_CONFLICT');
      if (body.action === 'recover' && typeof body.stage === 'string') return NextResponse.json({ ok: true, plan: planGenerationStageRecovery(state, body.stage, [], 3), executionPlan: executionPlanFor(state, body.projectId ?? state.projectId), quoteOrRfqSideEffects: false });
      if (body.action === 'invalidate_edit' && body.transaction?.affected && Array.isArray(body.transaction.operations)) {
        const next = invalidateGenerationForEdit(state, body.transaction);
        await saveServerGenerationState(owner, next, state.revision);
        return NextResponse.json(stateResponse(next));
      }
        if (body.action === 'plan') return NextResponse.json({ ok: true, state, executionPlan: executionPlanFor(state, body.projectId ?? state.projectId), quoteOrRfqSideEffects: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generation state transition';
    const status = message === 'GENERATION_RUN_NOT_FOUND' ? 404 : message === 'GENERATION_STATE_REDIS_REQUIRED' || message === 'GENERATION_STATE_POSTGRES_AUTHORITATIVE_REQUIRED' ? 503 : 409;
    return NextResponse.json({ ok: false, code: message, message }, { status });
  }
  return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Unsupported or incomplete generation state action' }, { status: 400 });
}
