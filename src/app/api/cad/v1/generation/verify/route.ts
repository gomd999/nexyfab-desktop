import { NextRequest, NextResponse } from 'next/server';
import { evaluateAiGeneration, type AiGenerationEvidence } from '@/lib/ai/aiGenerationPipeline';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-verify:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many generation verification requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as AiGenerationEvidence | null;
  if (!looksLikeEvidence(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'A complete generation evidence object is required.' }, { status: 400 });
  }
  const decision = evaluateAiGeneration(body);
  return NextResponse.json({ ok: true, decision, releaseReady: decision.status === 'pass' && decision.stage === 'complete', quoteOrRfqSideEffects: false });
}

function looksLikeEvidence(value: unknown): value is AiGenerationEvidence {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<AiGenerationEvidence>;
  return !!e.intent && Array.isArray(e.intent.unresolved) && Array.isArray(e.intent.conflicts)
    && !!e.decomposition && typeof e.decomposition.valid === 'boolean'
    && Number.isInteger(e.decomposition.independentPartCount) && Array.isArray(e.decomposition.errors)
    && Array.isArray(e.parts);
}
