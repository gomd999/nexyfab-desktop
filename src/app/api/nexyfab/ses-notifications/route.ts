// AWS SES → SNS notification webhook. SES publishes bounce / complaint / delivery
// events to an SNS topic; subscribe that topic (HTTPS) to this endpoint. We:
//   1. auto-confirm the SNS subscription (fetch SubscribeURL),
//   2. on a PERMANENT bounce or a complaint, add the recipient to the email
//      suppression list so we never email them again.
// Transient bounces are ignored (the address may still be valid).
//
// Hardening TODO: verify the SNS message signature (SigningCertURL) before
// trusting it. For now we only ACT on bounce/complaint payloads (idempotent
// suppression), and confirmation just GETs an amazonaws.com SubscribeURL.

import { NextRequest, NextResponse } from 'next/server';
import { suppressEmail } from '@/lib/email-suppression';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SnsEnvelope {
  Type?: string;
  SubscribeURL?: string;
  Message?: string;
  TopicArn?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let env: SnsEnvelope;
  try { env = JSON.parse(raw) as SnsEnvelope; } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const type = env.Type || req.headers.get('x-amz-sns-message-type') || '';

  // 1. Confirm the subscription (only trust AWS SNS confirm URLs).
  if (type === 'SubscriptionConfirmation' && env.SubscribeURL) {
    try {
      const u = new URL(env.SubscribeURL);
      if (u.hostname.endsWith('amazonaws.com')) await fetch(env.SubscribeURL);
    } catch { /* ignore */ }
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
