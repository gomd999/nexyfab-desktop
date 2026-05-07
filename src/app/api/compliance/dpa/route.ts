/**
 * GET  /api/compliance/dpa   — return current DPA version + user's last acceptance
 * POST /api/compliance/dpa   — record acceptance for the authenticated user
 *
 * Auditability is the point here: we never mutate the DPA, we append a
 * new row every time the user accepts. If a privacy authority asks us
 * to prove when a user consented to a specific version, the answer is
 * one SELECT away.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { CURRENT_DPA_VERSION, regimeForCountry, type DpaConsent } from '@/lib/compliance';
import type { CountryCode } from '@/lib/country-pricing';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

interface ConsentRow {
  id: string;
  user_id: string;
  version: string;
  regime: string;
  ip: string | null;
  user_agent: string | null;
  accepted_at: number;
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const latest = await db.queryOne<ConsentRow>(
    'SELECT * FROM nf_dpa_consent WHERE user_id = ? ORDER BY accepted_at DESC LIMIT 1',
    authUser.userId,
  ).catch(() => null);

  return NextResponse.json({
    currentVersion: CURRENT_DPA_VERSION,
    accepted: latest ? {
      version:    latest.version,
      regime:     latest.regime,
      acceptedAt: latest.accepted_at,
      current:    latest.version === CURRENT_DPA_VERSION,
    } : null,
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    country?: string;
    version?: string;
  };
  const country = (body.country ?? 'KR') as CountryCode;
  const version = body.version ?? CURRENT_DPA_VERSION;

  const db = getDbAdapter();
  const row: DpaConsent = {
    userId:     authUser.userId,
    version,
    regime:     regimeForCountry(country),
    acceptedAt: Date.now(),
    ip:         getTrustedClientIpOrUndefined(req.headers),
    userAgent:  req.headers.get('user-agent') ?? undefined,
  };

  await db.execute(
    `INSERT INTO nf_dpa_consent (id, user_id, version, regime, ip, user_agent, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `dpa-${randomUUID()}`,
    row.userId, row.version, row.regime,
    row.ip ?? null, row.userAgent ?? null, row.acceptedAt,
  );

  return NextResponse.json({ ok: true, accepted: row });
}
