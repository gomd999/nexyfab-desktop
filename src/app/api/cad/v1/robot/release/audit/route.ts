import { NextRequest, NextResponse } from 'next/server';
import { auditRobotReleaseEvidenceV2, parseTrustedRobotExactCadKeys } from '@/lib/ai/robot/robotReleaseEvidenceAuditV2';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-release-audit:${ip}`, 10, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 10_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const post = form?.get('postIntegration'), exact = form?.get('exactCadEvidence'), manufacturing = form?.get('manufacturingEvidence');
  if (!(post instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'postIntegration evidence is required; exact CAD and manufacturing evidence may be omitted only to audit gaps' }, { status: 400 });
  if ((exact !== null && !(exact instanceof File)) || (manufacturing !== null && !(manufacturing instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const optional = [exact, manufacturing].filter((item): item is File => item instanceof File);
  if (post.size < 1 || post.size > 5_000_000 || optional.some(file => file.size < 1 || file.size > 2_000_000)) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = auditRobotReleaseEvidenceV2(
    new Uint8Array(await post.arrayBuffer()),
    exact instanceof File ? new Uint8Array(await exact.arrayBuffer()) : null,
    manufacturing instanceof File ? new Uint8Array(await manufacturing.arrayBuffer()) : null,
    parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS),
    parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS),
  );
  return NextResponse.json({ ok: report.status === 'ready_for_final_review', report, releaseReady: false, externalCadRequired: false, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.status === 'ready_for_final_review' ? 200 : 422 });
}
