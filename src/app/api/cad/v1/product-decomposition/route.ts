import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { handleProductDecomposition } from '@/app/api/product-decomposition/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stable CAD API used by web, CLI, and MCP. No quote/RFQ side effects. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-product:${ip}`, 10, 3_600_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many product generation requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await handleProductDecomposition(body, async (prompt, signal) => {
    const completion = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 12_000,
      temperature: 0,
      timeoutMs: 45_000,
      signal,
      task: 'product-decomposition',
    });
    return completion.text;
  });
  return NextResponse.json(result.payload, { status: result.status });
}
