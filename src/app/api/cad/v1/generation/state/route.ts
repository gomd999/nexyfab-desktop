import { NextRequest, NextResponse } from 'next/server';
import { createGenerationRun, invalidateGenerationForEdit, planGenerationStageRecovery, recordGenerationStage, type GenerationRunStage, type GenerationRunState, type StageCompletion } from '@/lib/ai/generationRunState';
import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
type RequestBody = { action: 'initialize'; runId: string } | { action: 'record'; state: GenerationRunState; completion: StageCompletion } | { action: 'recover'; state: GenerationRunState; stage: GenerationRunStage; previousFingerprints?: string[]; maxAttempts?: number } | { action: 'invalidate_edit'; state: GenerationRunState; transaction: { operations: Array<{ kind: string }>; affected: { parts: string[] } } };
const stateLike = (value: unknown): value is GenerationRunState => !!value && typeof value === 'object' && (value as { schema?: unknown }).schema === 'nexyfab.generation-run.v1';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-generation-state:${ip}`, 120, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as RequestBody | null;
  try {
    if (body?.action === 'initialize' && typeof body.runId === 'string') return NextResponse.json({ ok: true, state: createGenerationRun(body.runId), quoteOrRfqSideEffects: false });
    if (body?.action === 'record' && stateLike(body.state) && body.completion) return NextResponse.json({ ok: true, state: recordGenerationStage(body.state, body.completion), quoteOrRfqSideEffects: false });
    if (body?.action === 'recover' && stateLike(body.state) && typeof body.stage === 'string') return NextResponse.json({ ok: true, plan: planGenerationStageRecovery(body.state, body.stage, body.previousFingerprints ?? [], body.maxAttempts), quoteOrRfqSideEffects: false });
    if (body?.action === 'invalidate_edit' && stateLike(body.state) && body.transaction?.affected && Array.isArray(body.transaction.operations)) return NextResponse.json({ ok: true, state: invalidateGenerationForEdit(body.state, body.transaction), quoteOrRfqSideEffects: false });
  } catch (error) { return NextResponse.json({ ok: false, code: 'INVALID_TRANSITION', message: error instanceof Error ? error.message : 'Invalid generation state transition' }, { status: 409 }); }
  return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Unsupported or incomplete generation state action' }, { status: 400 });
}
