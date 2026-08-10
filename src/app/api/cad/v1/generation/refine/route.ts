import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { loadServerGenerationState, saveServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import type { GenerationRunState } from '@/lib/ai/generationRunState';
import { handleGenerationRefine, type RefineBody } from './handler';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-refine:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as RefineBody | null;
  if (!body?.state?.runId || !Number.isInteger(body.state.revision)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'server generation run handle is required' }, { status: 400 });
  try {
    const owner = await generationRequestOwner(req, ip);
    const stored = await loadServerGenerationState(owner, body.state.runId);
    if (stored.revision !== body.state.revision) throw new Error('GENERATION_REVISION_CONFLICT');
    const result = await handleGenerationRefine({ ...body, state: stored }, async (prompt, signal) => (await chatCompletion({ messages: [{ role: 'user', content: prompt }], maxTokens: 12_000, temperature: 0, timeoutMs: 45_000, signal, task: 'cad-multistage-refinement' })).text);
    const next = result.payload.state as GenerationRunState | undefined;
    if (result.status === 200 && next) await saveServerGenerationState(owner, next, stored.revision);
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GENERATION_STATE_FAILED';
    const status = code === 'GENERATION_RUN_NOT_FOUND' ? 404 : code === 'GENERATION_STATE_REDIS_REQUIRED' ? 503 : 409;
    return NextResponse.json({ ok: false, code, message: code }, { status });
  }
}
