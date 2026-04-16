import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';

const collabSchema = z.object({
  projectId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  cursor: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }).optional(),
  action: z.enum(['join', 'leave', 'ping']).default('ping'),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface CollabSession {
  sessionId: string;
  projectId: string;
  userId: string;
  userName: string;
  cursor?: { x: number; y: number; z: number };
  lastPing: number;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 5_000;
const MAX_SESSIONS_PER_PROJECT = 10;
const CLEANUP_THROTTLE = 30_000;
let lastCleanup = 0;

const PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F59E0B',
];

function sessionColor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function rowToSession(row: Record<string, unknown>): CollabSession {
  return {
    sessionId: row.session_id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    userName: row.user_name as string,
    cursor: row.cursor ? JSON.parse(row.cursor as string) : undefined,
    color: row.color as string,
    lastPing: row.last_ping as number,
  };
}

async function purgeExpired(projectId: string): Promise<void> {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS;
  await getDbAdapter().execute(
    'DELETE FROM nf_collab_sessions WHERE project_id = ? AND last_ping < ?',
    projectId, cutoff,
  );
}

// ─── GET /api/nexyfab/collab?projectId= ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  if (Date.now() - lastCleanup > CLEANUP_THROTTLE) {
    lastCleanup = Date.now();
    await db.execute(
      'DELETE FROM nf_collab_sessions WHERE last_ping < ?',
      Date.now() - SESSION_TIMEOUT_MS,
    );
  }

  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM nf_collab_sessions WHERE project_id = ?',
    projectId,
  );

  return NextResponse.json({ projectId, sessions: rows.map(rowToSession) });
}

// ─── POST /api/nexyfab/collab ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await req.json() as Record<string, unknown>;

  const parsed = collabSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const { projectId, sessionId, cursor, action } = parsed.data;
  const userId = authUser.userId;
  const userName = authUser.email;

  await purgeExpired(projectId);

  const db = getDbAdapter();

  if (action === 'leave') {
    await db.execute(
      'DELETE FROM nf_collab_sessions WHERE session_id = ? AND project_id = ?',
      sessionId, projectId,
    );
    return NextResponse.json({ ok: true, action: 'leave' });
  }

  // join / ping
  const existing = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_collab_sessions WHERE session_id = ?',
    sessionId,
  );

  const now = Date.now();

  if (existing) {
    await db.execute(
      `UPDATE nf_collab_sessions SET
         last_ping = ?,
         cursor    = COALESCE(?, cursor)
       WHERE session_id = ?`,
      now, cursor ? JSON.stringify(cursor) : null, sessionId,
    );
  } else {
    // Atomic count-guarded insert: INSERT ... SELECT ... WHERE count < limit
    // This prevents race conditions where two concurrent requests both see count < 10
    const result = await db.execute(
      `INSERT INTO nf_collab_sessions
         (session_id, project_id, user_id, user_name, cursor, color, last_ping)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM nf_collab_sessions WHERE project_id = ?) < ?`,
      sessionId,
      projectId,
      userId,
      userName,
      cursor ? JSON.stringify(cursor) : null,
      sessionColor(sessionId),
      now,
      projectId,
      MAX_SESSIONS_PER_PROJECT,
    );

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Project session limit reached (max 10)' },
        { status: 429 },
      );
    }
  }

  const allRows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM nf_collab_sessions WHERE project_id = ?',
    projectId,
  );

  return NextResponse.json({ ok: true, action, sessions: allRows.map(rowToSession) });
}

// ─── OPTIONS /api/nexyfab/collab ──────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
  });
}
