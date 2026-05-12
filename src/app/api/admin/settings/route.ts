/**
 * GET  /api/admin/settings           — admin: list known settings (masked)
 * POST /api/admin/settings           — super_admin: rotate / set a value
 * DELETE /api/admin/settings?key=…   — super_admin: clear a setting (revert to env)
 *
 * The list is built from KNOWN_SETTINGS (a curated catalog) joined with
 * the actual nf_admin_settings rows. Catalog-driven so new secrets need
 * an explicit code change — operators can't accidentally create a typo'd
 * setting that nothing reads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin, verifySuperAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import {
  getSetting, setSetting, deleteSetting, maskSecret,
} from '@/lib/admin-settings';
import { recordAdminAudit } from '@/lib/admin-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Curated catalog. Adding a setting here makes it visible in the admin
// UI; without an entry, the page won't show it (defense against typos).
const KNOWN_SETTINGS: Array<{
  key: string;
  scope: 'api_key' | 'feature_flag' | 'budget' | 'config';
  description: string;
}> = [
  // AI provider keys
  { key: 'deepseek.api_key',  scope: 'api_key', description: 'DeepSeek API key (chat fallback chain)' },
  { key: 'anthropic.api_key', scope: 'api_key', description: 'Anthropic Claude API key' },
  { key: 'openai.api_key',    scope: 'api_key', description: 'OpenAI API key (vision + chat fallback)' },
  { key: 'gemini.api_key',    scope: 'api_key', description: 'Google Gemini API key' },
  // Payment
  { key: 'toss.secret_key',     scope: 'api_key', description: 'Toss Payments server-side secret' },
  { key: 'toss.webhook_secret', scope: 'api_key', description: 'Toss webhook signature verification key' },
  // Email
  { key: 'smtp.pass', scope: 'api_key', description: 'SMTP / Resend password' },
  // R2 storage
  { key: 's3.access_key_id',     scope: 'api_key', description: 'Cloudflare R2 access key' },
  { key: 's3.secret_access_key', scope: 'api_key', description: 'Cloudflare R2 secret key' },
  // Budget thresholds (plain values)
  { key: 'budget.daily_usd_cap',  scope: 'budget', description: '일일 AI 비용 자동 차단 임계 (USD)' },
  { key: 'budget.hourly_usd_cap', scope: 'budget', description: '시간당 AI 비용 자동 차단 임계 (USD)' },
  // Feature flag overrides (true/false; absent = code default)
  { key: 'feature.scad_agent.enabled', scope: 'feature_flag', description: 'AI SCAD Agent 활성화 (false 면 503 반환)' },
  { key: 'feature.scad_agent.beta',    scope: 'feature_flag', description: 'BetaBanner 표시 여부 (false 면 숨김)' },
];

interface SettingRow {
  key: string;
  value_plain: string | null;
  value_encrypted: string | null;
  scope: string;
  description: string | null;
  updated_by: string | null;
  updated_at: number | null;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const isSuper = await verifySuperAdmin(req);

  const db = getDbAdapter();
  const rows = await db.queryAll<SettingRow>(
    'SELECT key, value_plain, value_encrypted, scope, description, updated_by, updated_at FROM nf_admin_settings',
  ).catch((): SettingRow[] => []);
  const byKey = new Map(rows.map(r => [r.key, r]));

  const settings = await Promise.all(KNOWN_SETTINGS.map(async catalog => {
    const row = byKey.get(catalog.key);
    const value = await getSetting(catalog.key);
    const source: 'db' | 'env' | 'unset' = row ? 'db' : (value ? 'env' : 'unset');
    return {
      key: catalog.key,
      scope: catalog.scope,
      description: catalog.description,
      maskedValue: maskSecret(value),
      // Plain values (budget thresholds) are visible to admins; secrets only show length.
      plainValue: catalog.scope !== 'api_key' && isSuper ? value : null,
      hasValue: !!value,
      source,
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at != null ? Number(row.updated_at) : null,
    };
  }));

  return NextResponse.json({
    ok: true,
    isSuper: !!isSuper,
    settings,
  });
}

export async function POST(req: NextRequest) {
  const superAdmin = await verifySuperAdmin(req);
  if (!superAdmin) {
    return NextResponse.json({
      error: 'Forbidden — super_admin role required to mutate settings',
    }, { status: 403 });
  }

  let body: { key?: unknown; value?: unknown; description?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const value = typeof body.value === 'string' ? body.value : '';
  if (!key || !value) {
    return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  }
  const catalog = KNOWN_SETTINGS.find(s => s.key === key);
  if (!catalog) {
    return NextResponse.json({
      error: `unknown setting key '${key}' — must be in KNOWN_SETTINGS catalog`,
    }, { status: 400 });
  }

  // Light value-shape sanity (so a typo doesn't bork production).
  if (catalog.scope === 'budget') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'budget value must be a non-negative number' }, { status: 400 });
    }
  }
  if (catalog.scope === 'api_key' && value.length < 8) {
    return NextResponse.json({ error: 'api_key value too short' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.slice(0, 300) : catalog.description;
  const { oldHash, newHash } = await setSetting(key, value, {
    scope: catalog.scope,
    description,
    updatedBy: superAdmin.userId,
  });

  await recordAdminAudit(req, {
    adminUserId: superAdmin.userId,
    action: 'setting.rotate',
    target: key,
    oldValueHash: oldHash, newValueHash: newHash,
    metadata: { scope: catalog.scope, valueLength: value.length },
  });

  return NextResponse.json({
    ok: true,
    key,
    rotated: oldHash !== null,
    newHash,
  });
}

export async function DELETE(req: NextRequest) {
  const superAdmin = await verifySuperAdmin(req);
  if (!superAdmin) {
    return NextResponse.json({ error: 'Forbidden — super_admin only' }, { status: 403 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  // Capture old value hash for audit before deleting.
  const oldValue = await getSetting(key);
  await deleteSetting(key);
  await recordAdminAudit(req, {
    adminUserId: superAdmin.userId,
    action: 'setting.clear',
    target: key,
    oldValueHash: oldValue ? createHash('sha256').update(oldValue).digest('hex') : null,
    newValueHash: null,
    metadata: {},
  });
  return NextResponse.json({ ok: true, key });
}
