import { NextRequest, NextResponse } from 'next/server';
import { editArchitectureInteriorProject } from '@/lib/ai/architectureInteriorProjectAdapter';
import type { ArchitectureEdit } from '@/lib/ai/architectureInteriorDocuments';
import { validateUnifiedDesignProject, type UnifiedDesignProject } from '@/lib/ai/unifiedDesignProject';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-architecture-interior-edit:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { project?: UnifiedDesignProject; architectureDocumentId?: string; interiorDocumentId?: string; edit?: ArchitectureEdit } | null;
  if (!body?.project || !body.architectureDocumentId || !body.interiorDocumentId || !body.edit) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'project, architectureDocumentId, interiorDocumentId, and edit are required' }, { status: 400 });
  const issues = validateUnifiedDesignProject(body.project);
  if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_PROJECT', issues }, { status: 422 });
  const transaction = editArchitectureInteriorProject(body.project, body.architectureDocumentId, body.interiorDocumentId, body.edit);
  return NextResponse.json({ ok: transaction.committed, transaction, quoteOrRfqSideEffects: false }, { status: transaction.committed ? 200 : 409 });
}
