import { NextRequest, NextResponse } from 'next/server';
import { editArchitectureInteriorProject } from '@/lib/ai/architectureInteriorProjectAdapter';
import type { ArchitectureEdit } from '@/lib/ai/architectureInteriorDocuments';
import { validateUnifiedDesignProject, type UnifiedDesignProject } from '@/lib/ai/unifiedDesignProject';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_ARCHITECTURE_INTERIOR_EDIT_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-architecture-interior-edit:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  type Body = { project?: UnifiedDesignProject; architectureDocumentId?: string; interiorDocumentId?: string; edit?: ArchitectureEdit };
  let body: Body | null;
  try { body = await readBoundedJson<Body>(req, MAX_ARCHITECTURE_INTERIOR_EDIT_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); body = null; }
  if (!body?.project || !body.architectureDocumentId || !body.interiorDocumentId || !body.edit) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'project, architectureDocumentId, interiorDocumentId, and edit are required' }, { status: 400 });
  const issues = validateUnifiedDesignProject(body.project);
  if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_PROJECT', issues }, { status: 422 });
  const transaction = editArchitectureInteriorProject(body.project, body.architectureDocumentId, body.interiorDocumentId, body.edit);
  return NextResponse.json({ ok: transaction.committed, transaction, quoteOrRfqSideEffects: false }, { status: transaction.committed ? 200 : 409 });
}
