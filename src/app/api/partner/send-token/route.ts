import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { sendNotificationEmail } from '@/app/lib/mailer';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// POST /api/partner/send-token
export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`partner-send-token:${ip}`, 3, 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const { partnerId, email, company } = await req.json() as { partnerId?: string; email?: string; company?: string };
  if (!partnerId || !email) {
    return NextResponse.json({ error: 'partnerId와 email이 필요합니다.' }, { status: 400 });
  }

  // 6-digit OTP (crypto-safe)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(100000 + (buf[0] % 900000));
  const tokenHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const id = `PT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_partner_tokens (id, partner_id, email, company, token_hash, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    id, partnerId, email.toLowerCase(), company ?? '', tokenHash, expiresAt, Date.now(),
  );

  try {
    await sendNotificationEmail(
      email,
      '[NexyFab] 파트너 포털 접속 코드',
      `<p>안녕하세요${company ? `, ${company}` : ''}님.</p>
<p>NexyFab 파트너 포털 접속 코드를 안내드립니다.</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:8px;color:#0b5cff;">${code}</p>
<p>유효시간: 24시간</p>
<p>접속 주소: <a href="/partner/login">/partner/login</a></p>
<br/><p>— NexyFab 팀</p>`,
    );
  } catch (e) {
    console.error('[send-token] 이메일 발송 실패:', e);
  }

  return NextResponse.json({
    ok: true,
    ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
  });
}
