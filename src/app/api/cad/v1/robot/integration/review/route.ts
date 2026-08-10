import { NextRequest, NextResponse } from 'next/server';
import { verifyRobotCadIntegrationReview, type RobotCadIntegrationReview } from '@/lib/ai/robot/robotCadIntegrationReview';
import type { RobotCadIntegrationPacket } from '@/lib/ai/robot/robotCadIntegrationPacket';
import { parseTrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-integration-review:${ip}`, 10, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const form = await req.formData().catch(() => null); const packetFile = form?.get('packet'); const reviewFile = form?.get('review');
  if (!(packetFile instanceof File) || !(reviewFile instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'packet and signed review files are required' }, { status: 400 });
  if (packetFile.size < 1 || packetFile.size > 5_000_000 || reviewFile.size < 1 || reviewFile.size > 1_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  try {
    const packet = parse(await packetFile.arrayBuffer(), 'packet') as RobotCadIntegrationPacket; const review = parse(await reviewFile.arrayBuffer(), 'review') as RobotCadIntegrationReview;
    const result = verifyRobotCadIntegrationReview(packet, review, parseTrustedReviewerKeys());
    return NextResponse.json({ ok: result.approved, result, cadApplied: false, releaseReady: false, quoteOrRfqSideEffects: false }, { status: result.approved ? 200 : 422 });
  } catch (cause) { return NextResponse.json({ ok: false, code: 'INVALID_REVIEW', message: cause instanceof Error ? cause.message : String(cause), cadApplied: false, releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 }); }
}
function parse(bytes: ArrayBuffer, label: string) { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a UTF-8 JSON object`); return value; }
