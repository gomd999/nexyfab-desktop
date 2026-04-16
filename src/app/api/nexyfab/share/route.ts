import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';

const createShareSchema = z.object({
  meshDataBase64: z.string().min(1).max(10_000_000),
  metadata: z.object({
    name: z.string().max(200).optional(),
    material: z.string().max(100).optional(),
    watermark: z.string().max(200).optional(),
    allowDownload: z.boolean().optional(),
    bbox: z.object({
      w: z.number(),
      h: z.number(),
      d: z.number(),
    }).optional(),
    volume_cm3: z.number().optional(),
    surface_area_cm2: z.number().optional(),
  }).optional(),
  expiresInHours: z.number().int().min(1).max(720).default(72), // 최대 30일
  lang: z.string().regex(/^[a-z]{2}$/).optional(),
});

interface ShareMetadata {
  name: string;
  material?: string;
  bbox?: { w: number; h: number; d: number };
  volume_cm3?: number;
  surface_area_cm2?: number;
  watermark?: string;
  allowDownload?: boolean;
}

// POST /api/nexyfab/share — Create a view-only share link
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`share-create:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many share requests' }, { status: 429 });
  }

  const authUser = await getAuthUser(req);

  const rawBody = await req.json() as Record<string, unknown>;

  const parsed = createShareSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const token = randomBytes(16).toString('hex');
  const { PLAN_SHARE_MAX_HOURS } = await import('@/lib/plan-guard');
  const maxHours = PLAN_SHARE_MAX_HOURS[authUser?.plan ?? 'free'] ?? 168;
  const expiresInHours = Math.min(body.expiresInHours, maxHours);
  const expiresAt = Date.now() + expiresInHours * 3_600_000;
  const now = Date.now();
  const metadata = body.metadata ?? { name: 'Shared Design' };
  const modelName = (metadata as ShareMetadata).name || 'Shared Design';

  const db = getDbAdapter();

  // Auto-increment version for same user + model name
  let version = 1;
  if (authUser) {
    const latest = await db.queryOne<{ max_ver: number | null }>(
      `SELECT MAX(version) as max_ver FROM nf_shares WHERE user_id = ? AND model_name = ?`,
      authUser.userId, modelName,
    );
    if (latest?.max_ver) version = latest.max_ver + 1;
  }

  await db.execute(
    `INSERT INTO nf_shares (token, user_id, mesh_data_base64, metadata, expires_at, view_count, created_at, version, model_name)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    token,
    authUser?.userId ?? null,
    body.meshDataBase64,
    JSON.stringify(metadata),
    expiresAt,
    now,
    version,
    modelName,
  );

  if (authUser) {
    logAudit({ userId: authUser.userId, action: 'share.create', resourceId: token, ip });
  }

  const origin = req.headers.get('origin') || 'https://nexyfab.com';
  const lang = body.lang ?? 'ko';
  const viewUrl = `${origin}/${lang}/share/${token}`;

  return NextResponse.json({ token, viewUrl, expiresAt, version }, { status: 201 });
}

// GET /api/nexyfab/share?token=xxx — Fetch mesh for viewer
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`share-view:${ip}`, 100, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const db = getDbAdapter();
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_shares WHERE token = ?',
    token,
  );

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (Date.now() > (row.expires_at as number)) {
    await db.execute('DELETE FROM nf_shares WHERE token = ?', token);
    return NextResponse.json({ error: 'Link expired' }, { status: 410 });
  }

  const newViewCount = (row.view_count as number) + 1;
  await db.execute('UPDATE nf_shares SET view_count = ? WHERE token = ?', newViewCount, token);

  // Get version history for same model
  const versions: { token: string; version: number; createdAt: number }[] = [];
  if (row.user_id && row.model_name) {
    const rows = await db.queryAll<{ token: string; version: number; created_at: number }>(
      `SELECT token, version, created_at FROM nf_shares
       WHERE user_id = ? AND model_name = ? AND expires_at > ?
       ORDER BY version DESC`,
      row.user_id as string, row.model_name as string, Date.now(),
    );
    for (const r of rows) {
      versions.push({ token: r.token, version: r.version, createdAt: r.created_at });
    }
  }

  return NextResponse.json({
    meshDataBase64: row.mesh_data_base64 as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : { name: 'Shared Design' },
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    viewCount: newViewCount,
    version: (row.version as number) || 1,
    versions,
  });
}
