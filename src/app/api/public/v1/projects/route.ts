// Public API v1 — projects list.
//   GET /api/public/v1/projects        — list authenticated user's projects
//   POST /api/public/v1/projects       — create a project (CI / scripted)
//
// Auth: API token via `Authorization: Bearer <token>` header. Tokens are
// issued from the user's settings page and stored as Personal Access Tokens
// in nf_api_tokens. Falls back to session cookie auth so the same endpoint
// powers in-app dashboards.
//
// Rate limited by client IP at 60 req/min; tokens count against the user's
// plan limits.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { sanitizeText } from '@/lib/sanitize';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function authenticate(req: NextRequest): Promise<{ userId: string } | null> {
  // Bearer token first.
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) {
      const db = getDbAdapter();
      // The api_tokens table is set up elsewhere; fall back to null if not.
      try {
        const row = await db.queryOne<Record<string, unknown>>(
          'SELECT user_id, revoked_at FROM nf_api_tokens WHERE token_hash = ? LIMIT 1',
          await hashToken(token),
        );
        if (row && !row.revoked_at) return { userId: row.user_id as string };
      } catch { /* table may not exist yet */ }
    }
  }
  // Session cookie.
  const u = await getAuthUser(req);
  if (u) return { userId: u.userId };
  return null;
}

async function hashToken(t: string): Promise<string> {
  // SHA-256 base64. Tokens are never stored plain; the user sees them once
  // at issue time.
  const data = new TextEncoder().encode(t);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(buf).toString('base64');
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  const db = getDbAdapter();
  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT id, name, shape_id, material_id, created_at, updated_at FROM nf_projects WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100',
    auth.userId,
  );
  return NextResponse.json(
    {
      projects: rows.map(r => ({
        id: r.id,
        name: r.name,
        shapeId: r.shape_id ?? null,
        materialId: r.material_id ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    },
    { headers: CORS_HEADERS },
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  shapeId: z.string().max(100).optional(),
  materialId: z.string().max(100).optional(),
  sceneData: z.string().max(5_000_000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400, headers: CORS_HEADERS });
  }
  const db = getDbAdapter();
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_projects (id, user_id, name, shape_id, material_id, scene_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    auth.userId,
    sanitizeText(parsed.data.name),
    parsed.data.shapeId ?? null,
    parsed.data.materialId ?? null,
    parsed.data.sceneData ?? null,
    now,
    now,
  );
  return NextResponse.json(
    { id, createdAt: now },
    { status: 201, headers: CORS_HEADERS },
  );
}
