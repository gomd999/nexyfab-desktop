// One-time trial-cohort seeder for NexyFab's own user store (nf_users).
// Auth: x-admin-secret header (verifyAdmin → ADMIN_SECRET). bcrypt-hashes the
// shared password and inserts via the app's db-adapter (no external DB access).
// Idempotent: existing emails are skipped. Remove this route after use.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { emails?: string[]; password?: string; plan?: string } | null;
  if (!body?.emails?.length || !body.password) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const db = getDbAdapter();
  const plan = body.plan || 'pro';
  const now = Date.now();
  const results: Array<{ email: string; status: string }> = [];

  for (const raw of body.emails) {
    const email = String(raw).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { results.push({ email, status: 'invalid' }); continue; }
    const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_users WHERE email = ?', email);
    if (existing) { results.push({ email, status: 'exists' }); continue; }

    const id = crypto.randomUUID();
    const name = email.split('@')[0];
    const hash = await bcrypt.hash(body.password, 12);
    await db.execute(
      `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at,
        signup_source, language, country, timezone, company, last_login_at, login_count, signup_ip, last_login_ip,
        services, signup_service, nexyfab_plan, updated_at, terms_agreed_at, privacy_agreed_at, age_confirmed)
       VALUES (?, ?, ?, ?, ?, TRUE, 0, ?, 'email', 'ko', NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, 'nexyfab', ?, ?, ?, ?, TRUE)`,
      id, email, name, hash, plan, now, JSON.stringify(['nexyfab']), plan, now, now, now,
    );
    results.push({ email, status: 'created' });
  }

  return NextResponse.json({ results, plan });
}
