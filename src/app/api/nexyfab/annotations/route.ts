import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_3d_annotations (
      id          TEXT PRIMARY KEY,
      share_token TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT 'user',
      x           REAL NOT NULL,
      y           REAL NOT NULL,
      z           REAL NOT NULL,
      text        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#f59e0b',
      resolved    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_token ON nf_3d_annotations(share_token);
  `).catch(() => {});
}

// GET /api/nexyfab/annotations?token=xxx
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();
  const rows = await db.queryAll<{
    id: string; author_name: string; author_role: string;
    x: number; y: number; z: number; text: string;
    color: string; resolved: number; created_at: number;
  }>(
    'SELECT id, author_name, author_role, x, y, z, text, color, resolved, created_at FROM nf_3d_annotations WHERE share_token = ? ORDER BY created_at ASC',
    token,
  );

  return NextResponse.json({
    annotations: rows.map(r => ({
      id: r.id,
      authorName: r.author_name,
      authorRole: r.author_role,
      position: { x: r.x, y: r.y, z: r.z },
      text: r.text,
      color: r.color,
      resolved: !!r.resolved,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}

// POST — add annotation
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) return NextResponse.json({ error: 'Pro plan required for 3D annotations.' }, { status: 403 });

  const schema = z.object({
    shareToken: z.string().min(4).max(200),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    text: z.string().min(1).max(500),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f59e0b'),
    authorRole: z.enum(['user', 'partner', 'admin']).default('user'),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();
  const id = `ann-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_3d_annotations (id, share_token, author_id, author_name, author_role, x, y, z, text, color, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id, parsed.data.shareToken, authUser.userId, authUser.email,
    parsed.data.authorRole, parsed.data.x, parsed.data.y, parsed.data.z,
    parsed.data.text, parsed.data.color, now,
  );

  return NextResponse.json({ annotation: { id, authorName: authUser.email, ...parsed.data } }, { status: 201 });
}

// PATCH — resolve/unresolve annotation
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, resolved } = await req.json().catch(() => ({})) as { id?: string; resolved?: boolean };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  await db.execute(
    'UPDATE nf_3d_annotations SET resolved = ? WHERE id = ? AND author_id = ?',
    resolved ? 1 : 0, id, authUser.userId,
  );
  return NextResponse.json({ ok: true });
}

// DELETE — remove annotation (own only)
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  await db.execute('DELETE FROM nf_3d_annotations WHERE id = ? AND author_id = ?', id, authUser.userId);
  return NextResponse.json({ ok: true });
}
