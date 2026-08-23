// In-app support chat — forwards user messages to a Slack incoming webhook
// so the support team can respond from Slack without a third-party widget
// vendor. Inbound messages stored in nf_support_messages so the user can
// see history on the next page load.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sanitizeText } from '@/lib/sanitize';
import { withRateLimit } from '@/lib/with-rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_SUPPORT_CHAT_BODY_BYTES = 16 * 1024;

const sendSchema = z.object({
  message: z.string().min(1).max(2000),
  category: z.enum(['bug', 'billing', 'feature', 'how_to', 'other']).default('other'),
  page: z.string().max(300).optional(),
});

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_support_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT,
      page TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

export const POST = withRateLimit({ key: 'support-chat', max: 20, windowMs: 60_000 }, async (req: NextRequest) => {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let raw: unknown = null;
  try { raw = await readBoundedJson(req, MAX_SUPPORT_CHAT_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  await ensureTable();
  const db = getDbAdapter();
  const authUser = await getAuthUser(req);
  const userId = authUser?.userId ?? null;
  const id = `supp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const safeMsg = sanitizeText(parsed.data.message);
  const safePage = parsed.data.page ? sanitizeText(parsed.data.page) : null;

  await db.execute(
    `INSERT INTO nf_support_messages (id, user_id, role, message, category, page, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?)`,
    id, userId, safeMsg, parsed.data.category, safePage, Date.now(),
  );

  // Slack fan-out (fire-and-forget — message saved either way).
  const slackUrl = process.env.SUPPORT_SLACK_WEBHOOK;
  if (slackUrl) {
    const userEmail = authUser?.email ?? 'guest';
    const userName = authUser?.email?.split('@')[0] ?? 'Guest';
    const slackPayload = {
      text: `:speech_balloon: *NexyFab support* — ${parsed.data.category}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*From:* ${userName} (${userEmail}) — \`${userId ?? 'guest'}\`\n*Page:* ${safePage ?? '—'}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '```' + safeMsg.slice(0, 1500) + '```' },
        },
      ],
    };
    void fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    }).catch(err => console.warn('[support-chat] slack post failed:', err));
  }

  return NextResponse.json({ ok: true, id });
});

// Retrieve chat history for the current user (logged-in only).
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ messages: [] });
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db.queryAll<{ id: string; role: string; message: string; created_at: number }>(
    `SELECT id, role, message, created_at FROM nf_support_messages
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    authUser.userId,
  );
  return NextResponse.json({ messages: rows.reverse() });
}
