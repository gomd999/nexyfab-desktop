import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';

export const dynamic = 'force-dynamic';

const PLAN_KEY_LIMITS: Record<string, number> = {
  free: 0, pro: 1, team: -1, enterprise: -1, // -1 = unlimited
};

const VALID_SCOPES = [
  'read:rfq', 'write:rfq',
  'read:contracts', 'write:contracts',
  'read:quotes', 'write:quotes',
  'read:projects',
  'read:bom', 'write:bom',
  'webhooks:manage',
];

// GET — list API keys (never expose full key)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const keys = await db.queryAll<{
    id: string; name: string; key_prefix: string; scopes: string;
    ip_whitelist: string; status: string; last_used_at: number | null;
    expires_at: number | null; created_at: number;
  }>(
    "SELECT id, name, key_prefix, scopes, ip_whitelist, status, last_used_at, expires_at, created_at FROM nf_api_keys WHERE user_id = ? AND status != 'revoked' ORDER BY created_at DESC",
    authUser.userId,
  );

  return NextResponse.json({
    keys: keys.map(k => ({
      ...k,
      keyPreview: `${k.key_prefix}...`,
      scopes: JSON.parse(k.scopes ?? '[]'),
      ipWhitelist: JSON.parse(k.ip_whitelist ?? '[]'),
    })),
    validScopes: VALID_SCOPES,
    planLimit: PLAN_KEY_LIMITS[authUser.plan] ?? 0,
  });
}

// POST — create API key
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = PLAN_KEY_LIMITS[authUser.plan] ?? 0;
  if (limit === 0) return NextResponse.json({ error: 'API Key는 Pro 플랜 이상에서 사용할 수 있습니다.' }, { status: 403 });

  const schema = z.object({

    name: z.string().min(1).max(100),
    scopes: z.array(z.string()).max(20).default([]),
    ipWhitelist: z.array(z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/, 'Invalid IP')).max(20).default([]),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const db = getDbAdapter();
  const count = await db.queryOne<{ c: number }>(
    "SELECT COUNT(*) as c FROM nf_api_keys WHERE user_id = ? AND status = 'active'",
    authUser.userId,
  );
  if (limit !== -1 && (count?.c ?? 0) >= limit) {
    return NextResponse.json({ error: `이 플랜에서는 최대 ${limit}개의 API Key를 생성할 수 있습니다.` }, { status: 400 });
  }

  // Generate: nf_live_<32 random bytes hex>
  const rawKey = `nf_live_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 16); // "nf_live_xxxxxxxx"

  const id = `ak-${crypto.randomUUID()}`;
  const now = Date.now();
  const expiresAt = parsed.data.expiresInDays
    ? now + parsed.data.expiresInDays * 86_400_000
    : null;

  await db.execute(
    `INSERT INTO nf_api_keys (id, user_id, name, key_hash, key_prefix, scopes, ip_whitelist, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    id, authUser.userId, parsed.data.name, keyHash, keyPrefix,
    JSON.stringify(parsed.data.scopes),
    JSON.stringify(parsed.data.ipWhitelist),
    expiresAt, now,
  );

  // Return the raw key ONCE — it cannot be retrieved again
  return NextResponse.json({
    key: rawKey,
    id,
    name: parsed.data.name,
    keyPrefix,
    scopes: parsed.data.scopes,
    ipWhitelist: parsed.data.ipWhitelist,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    warning: 'API Key는 지금만 표시됩니다. 안전하게 보관하세요.',
  }, { status: 201 });
}

// DELETE — revoke API key
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  const result = await db.execute(
    "UPDATE nf_api_keys SET status = 'revoked' WHERE id = ? AND user_id = ?",
    id, authUser.userId,
  );

  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
