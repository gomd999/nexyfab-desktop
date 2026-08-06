import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleGenerationRefine, type RefineBody } from './handler';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-refine:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as RefineBody | null;
  const result = await handleGenerationRefine(body ?? {}, async (prompt, signal) => (await chatCompletion({ messages: [{ role: 'user', content: prompt }], maxTokens: 12_000, temperature: 0, timeoutMs: 45_000, signal, task: 'cad-multistage-refinement' })).text);
  return NextResponse.json(result.payload, { status: result.status });
}
