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
import { handleAssemblyIntent, type AssemblyIntentBody } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Body-size guard: peek at Content-Length so we don't buffer multi-MB
  // bodies just to discover they're too large.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PAYLOAD_TOO_LARGE',
          message: `body bytes ${cl} exceeds maximum ${MAX_BODY_BYTES}`,
        },
        { status: 413 },
      );
    }
  }

  let body: AssemblyIntentBody;
  try {
    body = (await req.json()) as AssemblyIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Body must be valid JSON' },
      { status: 400 },
    );
  }
  const { status, payload } = await handleAssemblyIntent(body);
  return NextResponse.json(payload, { status });
}
