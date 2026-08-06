import { NextRequest, NextResponse } from 'next/server';
import type { BuildingServiceOpening } from '@/lib/ai/mepFabricationPlanning';
import { commitServiceOpeningSync } from '@/lib/ai/serviceOpeningIntegration';
import { validateUnifiedDesignProject, type UnifiedDesignProject } from '@/lib/ai/unifiedDesignProject';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-service-opening-sync:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { project?: UnifiedDesignProject; architectureDocumentId?: string; mepDocumentId?: string; routeId?: string; openings?: BuildingServiceOpening[]; nextMepPayload?: unknown } | null;
  if (!body?.project || !body.architectureDocumentId || !body.mepDocumentId || !body.routeId || !Array.isArray(body.openings) || body.nextMepPayload === undefined) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const issues = validateUnifiedDesignProject(body.project); if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_PROJECT', issues }, { status: 422 });
  const transaction = commitServiceOpeningSync(body.project, body.architectureDocumentId, body.mepDocumentId, body.routeId, body.openings, body.nextMepPayload);
  return NextResponse.json({ ok: transaction.committed, transaction, quoteOrRfqSideEffects: false }, { status: transaction.committed ? 200 : 409 });
}
