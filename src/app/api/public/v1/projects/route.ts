// Public API v1 — projects list.
//   GET /api/public/v1/projects        — list authenticated user's projects
//   POST /api/public/v1/projects       — create a project (CI / scripted)
//
// Auth: API token via `Authorization: Bearer <token>` header. Tokens are
// issued from the user's settings page and stored as Personal Access Tokens
// in nf_api_keys. Falls back to session cookie auth so the same endpoint
// powers in-app dashboards.
//
// Rate limited by client IP at 60 req/min; tokens count against the user's
// plan limits.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { sanitizeText } from '@/lib/sanitize';
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIp } from '@/lib/client-ip';
import type { AuthUser } from '@/lib/auth-middleware';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type ProjectApiAccess =
  | { ok: false; response: NextResponse }
  | { ok: true; user: AuthUser; headers: Record<string, string> };

async function authorize(req: NextRequest, scope: 'read:projects' | 'write:projects'): Promise<ProjectApiAccess> {
  const user = await getAuthUser(req);
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS }) };
  if (user.apiKey && !user.apiKey.scopes.includes(scope)) {
    return { ok: false, response: NextResponse.json({ error: 'Insufficient API key scope', requiredScope: scope }, { status: 403, headers: CORS_HEADERS }) };
  }
  const identity = user.apiKey?.id ?? user.userId;
  const limit = rateLimit(`public-v1:projects:${identity}`, 60, 60_000);
  if (!limit.allowed) {
    return { ok: false, response: NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...CORS_HEADERS, ...rateLimitHeaders(limit, 60) } }) };
  }
  return { ok: true, user, headers: { ...CORS_HEADERS, ...rateLimitHeaders(limit, 60) } };
}

export async function GET(req: NextRequest) {
  const access = await authorize(req, 'read:projects');
  if (!access.ok) return access.response;
  const auth = access.user;
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
    { headers: access.headers },
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  shapeId: z.string().max(100).optional(),
  materialId: z.string().max(100).optional(),
  sceneData: z.string().max(5_000_000).optional(),
});

export async function POST(req: NextRequest) {
  const access = await authorize(req, 'write:projects');
  if (!access.ok) return access.response;
  const auth = access.user;
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
  logAudit({
    userId: auth.userId,
    action: 'public_api.projects.create',
    resourceId: id,
    metadata: { apiKeyId: auth.apiKey?.id ?? 'session', scope: 'write:projects' },
    ip: getTrustedClientIp(req.headers),
  });
  return NextResponse.json(
    { id, createdAt: now },
    { status: 201, headers: access.headers },
  );
}
