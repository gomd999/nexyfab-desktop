import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    token: z.string().min(4).max(200),
    expiresInDays: z.number().int().min(1).max(3650).default(365), // default 1 year
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const db = getDbAdapter();
  const newExpiry = Date.now() + parsed.data.expiresInDays * 86_400_000;

  const result = await db.execute(
    'UPDATE nf_shares SET expires_at = ? WHERE token = ? AND user_id = ?',
    newExpiry, parsed.data.token, authUser.userId,
  );

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Share not found or access denied' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, expiresAt: new Date(newExpiry).toISOString() });
}
