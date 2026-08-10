import { NextRequest, NextResponse } from 'next/server';
import { buildRobotReleaseWorkPacketV2 } from '@/lib/ai/robot/robotReleaseWorkPacketV2';
import { parseTrustedRobotExactCadKeys } from '@/lib/ai/robot/robotReleaseEvidenceAuditV2';
import { parseTrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-release-work-packet:${ip}`, 10, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const form = await req.formData().catch(() => null), post = form?.get('postIntegration');
  if (!(post instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'postIntegration evidence is required' }, { status: 400 });
  if (post.size < 1 || post.size > 5_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const packet = buildRobotReleaseWorkPacketV2(new Uint8Array(await post.arrayBuffer()), parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS), parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS), parseTrustedReviewerKeys());
  return NextResponse.json({ ok: packet.errors.length === 0, packet, releaseReady: false, externalCadRequired: false, sourceModified: false, quoteOrRfqSideEffects: false }, { status: packet.errors.length === 0 ? 200 : 422 });
}
