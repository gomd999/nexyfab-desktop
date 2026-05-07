/**
 * POST /api/contact
 *
 * 공개 문의 폼 엔드포인트. 로그인/비로그인 모두 허용.
 *
 * Body: {
 *   name: string,
 *   email: string,
 *   category?: 'general'|'order'|'partner'|'billing'|'bug'|'other',
 *   subject: string,
 *   message: string,
 *   context?: Record<string, unknown>   // 현재 페이지/orderId 등 자동 컨텍스트
 * }
 *
 * Rate limit: IP 당 5분에 5건.
 *
 * 저장: nf_support_tickets
 * 알림: ADMIN_EMAIL (있을 때) 로 enqueueJob('send_email')
 *       opsAlert('warning') 로 Slack 미러링 (webhook 있을 때)
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';
import { enqueueJob } from '@/lib/job-queue';
import { opsAlert } from '@/lib/ops-alert';
import { getTrustedClientIp } from '@/lib/client-ip';

const ALLOWED_CATEGORIES = new Set([
  'general', 'order', 'partner', 'billing', 'bug', 'other',
]);

interface RequestBody {
  name?: string;
  email?: string;
  category?: string;
  subject?: string;
  message?: string;
  context?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ip = getTrustedClientIp(req.headers);
  const limit = rateLimit(`contact:${ip}`, 5, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = sanitizeText(body.name).slice(0, 100);
  const email = sanitizeText(body.email).slice(0, 200).toLowerCase();
  const subject = sanitizeText(body.subject).slice(0, 200);
  const message = sanitizeText(body.message).slice(0, 5000);
  const category = ALLOWED_CATEGORIES.has(body.category ?? '')
    ? body.category!
    : 'general';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!subject || subject.length < 3) {
    return NextResponse.json({ error: 'Subject is too short' }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json({ error: 'Message is too short' }, { status: 400 });
  }

  const auth = await getAuthUser(req).catch(() => null);
  const id = `tkt-${randomUUID()}`;
  const now = Date.now();
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500);
  const contextJson = body.context
    ? JSON.stringify(body.context).slice(0, 4000)
    : null;

  const db = getDbAdapter();
  try {
    await db.execute(
      `INSERT INTO nf_support_tickets
         (id, user_id, email, name, category, subject, message, context,
          status, ip, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      id,
      auth?.userId ?? null,
      email,
      name || null,
      category,
      subject,
      message,
      contextJson,
      ip,
      userAgent,
      now,
      now,
    );
  } catch (err) {
    console.error('[contact] persist failed:', err);
    await opsAlert('critical', 'Support ticket persist failed', {
      email, subject, error: String(err),
    });
    return NextResponse.json({ error: 'Could not save ticket' }, { status: 500 });
  }

  // 관리자 이메일 알림 (best-effort)
  const adminEmail = process.env.SEND_MAIL_RECIPIENTS || process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const html = `
      <h2>New Support Ticket</h2>
      <p><strong>ID:</strong> ${id}</p>
      <p><strong>Category:</strong> ${category}</p>
      <p><strong>From:</strong> ${escapeHtml(name || '(no name)')} &lt;${escapeHtml(email)}&gt;</p>
      <p><strong>User:</strong> ${auth?.userId ?? '(guest)'}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <hr/>
      <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message)}</pre>
      ${contextJson ? `<hr/><pre style="font-size:12px;color:#666">${escapeHtml(contextJson)}</pre>` : ''}
    `;
    await enqueueJob('send_email', {
      to: adminEmail,
      subject: `[NexyFab Support] ${subject}`,
      html,
    }).catch(err => console.error('[contact] enqueue failed:', err));
  }

  await opsAlert('info', `New support ticket: ${subject}`, {
    id, email, category, userId: auth?.userId ?? '(guest)',
  });

  return NextResponse.json({ ok: true, id });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
