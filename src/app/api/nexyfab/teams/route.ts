import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { sendNotificationEmail } from '@/app/lib/mailer';

export const dynamic = 'force-dynamic';

// GET — list teams user belongs to
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbAdapter();

  const ownedTeams = await db.queryAll<{ id: string; name: string; plan: string; created_at: number }>(
    'SELECT id, name, plan, created_at FROM nf_teams WHERE owner_id = ?', authUser.userId,
  );
  const memberTeams = await db.queryAll<{ id: string; name: string; plan: string; role: string }>(
    `SELECT t.id, t.name, t.plan, tm.role
     FROM nf_team_members tm JOIN nf_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?`, authUser.userId,
  );

  return NextResponse.json({
    owned: ownedTeams,
    member: memberTeams,
  });
}

// POST — create team
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only team/enterprise plan can create teams
  if (!['team', 'enterprise'].includes(authUser.plan)) {
    return NextResponse.json({ error: 'Team 플랜 이상이 필요합니다.' }, { status: 403 });
  }

  const schema = z.object({ name: z.string().min(2).max(100) });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'name is required (2-100 chars)' }, { status: 400 });

  const db = getDbAdapter();
  const teamId = `team-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    'INSERT INTO nf_teams (id, name, owner_id, plan, created_at) VALUES (?, ?, ?, ?, ?)',
    teamId, parsed.data.name, authUser.userId, authUser.plan, now,
  );

  return NextResponse.json({ team: { id: teamId, name: parsed.data.name, ownerId: authUser.userId } }, { status: 201 });
}

// PATCH — rename team
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    teamId: z.string().min(1),
    name: z.string().min(2).max(100),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = getDbAdapter();
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', parsed.data.teamId,
  );
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (team.owner_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await db.execute('UPDATE nf_teams SET name = ? WHERE id = ?', parsed.data.name, parsed.data.teamId);
  return NextResponse.json({ ok: true, name: parsed.data.name });
}

// DELETE — delete team (owner only)
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { teamId } = await req.json().catch(() => ({})) as { teamId?: string };
  if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });

  const db = getDbAdapter();
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (team.owner_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await db.execute('DELETE FROM nf_teams WHERE id = ?', teamId);
  return NextResponse.json({ ok: true });
}
