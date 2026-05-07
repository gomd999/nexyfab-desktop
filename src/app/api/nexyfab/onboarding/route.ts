import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const row = await db.queryOne<{ onboarding_done_at: number | null }>(
    'SELECT onboarding_done_at FROM nf_users WHERE id = ?',
    authUser.userId,
  ).catch(() => null);

  return NextResponse.json({ done: !!row?.onboarding_done_at });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await db.execute(
    'UPDATE nf_users SET onboarding_done_at = ? WHERE id = ? AND onboarding_done_at IS NULL',
    Date.now(), authUser.userId,
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
