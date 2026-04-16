import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// GET — list all projects belonging to team members
export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { teamId } = await params;

  const db = getDbAdapter();

  // Verify the requester is a member of this team
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const isMember = team.owner_id === authUser.userId
    || !!(await db.queryOne(
      'SELECT id FROM nf_team_members WHERE team_id = ? AND user_id = ?',
      teamId, authUser.userId,
    ));
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Collect all member user_ids (owner + members)
  const members = await db.queryAll<{ user_id: string; email: string }>(
    'SELECT user_id, email FROM nf_team_members WHERE team_id = ?', teamId,
  );
  const memberIds = [team.owner_id, ...members.map(m => m.user_id)];

  // Fetch projects for all member ids (SQLite IN clause)
  const placeholders = memberIds.map(() => '?').join(',');
  const rows = await db.queryAll<{
    id: string; user_id: string; name: string; shape_id: string | null;
    tags: string | null; updated_at: number; created_at: number;
  }>(
    `SELECT id, user_id, name, shape_id, tags, updated_at, created_at
     FROM nf_projects WHERE user_id IN (${placeholders})
     ORDER BY updated_at DESC LIMIT 100`,
    ...memberIds,
  );

  // Build a user_id → email map for display
  const emailMap: Record<string, string> = { [team.owner_id]: 'owner' };
  for (const m of members) emailMap[m.user_id] = m.email;

  return NextResponse.json({
    projects: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      ownerEmail: emailMap[r.user_id] ?? r.user_id,
      name: r.name,
      shapeId: r.shape_id ?? undefined,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    })),
  });
}
