/**
 * POST /api/assembly-intent — regex-first / LLM-fallback bridge that turns a
 * natural-language assembly request into a structured AssemblyPlan. The logic
 * lives in ./handler (handleAssemblyIntent); this file is the thin HTTP shell
 * because a Next App Router route.ts may only value-export method handlers.
 *
 * See ./handler.ts for the regex → LLM → fallback pipeline and the never-5xx
 * contract. This route adds a Content-Length body-size guard and JSON parsing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { handleAssemblyIntent, type AssemblyIntentBody } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AssemblyIntentBody;
  try {
    body = await readBoundedJson<AssemblyIntentBody>(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') {
      const declaredBytes = Number(req.headers.get('content-length'));
      const message = Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES
        ? `body bytes ${declaredBytes} exceeds maximum ${MAX_BODY_BYTES}`
        : `body exceeds maximum ${MAX_BODY_BYTES} bytes`;
      return NextResponse.json(
        { ok: false, code: bounded.code, message },
        { status: bounded.status },
      );
    }
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleAssemblyIntent(body);
  return NextResponse.json(payload, { status });
}
