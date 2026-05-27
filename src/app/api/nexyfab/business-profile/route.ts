// Business profile — verified company details for Pro 사업자 / 파트너 plans.
// Verifies the 사업자 등록번호 via the public NTS API
// (api.odcloud.kr/api/nts-businessman/v1/status) and stores the result.
// 등록증 (business registration certificate) is captured as an R2 URL in
// a follow-up POST; this endpoint focuses on the structured fields.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sanitizeText } from '@/lib/sanitize';

const profileSchema = z.object({
  // 10-digit business reg number (사업자등록번호). Allow common formats
  // (123-45-67890 / 1234567890) and normalize.
  brn: z.string().regex(/^\d{3}-?\d{2}-?\d{5}$/),
  legalName: z.string().min(1).max(200),
  representativeName: z.string().max(100).optional(),
  openedAt: z.string().regex(/^\d{8}$/).optional(),
  industryCode: z.string().max(20).optional(),
  /** Optional R2-hosted registration certificate URL. */
  certificateUrl: z.string().url().max(2000).optional(),
});

/** Strip dashes, return 10-digit BRN. */
function normalizeBrn(brn: string): string {
  return brn.replace(/-/g, '');
}

/**
 * Hit the NTS public API to verify the BRN is real + active. The API is
 * free, doesn't need a key (the public ODCloud endpoint), and returns a
 * structured status code we can use to gate "verified" badges.
 *
 * Returns null when the API is unreachable (so we don't block users on a
 * transient outage); callers should treat null as "not verified, pending".
 */
async function verifyBrnWithNts(brn: string, openedAt?: string, legalName?: string, repName?: string): Promise<{
  status: 'active' | 'closed' | 'suspended' | 'unknown';
  taxType?: string;
  raw?: unknown;
} | null> {
  const apiKey = process.env.ODCLOUD_NTS_API_KEY;
  if (!apiKey) return null; // misconfigured — treat as pending
  const url = `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businesses: [{
          b_no: brn,
          start_dt: openedAt ?? '',
          p_nm: repName ?? '',
          p_nm2: '',
          b_nm: legalName ?? '',
          corp_no: '',
          b_sector: '',
          b_type: '',
          b_adr: '',
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ valid?: string; status?: { b_stt_cd?: string; tax_type?: string } }> };
    const item = data.data?.[0];
    if (!item) return { status: 'unknown' };
    const cd = item.status?.b_stt_cd;
    const status = cd === '01' ? 'active' : cd === '02' ? 'closed' : cd === '03' ? 'suspended' : 'unknown';
    return { status, taxType: item.status?.tax_type, raw: item };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const brn = normalizeBrn(parsed.data.brn);
  const legalName = sanitizeText(parsed.data.legalName);
  const repName = parsed.data.representativeName ? sanitizeText(parsed.data.representativeName) : null;

  const verification = await verifyBrnWithNts(brn, parsed.data.openedAt, legalName, repName ?? undefined);

  const db = getDbAdapter();
  try {
    await db.execute(`ALTER TABLE nf_users ADD COLUMN account_type TEXT DEFAULT 'individual'`);
  } catch { /* exists */ }
  // Create the business_profiles table on first use.
  await db.execute(
    `CREATE TABLE IF NOT EXISTS nf_business_profiles (
      user_id TEXT PRIMARY KEY,
      brn TEXT NOT NULL,
      legal_name TEXT NOT NULL,
      representative_name TEXT,
      opened_at TEXT,
      industry_code TEXT,
      certificate_url TEXT,
      verification_status TEXT,
      verification_raw TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  );

  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_business_profiles
       (user_id, brn, legal_name, representative_name, opened_at, industry_code,
        certificate_url, verification_status, verification_raw, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       brn = excluded.brn,
       legal_name = excluded.legal_name,
       representative_name = excluded.representative_name,
       opened_at = excluded.opened_at,
       industry_code = excluded.industry_code,
       certificate_url = COALESCE(excluded.certificate_url, nf_business_profiles.certificate_url),
       verification_status = excluded.verification_status,
       verification_raw = excluded.verification_raw,
       updated_at = excluded.updated_at`,
    authUser.userId,
    brn,
    legalName,
    repName,
    parsed.data.openedAt ?? null,
    parsed.data.industryCode ?? null,
    parsed.data.certificateUrl ?? null,
    verification?.status ?? 'pending',
    verification ? JSON.stringify(verification.raw) : null,
    now, now,
  );
  // Promote the user to business account type so subsequent gates flip.
  await db.execute(
    `UPDATE nf_users SET account_type = 'business', updated_at = ? WHERE id = ?`,
    now, authUser.userId,
  );

  return NextResponse.json({
    ok: true,
    brn,
    legalName,
    verificationStatus: verification?.status ?? 'pending',
    note: verification === null
      ? 'NTS API unavailable — verification queued, badge will appear within 24h.'
      : verification.status === 'active'
        ? 'BRN verified — active.'
        : `BRN status: ${verification.status}`,
  });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbAdapter();
  try {
    const row = await db.queryOne<{
      brn?: string; legal_name?: string; representative_name?: string;
      opened_at?: string; industry_code?: string; certificate_url?: string;
      verification_status?: string;
    }>(
      'SELECT brn, legal_name, representative_name, opened_at, industry_code, certificate_url, verification_status FROM nf_business_profiles WHERE user_id = ?',
      authUser.userId,
    );
    if (!row) return NextResponse.json({ profile: null });
    return NextResponse.json({
      profile: {
        brn: row.brn,
        legalName: row.legal_name,
        representativeName: row.representative_name,
        openedAt: row.opened_at,
        industryCode: row.industry_code,
        certificateUrl: row.certificate_url,
        verificationStatus: row.verification_status,
      },
    });
  } catch {
    return NextResponse.json({ profile: null });
  }
}
