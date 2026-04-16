import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import type { WebhookEvent } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic';

// GET — get current Slack integration
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const integration = await db.queryOne<{
    id: string; webhook_url: string; channel: string | null; events: string; status: string; created_at: number;
  }>(
    'SELECT id, webhook_url, channel, events, status, created_at FROM nf_slack_integrations WHERE user_id = ?',
    authUser.userId,
  );

  if (!integration) return NextResponse.json({ integration: null });

  return NextResponse.json({
    integration: {
      ...integration,
      webhookUrl: integration.webhook_url,
      events: JSON.parse(integration.events ?? '[]'),
    },
  });
}

// POST — create/update Slack integration
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    webhookUrl: z.string().url().refine(u => u.includes('hooks.slack.com') || u.includes('discord.com/api/webhooks'), {
      message: 'Slack 또는 Discord webhook URL이어야 합니다.',
    }),
    channel: z.string().max(100).optional(),
    events: z.array(z.string()).max(20).default([]),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  // Test the webhook first
  const testRes = await fetch(parsed.data.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '✅ NexyFab Slack 연동이 완료되었습니다!' }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);

  if (!testRes?.ok) {
    return NextResponse.json({ error: 'Webhook URL 테스트 실패. URL을 확인해주세요.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_slack_integrations WHERE user_id = ?', authUser.userId,
  );

  const now = Date.now();
  if (existing) {
    await db.execute(
      'UPDATE nf_slack_integrations SET webhook_url = ?, channel = ?, events = ?, status = ?, updated_at = ? WHERE user_id = ?',
      parsed.data.webhookUrl, parsed.data.channel ?? null, JSON.stringify(parsed.data.events), 'active', now, authUser.userId,
    );
  } else {
    await db.execute(
      'INSERT INTO nf_slack_integrations (id, user_id, webhook_url, channel, events, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `slack-${crypto.randomUUID()}`, authUser.userId, parsed.data.webhookUrl,
      parsed.data.channel ?? null, JSON.stringify(parsed.data.events), 'active', now, now,
    );
  }

  return NextResponse.json({ ok: true, message: '연동되었습니다. 테스트 메시지를 확인해주세요.' });
}

// DELETE — remove integration
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await db.execute('DELETE FROM nf_slack_integrations WHERE user_id = ?', authUser.userId);
  return NextResponse.json({ ok: true });
}
