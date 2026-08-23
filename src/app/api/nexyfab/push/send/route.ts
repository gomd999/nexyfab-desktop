// Admin-only push fan-out. Used by internal services (CRDT mention,
// quote-ready notification, build complete, etc.) to ping specific users
// without going through email.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import { sendPushToUser } from '@/lib/web-push';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_PUSH_SEND_BODY_BYTES = 16 * 1024;

const sendSchema = z.object({
  userId: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  body: z.string().max(400).optional(),
  url: z.string().url().max(500).optional(),
  tag: z.string().max(40).optional(),
  ttlSeconds: z.number().int().min(0).max(2_592_000).optional(),
});

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  const cronSecret = req.headers.get('x-cron-secret');
  const isCron = cronSecret && cronSecret === process.env.CRON_SECRET;
  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let raw: unknown = null;
  try { raw = await readBoundedJson(req, MAX_PUSH_SEND_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await sendPushToUser(parsed.data.userId, parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
