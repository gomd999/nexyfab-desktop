// Unified cohort admin: set subscription window and/or reset password for a list
// of emails, across BOTH user stores in one call —
//   1. NexyFab's own nf_users (direct email/password login, bcrypt), and
//   2. the Nexysys auth-server org/user (SSO login), via /admin/sync-account.
// Auth: x-admin-secret header (verifyAdmin → ADMIN_SECRET).
//
// Body: { emails: string[], subscriptionEndsAt?: string|null, password?: string }
//   subscriptionEndsAt: ISO string sets it, null clears it, omitted = unchanged.
//   password: present = reset it, omitted = unchanged.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AUTH_BASE = process.env.AUTH_SERVER_URL || 'https://auth.nexysys.com';

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    emails?: string[]; subscriptionEndsAt?: string | null; password?: string;
  } | null;
  if (!body?.emails?.length) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (!body.password && !Object.prototype.hasOwnProperty.call(body, 'subscriptionEndsAt')) {
    return NextResponse.json({ error: 'nothing_to_do' }, { status: 400 });
  }

  const setSub = Object.prototype.hasOwnProperty.call(body, 'subscriptionEndsAt');
  const subMs = setSub && body.subscriptionEndsAt != null ? Date.parse(body.subscriptionEndsAt) : null;
  if (setSub && body.subscriptionEndsAt != null && !Number.isFinite(subMs)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }
  const hash = body.password ? await bcrypt.hash(body.password, 12) : null;

  // 1. NexyFab nf_users
  const db = getDbAdapter();
  const nexyfab: Array<{ email: string; status: string }> = [];
  for (const raw of body.emails) {
    const email = String(raw).trim().toLowerCase();
    let changed = 0;
    if (hash) changed += (await db.execute('UPDATE nf_users SET password_hash = ? WHERE email = ?', hash, email)).changes;
    if (setSub) changed += (await db.execute('UPDATE nf_users SET subscription_ends_at = ? WHERE email = ?', subMs, email)).changes;
    nexyfab.push({ email, status: changed > 0 ? 'updated' : 'not_found' });
  }

  // 2. Nexysys auth-server (SSO store)
  let auth: unknown = { skipped: 'AUTH_SYNC_SECRET unset' };
  if (process.env.AUTH_SYNC_SECRET) {
    try {
      const payload: Record<string, unknown> = { emails: body.emails };
      if (setSub) payload.subscriptionEndsAt = body.subscriptionEndsAt ?? null;
      if (body.password) payload.password = body.password;
      const r = await fetch(`${AUTH_BASE}/admin/sync-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-secret': process.env.AUTH_SYNC_SECRET },
        body: JSON.stringify(payload),
      });
      auth = await r.json().catch(() => ({ error: `auth ${r.status}` }));
    } catch (e) {
      auth = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ nexyfab, auth });
}
