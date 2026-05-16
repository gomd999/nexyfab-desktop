// Email preference center API.
// Categories: transactional (always on; legally required), billing,
// product_updates, marketing, collab. Defaults: all on except marketing.
//
// GET — current preferences (auth required OR ?token=… signed link).
// PATCH — partial update. PATCH from a signed token also allowed so users
// can unsubscribe without logging in (matches the link in our outgoing mail).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export type EmailCategory = 'transactional' | 'billing' | 'product_updates' | 'marketing' | 'collab';

const CATEGORIES: EmailCategory[] = ['transactional', 'billing', 'product_updates', 'marketing', 'collab'];

const patchSchema = z.object({
  preferences: z.record(z.enum(CATEGORIES as [EmailCategory, ...EmailCategory[]]), z.boolean()).optional(),
  // For unsubscribe links — single category toggle by signed token.
  unsubscribe: z.enum(CATEGORIES as [EmailCategory, ...EmailCategory[]]).optional(),
  token: z.string().max(200).optional(),
});

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_email_preferences (
      user_id TEXT PRIMARY KEY,
      transactional INTEGER NOT NULL DEFAULT 1,
      billing INTEGER NOT NULL DEFAULT 1,
      product_updates INTEGER NOT NULL DEFAULT 1,
      marketing INTEGER NOT NULL DEFAULT 0,
      collab INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    )
  `);
}

function signToken(userId: string, category: EmailCategory): string {
  const secret = process.env.EMAIL_UNSUB_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-secret';
  const h = createHmac('sha256', secret);
  h.update(`${userId}:${category}`);
  return `${userId}.${category}.${h.digest('base64url').slice(0, 32)}`;
}

function verifyToken(token: string): { userId: string; category: EmailCategory } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, category, sig] = parts;
  if (!CATEGORIES.includes(category as EmailCategory)) return null;
  const expected = signToken(userId, category as EmailCategory).split('.')[2];
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    return timingSafeEqual(a, b) ? { userId, category: category as EmailCategory } : null;
  } catch { return null; }
}

/** Public helper: returns a signed unsubscribe URL for use in email templates. */
export function buildUnsubscribeUrl(userId: string, category: EmailCategory): string {
  const base = process.env.NEXT_PUBLIC_NEXYFAB_URL ?? 'https://nexyfab.com';
  return `${base}/kr/unsubscribe?token=${encodeURIComponent(signToken(userId, category))}&cat=${category}`;
}

export async function GET(req: NextRequest) {
  await ensureTable();
  const db = getDbAdapter();

  // Token-based read (from email link) — returns just the relevant category.
  const token = req.nextUrl.searchParams.get('token');
  if (token) {
    const verified = verifyToken(token);
    if (!verified) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    const row = await db.queryOne<Record<string, number>>(
      'SELECT * FROM nf_email_preferences WHERE user_id = ?',
      verified.userId,
    );
    return NextResponse.json({
      userId: verified.userId,
      category: verified.category,
      enabled: row ? Boolean(row[verified.category]) : verified.category !== 'marketing',
    });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await db.queryOne<Record<string, number>>(
    'SELECT * FROM nf_email_preferences WHERE user_id = ?',
    authUser.userId,
  );
  const prefs: Record<EmailCategory, boolean> = {
    transactional: row ? Boolean(row.transactional) : true,
    billing: row ? Boolean(row.billing) : true,
    product_updates: row ? Boolean(row.product_updates) : true,
    marketing: row ? Boolean(row.marketing) : false,
    collab: row ? Boolean(row.collab) : true,
  };
  return NextResponse.json({ preferences: prefs });
}

export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();

  let userId: string | null = null;
  const updates: Partial<Record<EmailCategory, boolean>> = parsed.data.preferences ?? {};

  // Path 1: signed token from email — single-category opt-out, no login.
  if (parsed.data.token && parsed.data.unsubscribe) {
    const verified = verifyToken(parsed.data.token);
    if (!verified || verified.category !== parsed.data.unsubscribe) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }
    userId = verified.userId;
    updates[verified.category] = false;
  } else {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = authUser.userId;
  }

  // Transactional is always on — protect from accidental opt-out.
  if (updates.transactional === false) updates.transactional = true;

  // Upsert.
  const existing = await db.queryOne<Record<string, number>>(
    'SELECT * FROM nf_email_preferences WHERE user_id = ?', userId,
  );
  const final: Record<EmailCategory, number> = {
    transactional: 1,
    billing: existing ? existing.billing : 1,
    product_updates: existing ? existing.product_updates : 1,
    marketing: existing ? existing.marketing : 0,
    collab: existing ? existing.collab : 1,
  };
  for (const cat of CATEGORIES) {
    if (cat in updates) final[cat] = updates[cat] ? 1 : 0;
  }

  if (existing) {
    await db.execute(
      `UPDATE nf_email_preferences
         SET transactional = ?, billing = ?, product_updates = ?, marketing = ?, collab = ?, updated_at = ?
       WHERE user_id = ?`,
      final.transactional, final.billing, final.product_updates, final.marketing, final.collab,
      Date.now(), userId,
    );
  } else {
    await db.execute(
      `INSERT INTO nf_email_preferences
         (user_id, transactional, billing, product_updates, marketing, collab, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId, final.transactional, final.billing, final.product_updates, final.marketing, final.collab,
      Date.now(),
    );
  }

  return NextResponse.json({ ok: true, preferences: final });
}
