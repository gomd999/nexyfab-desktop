import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleProductDecomposition } from './handler';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  let bodyTooLarge = false;
  try { body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES); }
  catch (error) { bodyTooLarge = boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE'; }
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`product-decomposition:${ip}`, 10, 3_600_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: localizedApiMessage(locale, 'rateLimited'), outputLanguage: locale.route }, { status: 429 });
  }
  if (bodyTooLarge) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Product request is too large', outputLanguage: locale.route }, { status: 413 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  const result = await handleProductDecomposition(body, async (prompt, signal) => {
    const completion = await chatCompletion({
      messages: [{ role: 'user', content: `${prompt}\n\n[OUTPUT LANGUAGE CONTRACT]\nWrite display labels and descriptions in ${locale.languageName}; keep stable identifiers and standard codes unchanged.` }],
      maxTokens: 12_000, temperature: 0, timeoutMs: 45_000, signal,
      task: 'product-decomposition',
    });
    return completion.text;
  });
  return NextResponse.json({ ...(result.payload as Record<string, unknown>), outputLanguage: locale.route }, { status: result.status });
}
