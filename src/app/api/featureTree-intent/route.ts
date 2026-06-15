/**
 * POST /api/featureTree-intent — regex-first / LLM-fallback bridge that turns a
 * natural-language modelling request into a structured PlanIntent. The logic
 * lives in ./handler (handleFeatureTreeIntent); this file is the thin HTTP
 * shell because a Next App Router route.ts may only value-export method
 * handlers. See ./handler.ts for the regex → LLM → fallback pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleFeatureTreeIntent, type FeatureTreeIntentBody } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FeatureTreeIntentBody;
  try {
    body = (await req.json()) as FeatureTreeIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleFeatureTreeIntent(body);
  return NextResponse.json(payload, { status });
}
