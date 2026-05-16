// Account type endpoint — stores whether the user is an individual or a
// business. Used by onboarding (post-signup card) and Settings to flip
// later. The actual sajaeobsa verification (NTS API + 등록증 upload) lives
// in /api/nexyfab/business-profile.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sanitizeText } from '@/lib/sanitize';

const schema = z.object({
  accountType: z.enum(['individual', 'business']),
  companyName: z.string().max(200).optional(),
  role: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const db = getDbAdapter();
  // Ensure the column exists — idempotent schema bump. Sqlite-flavored:
  // ALTER TABLE ... ADD COLUMN fails if column already exists, so we swallow.
  try {
    await db.execute(`ALTER TABLE nf_users ADD COLUMN account_type TEXT DEFAULT 'individual'`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE nf_users ADD COLUMN onboarding_completed INTEGER DEFAULT 0`);
  } catch { /* already exists */ }

  const safeCompany = parsed.data.companyName ? sanitizeText(parsed.data.companyName) : null;
  const safeRole = parsed.data.role ? sanitizeText(parsed.data.role) : null;

  await db.execute(
    `UPDATE nf_users
       SET account_type = ?, company = COALESCE(?, company), onboarding_completed = 1, updated_at = ?
     WHERE id = ?`,
    parsed.data.accountType,
    safeCompany,
    Date.now(),
    authUser.userId,
  );

  return NextResponse.json({
    ok: true,
    accountType: parsed.data.accountType,
    companyName: safeCompany,
    role: safeRole,
  });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  try {
    const row = await db.queryOne<{ account_type?: string; company?: string; onboarding_completed?: number }>(
      'SELECT account_type, company, onboarding_completed FROM nf_users WHERE id = ?',
      authUser.userId,
    );
    return NextResponse.json({
      accountType: row?.account_type ?? 'individual',
      companyName: row?.company ?? null,
      onboardingCompleted: !!row?.onboarding_completed,
    });
  } catch {
    // Schema not yet migrated — degrade gracefully.
    return NextResponse.json({ accountType: 'individual', companyName: null, onboardingCompleted: false });
  }
}
