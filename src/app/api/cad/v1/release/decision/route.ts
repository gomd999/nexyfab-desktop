import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { CAD_RELEASE_STATUSES, type CadExportPurpose } from '@/lib/cad-release-status';
import {
  evaluateCadDeliverableRelease,
  parseTrustedCadDeliverableReviewers,
  type CadDeliverableReleaseInput,
} from '@/lib/cad-deliverable-release';
import { DOMAIN_ACCURACY_DOMAINS } from '@/lib/ai/domainAccuracyProgram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PURPOSES = new Set<CadExportPurpose>(['design_review', 'expert_review', 'manufacturing_or_construction']);
const STATUSES = new Set<string>(CAD_RELEASE_STATUSES);
const DOMAINS = new Set<string>(DOMAIN_ACCURACY_DOMAINS);

function validInput(value: unknown): value is CadDeliverableReleaseInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Partial<CadDeliverableReleaseInput>;
  return STATUSES.has(String(input.workflowStatus))
    && PURPOSES.has(input.purpose as CadExportPurpose)
    && DOMAINS.has(String(input.domain))
    && typeof input.revisionId === 'string'
    && input.revisionId.trim().length > 0
    && typeof input.revisionSha256 === 'string'
    && Array.isArray(input.roundtrips)
    && (input.signoffs === undefined || Array.isArray(input.signoffs));
}

/** Server-side source of truth for every UI/API export button and worker. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-release-decision:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!validInput(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'A complete CAD release decision input is required.' }, { status: 400 });
  }
  const decision = evaluateCadDeliverableRelease(
    body,
    parseTrustedCadDeliverableReviewers(process.env.NEXYFAB_CAD_REVIEWER_KEYS),
  );
  return NextResponse.json(
    { ok: decision.status === 'pass', decision, quoteOrRfqSideEffects: false },
    { status: decision.status === 'pass' ? 200 : 409 },
  );
}
