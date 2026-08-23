// AWS SES → SNS notification webhook. SES publishes bounce / complaint / delivery
// events to an SNS topic; subscribe that topic (HTTPS) to this endpoint. We:
//   1. auto-confirm the SNS subscription (fetch SubscribeURL),
//   2. on a PERMANENT bounce or a complaint, add the recipient to the email
//      suppression list so we never email them again.
// Transient bounces are ignored (the address may still be valid).
//
import { NextRequest, NextResponse } from 'next/server';
import { suppressEmail } from '@/lib/email-suppression';
import {
  configuredSnsTopicArns,
  isTrustedSnsActionUrl,
  type SnsEnvelope,
  verifySnsSignature,
} from '@/lib/aws-sns-signature';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SNS_BODY_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  let raw: string;
  try {
    const bytes = await readBoundedRawBody(req, MAX_SNS_BODY_BYTES);
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    const bounded = boundedRawBodyError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  let env: SnsEnvelope;
  try { env = JSON.parse(raw) as SnsEnvelope; } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const allowedTopics = configuredSnsTopicArns();
  if (process.env.NODE_ENV === 'production' && allowedTopics.length === 0) {
    return NextResponse.json({ error: 'SNS topic allowlist is not configured' }, { status: 503 });
  }
  if (!env.TopicArn || (allowedTopics.length > 0 && !allowedTopics.includes(env.TopicArn))) {
    return NextResponse.json({ error: 'SNS topic is not allowed' }, { status: 403 });
  }
  if (!await verifySnsSignature(env)) {
    return NextResponse.json({ error: 'invalid SNS signature' }, { status: 401 });
  }

  const type = env.Type ?? '';

  // 1. Confirm the subscription (only trust AWS SNS confirm URLs).
  if (type === 'SubscriptionConfirmation' && env.SubscribeURL) {
    try {
      if (!isTrustedSnsActionUrl(env.SubscribeURL)) {
        return NextResponse.json({ error: 'invalid SNS confirmation URL' }, { status: 400 });
      }
      const confirmation = await fetch(env.SubscribeURL, { redirect: 'error' });
      if (!confirmation.ok) {
        return NextResponse.json({ error: 'SNS confirmation failed' }, { status: 502 });
      }
    } catch {
      return NextResponse.json({ error: 'SNS confirmation failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, confirmed: true });
  }

  // 2. Bounce / complaint → suppress.
  if (type === 'Notification' && env.Message) {
    let msg: Record<string, unknown> = {};
    try { msg = JSON.parse(env.Message) as Record<string, unknown>; } catch { /* ignore */ }
    const nt = (msg.notificationType || msg.eventType) as string | undefined;

    if (nt === 'Bounce') {
      const bounce = msg.bounce as { bounceType?: string; bounceSubType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> } | undefined;
      // Only hard (Permanent) bounces — transient may still deliver later.
      if (bounce?.bounceType === 'Permanent') {
        for (const r of bounce.bouncedRecipients ?? []) {
          if (r.emailAddress) await suppressEmail(r.emailAddress, 'bounce', bounce.bounceSubType);
        }
      }
    } else if (nt === 'Complaint') {
      const complaint = msg.complaint as { complainedRecipients?: Array<{ emailAddress?: string }>; complaintFeedbackType?: string } | undefined;
      for (const r of complaint?.complainedRecipients ?? []) {
        if (r.emailAddress) await suppressEmail(r.emailAddress, 'complaint', complaint?.complaintFeedbackType);
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
