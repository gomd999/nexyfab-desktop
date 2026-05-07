import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET — list BOMs (own + optional team BOMs)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbAdapter();

  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get('teamId');

  if (teamId) {
    // Verify requester is a member of the team
    const membership = await db.queryOne<{ id: string }>(
      'SELECT id FROM nf_team_members WHERE team_id = ? AND user_id = ?',
      teamId, authUser.userId,
    );
    // Also allow the team owner
    const teamOwner = await db.queryOne<{ owner_id: string }>(
      'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
    );
    const isMember = !!membership || teamOwner?.owner_id === authUser.userId;
    if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Return own BOMs + all BOMs shared with this team
    const boms = await db.queryAll<{ id: string; name: string; user_id: string; status: string; created_at: number; updated_at: number }>(
      `SELECT id, name, user_id, status, created_at, updated_at FROM nf_bom
       WHERE user_id = ? OR team_id = ?
       ORDER BY updated_at DESC`,
      authUser.userId, teamId,
    );
    return NextResponse.json({ boms });
  }

  // Default: own BOMs only
  const boms = await db.queryAll<{ id: string; name: string; status: string; created_at: number; updated_at: number }>(
    'SELECT id, name, status, created_at, updated_at FROM nf_bom WHERE user_id = ? ORDER BY updated_at DESC',
    authUser.userId,
  );
  return NextResponse.json({ boms });
}

// POST — create BOM
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) return NextResponse.json({ error: 'Pro plan required for BOM management.' }, { status: 403 });

  const schema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    teamId: z.string().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const db = getDbAdapter();

  // If teamId is provided, verify the requester is a member or owner of that team
  if (parsed.data.teamId) {
    const membership = await db.queryOne<{ id: string }>(
      'SELECT id FROM nf_team_members WHERE team_id = ? AND user_id = ?',
      parsed.data.teamId, authUser.userId,
    );
    const teamOwner = await db.queryOne<{ owner_id: string }>(
      'SELECT owner_id FROM nf_teams WHERE id = ?', parsed.data.teamId,
    );
    const isMember = !!membership || teamOwner?.owner_id === authUser.userId;
    if (!isMember) return NextResponse.json({ error: 'Forbidden: not a member of this team' }, { status: 403 });
  }

  const id = `bom-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    'INSERT INTO nf_bom (id, name, user_id, team_id, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, parsed.data.name, authUser.userId, parsed.data.teamId ?? null, parsed.data.description ?? null, 'draft', now, now,
  );

  return NextResponse.json({ bom: { id, name: parsed.data.name, status: 'draft', teamId: parsed.data.teamId ?? null } }, { status: 201 });
}
