import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface FactoryRow {
  id: string; name: string; partner_email: string | null;
  contact_email: string | null; contact_phone: string | null;
  tech_exp: string | null; match_field: string | null;
  capacity_amount: string | null; partner_type: string | null;
  status: string;
}

// GET /api/partner/profile
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getDbAdapter();

  // Look up factory row for this partner
  const factory = await db.queryOne<FactoryRow>(
    `SELECT id, name, partner_email, contact_email, contact_phone,
            tech_exp, match_field, capacity_amount, partner_type, status
     FROM nf_factories WHERE partner_email = ? LIMIT 1`,
    partner.email,
  );

  return NextResponse.json({
    profile: {
      partnerId: partner.partnerId,
      email: partner.email,
      company: factory?.name || partner.company || '',
      name: partner.company || '',
      phone: factory?.contact_phone || '',
      tech_exp: factory?.tech_exp || '',
      match_field: factory?.match_field || '',
      amount: factory?.capacity_amount || '',
      partner_type: factory?.partner_type || '',
      status: factory?.status || 'pending',
      factoryId: factory?.id || null,
    },
  });
}

// PATCH /api/partner/profile
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { company, phone, tech_exp, match_field, amount, partner_type } = body;

  const db = getDbAdapter();

  const factory = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_factories WHERE partner_email = ? LIMIT 1',
    partner.email,
  );

  if (factory) {
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [Date.now()];

    if (company !== undefined) { sets.push('name = ?'); vals.push(company); }
    if (phone !== undefined) { sets.push('contact_phone = ?'); vals.push(phone); }
    if (tech_exp !== undefined) { sets.push('tech_exp = ?'); vals.push(tech_exp); }
    if (match_field !== undefined) { sets.push('match_field = ?'); vals.push(match_field); }
    if (amount !== undefined) { sets.push('capacity_amount = ?'); vals.push(amount); }
    if (partner_type !== undefined) { sets.push('partner_type = ?'); vals.push(partner_type); }
    vals.push(factory.id);

    await db.execute(
      `UPDATE nf_factories SET ${sets.join(', ')} WHERE id = ?`,
      ...vals,
    );
  } else {
    // No factory row yet — create one
    const now = Date.now();
    await db.execute(
      `INSERT INTO nf_factories
        (id, name, partner_email, contact_email, contact_phone,
         tech_exp, match_field, capacity_amount, partner_type,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      `FAC-${now}`, company || partner.company || '', partner.email,
      partner.email, phone ?? null,
      tech_exp ?? null, match_field ?? null,
      amount ?? null, partner_type ?? null,
      now, now,
    );
  }

  return NextResponse.json({ ok: true });
}
