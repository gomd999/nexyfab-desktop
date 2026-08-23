/**
 * POST /api/featureTree-intent — regex-first / LLM-fallback bridge that turns a
 * natural-language modelling request into a structured PlanIntent. The logic
 * lives in ./handler (handleFeatureTreeIntent); this file is the thin HTTP
 * shell because a Next App Router route.ts may only value-export method
 * handlers. See ./handler.ts for the regex → LLM → fallback pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { handleFeatureTreeIntent, type FeatureTreeIntentBody } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FeatureTreeIntentBody;
  try {
    body = await readBoundedJson<FeatureTreeIntentBody>(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: `Body exceeds ${MAX_BODY_BYTES} bytes` }, { status: bounded.status });
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleFeatureTreeIntent(body);
  return NextResponse.json(payload, { status });
}
