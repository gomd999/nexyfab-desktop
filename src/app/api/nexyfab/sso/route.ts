import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { type SSOConfig } from './sso-types';

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function isTeamOrAbove(req: NextRequest): Promise<boolean> {
  const { getAuthUser } = await import('@/lib/auth-middleware');
  const { meetsPlan } = await import('@/lib/plan-guard');
  const user = await getAuthUser(req);
  return !!user && meetsPlan(user.plan, 'team');
}

function maskCert(cert: string | undefined): string | undefined {
  if (!cert) return undefined;
  if (cert.length <= 32) return '***';
  return `${cert.slice(0, 12)}...${cert.slice(-12)}`;
}

function safeConfig(cfg: SSOConfig): Omit<SSOConfig, 'clientSecret'> & { certificate?: string } {
  const { clientSecret: _omitted, certificate, ...rest } = cfg;
  return { ...rest, certificate: maskCert(certificate) };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface SSORow {
  provider: string | null;
  entity_id: string | null;
  sso_url: string | null;
  certificate: string | null;
  client_id: string | null;
  client_secret: string | null;
  issuer: string | null;
  enabled: number;
}

async function loadConfig(): Promise<SSOConfig> {
  const db = getDbAdapter();
  const row = await db.queryOne<SSORow>(
    `SELECT provider, entity_id, sso_url, certificate, client_id, client_secret, issuer, enabled
     FROM nf_sso_config WHERE id = 'singleton'`,
  );
  if (!row) return { provider: null, enabled: false };
  return {
    provider: (row.provider as SSOConfig['provider']) ?? null,
    entityId: row.entity_id ?? undefined,
    ssoUrl: row.sso_url ?? undefined,
    certificate: row.certificate ?? undefined,
    clientId: row.client_id ?? undefined,
    clientSecret: row.client_secret ?? undefined,
    issuer: row.issuer ?? undefined,
    enabled: row.enabled === 1,
  };
}

async function saveConfig(cfg: SSOConfig): Promise<void> {
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_sso_config
       (id, provider, entity_id, sso_url, certificate, client_id, client_secret, issuer, enabled, updated_at)
     VALUES ('singleton', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       entity_id = excluded.entity_id,
       sso_url = excluded.sso_url,
       certificate = excluded.certificate,
       client_id = excluded.client_id,
       client_secret = excluded.client_secret,
       issuer = excluded.issuer,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    cfg.provider ?? null,
    cfg.entityId ?? null,
    cfg.ssoUrl ?? null,
    cfg.certificate ?? null,
    cfg.clientId ?? null,
    cfg.clientSecret ?? null,
    cfg.issuer ?? null,
    cfg.enabled ? 1 : 0,
    Date.now(),
  );
}

// ─── GET /api/nexyfab/sso ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isTeamOrAbove(req))) {
    return NextResponse.json(
      { error: 'Team plan required', ko: 'Enterprise 플랜이 필요합니다' },
      { status: 403 },
    );
  }

  const config = await loadConfig();
  return NextResponse.json({ config: safeConfig(config) });
}

// ─── POST /api/nexyfab/sso ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isTeamOrAbove(req))) {
    return NextResponse.json(
      { error: 'Team plan required', ko: 'Enterprise 플랜이 필요합니다' },
      { status: 403 },
    );
  }

  const body = await req.json() as Partial<SSOConfig>;
  const current = await loadConfig();

  const updated: SSOConfig = {
    ...current,
    ...body,
    // Preserve stored secret/cert if not explicitly updated
    clientSecret: body.clientSecret ?? current.clientSecret,
    certificate: body.certificate ?? current.certificate,
  };

  await saveConfig(updated);

  return NextResponse.json({ ok: true, config: safeConfig(updated) });
}
