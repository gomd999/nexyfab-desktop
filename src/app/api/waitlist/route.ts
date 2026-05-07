/**
 * POST /api/waitlist
 * 공개 API — 데스크톱 릴리즈 등 출시 알림 대기자 명단 등록.
 * body: { email: string, product?: string, lang?: string, source?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEN = 254;

// 10 submissions / hour per IP — generous enough for typos + retries, tight enough for bots
const WAITLIST_MAX = 10;
const WAITLIST_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const ip = getTrustedClientIp(req.headers);
    const rl = rateLimit(`waitlist:${ip}`, WAITLIST_MAX, WAITLIST_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    const body = await req.json() as {
      email?: string;
      product?: string;
      lang?: string;
      source?: string;
    };

    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || email.length > MAX_LEN || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'invalid email' }, { status: 400 });
    }

    const product = (body.product ?? 'nexyfab-desktop').slice(0, 64);
    const lang = body.lang ? String(body.lang).slice(0, 8) : null;
    const source = body.source ? String(body.source).slice(0, 64) : null;
    const ua = req.headers.get('user-agent')?.slice(0, 512) ?? null;

    const id = `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const db = getDbAdapter();

    await db.execute(
      `INSERT OR IGNORE INTO nf_waitlist
         (id, email, product, lang, source, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, email, product, lang, source, ua, Date.now(),
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
