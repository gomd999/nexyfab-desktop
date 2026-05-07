import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail } from '@/lib/partner-factory-access';
import {
  validatePriceBook, validateProcessCapability,
  DEFAULT_PRICEBOOK, DEFAULT_CAPABILITY,
  type PriceBook, type ProcessCapability,
} from '@/lib/partner-pricebook';

export const dynamic = 'force-dynamic';

interface FactoryRow {
  id: string; name: string; partner_email: string | null;
  contact_email: string | null; contact_phone: string | null;
  description: string | null; website: string | null;
  processes: string | null; certifications: string | null;
  tech_exp: string | null; match_field: string | null;
  capacity_amount: string | null; partner_type: string | null;
  status: string; ai_prefs: string | null; rating: number | null;
  review_count: number | null; avatar_url: string | null;
  price_book: string | null; process_capability: string | null;
}

interface AiPrefs {
  hourlyRateKrw?: number;
  materialMargin?: number;
  leadCapacityDays?: number;
  processes?: string[];
  certifications?: string[];
}

async function ensureColumns(db: ReturnType<typeof import('@/lib/db-adapter').getDbAdapter>) {
  const cols = [
    'ai_prefs TEXT', 'avatar_url TEXT', 'description TEXT', 'website TEXT',
    'price_book TEXT', 'process_capability TEXT',
  ];
  for (const col of cols) {
    await db.execute(`ALTER TABLE nf_factories ADD COLUMN ${col}`).catch(() => {});
  }
}

// GET /api/partner/profile
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const db = getDbAdapter();
  await ensureColumns(db);

  const facRef = await findFactoryForPartnerEmail(partner.email, { activeOnly: false });
  const factory = facRef
    ? await db.queryOne<FactoryRow>(
        `SELECT id, name, partner_email, contact_email, contact_phone,
                description, website, processes, certifications,
                tech_exp, match_field, capacity_amount, partner_type,
                status, ai_prefs, rating, review_count, avatar_url,
                price_book, process_capability
         FROM nf_factories WHERE id = ? LIMIT 1`,
        facRef.id,
      )
    : null;

  let aiPrefs: AiPrefs = {};
  try { aiPrefs = factory?.ai_prefs ? JSON.parse(factory.ai_prefs) : {}; } catch { /* ignore */ }

  let processes: string[] = [];
  try { processes = factory?.processes ? JSON.parse(factory.processes) : []; } catch { /* ignore */ }

  let certifications: string[] = [];
  try { certifications = factory?.certifications ? JSON.parse(factory.certifications) : []; } catch { /* ignore */ }

  let priceBook: PriceBook = DEFAULT_PRICEBOOK;
  try {
    const parsed = factory?.price_book ? JSON.parse(factory.price_book) : null;
    const v = validatePriceBook(parsed);
    if (v.ok) priceBook = v.data;
  } catch { /* ignore */ }

  let processCapability: ProcessCapability = DEFAULT_CAPABILITY;
  try {
    const parsed = factory?.process_capability ? JSON.parse(factory.process_capability) : null;
    const v = validateProcessCapability(parsed);
    if (v.ok) processCapability = v.data;
  } catch { /* ignore */ }

  return NextResponse.json({
    profile: {
      partnerId: partner.partnerId,
      email: partner.email,
      company: factory?.name || partner.company || '',
      name: partner.company || '',
      phone: factory?.contact_phone || '',
      homepage: factory?.website || '',
      bio: factory?.description || '',
      processes,
      certifications,
      tech_exp: factory?.tech_exp || '',
      match_field: factory?.match_field || '',
      amount: factory?.capacity_amount || '',
      partner_type: factory?.partner_type || '',
      status: factory?.status || 'pending',
      factoryId: factory?.id || null,
      aiPrefs,
      rating: factory?.rating ?? null,
      reviewCount: factory?.review_count ?? 0,
      avatarUrl: factory?.avatar_url || null,
      priceBook,
      processCapability,
    },
  });
}

// PATCH /api/partner/profile
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const db = getDbAdapter();
  await ensureColumns(db);

  const body = await req.json().catch(() => ({}));
  const {
    company, phone, homepage, bio, processes, certifications,
    tech_exp, match_field, amount, partner_type, aiPrefs,
    priceBook, processCapability,
  } = body as {
    company?: string; phone?: string; homepage?: string; bio?: string;
    processes?: string[]; certifications?: string[];
    tech_exp?: string; match_field?: string;
    amount?: string; partner_type?: string; aiPrefs?: AiPrefs;
    priceBook?: PriceBook; processCapability?: ProcessCapability;
  };

  if (priceBook !== undefined) {
    const v = validatePriceBook(priceBook);
    if (!v.ok) {
      return NextResponse.json(
        { error: 'priceBook 형식이 올바르지 않습니다.', field: 'priceBook', issues: v.issues },
        { status: 400 },
      );
    }
  }
  if (processCapability !== undefined) {
    const v = validateProcessCapability(processCapability);
    if (!v.ok) {
      return NextResponse.json(
        { error: 'processCapability 형식이 올바르지 않습니다.', field: 'processCapability', issues: v.issues },
        { status: 400 },
      );
    }
  }

  const factory = await findFactoryForPartnerEmail(partner.email, { activeOnly: false });

  if (factory) {
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [Date.now()];

    if (company !== undefined)       { sets.push('name = ?');            vals.push(company); }
    if (phone !== undefined)         { sets.push('contact_phone = ?');   vals.push(phone); }
    if (homepage !== undefined)      { sets.push('website = ?');         vals.push(homepage); }
    if (bio !== undefined)           { sets.push('description = ?');     vals.push(bio); }
    if (processes !== undefined)     { sets.push('processes = ?');       vals.push(JSON.stringify(processes)); }
    if (certifications !== undefined){ sets.push('certifications = ?');  vals.push(JSON.stringify(certifications)); }
    if (tech_exp !== undefined)      { sets.push('tech_exp = ?');        vals.push(tech_exp); }
    if (match_field !== undefined)   { sets.push('match_field = ?');     vals.push(match_field); }
    if (amount !== undefined)        { sets.push('capacity_amount = ?'); vals.push(amount); }
    if (partner_type !== undefined)  { sets.push('partner_type = ?');    vals.push(partner_type); }
    if (aiPrefs !== undefined)       { sets.push('ai_prefs = ?');        vals.push(JSON.stringify(aiPrefs)); }
    if (priceBook !== undefined)         { sets.push('price_book = ?');         vals.push(JSON.stringify(priceBook)); }
    if (processCapability !== undefined) { sets.push('process_capability = ?'); vals.push(JSON.stringify(processCapability)); }
    vals.push(factory.id);

    await db.execute(`UPDATE nf_factories SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  } else {
    const now = Date.now();
    await db.execute(
      `INSERT INTO nf_factories
        (id, name, partner_email, contact_email, contact_phone,
         website, description, processes, certifications,
         tech_exp, match_field, capacity_amount, partner_type,
         ai_prefs, price_book, process_capability,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      `FAC-${now}`,
      company || partner.company || '',
      partner.email,
      partner.email,
      phone ?? null,
      homepage ?? null,
      bio ?? null,
      JSON.stringify(processes ?? []),
      JSON.stringify(certifications ?? []),
      tech_exp ?? null,
      match_field ?? null,
      amount ?? null,
      partner_type ?? null,
      aiPrefs ? JSON.stringify(aiPrefs) : null,
      priceBook ? JSON.stringify(priceBook) : null,
      processCapability ? JSON.stringify(processCapability) : null,
      now, now,
    );
  }

  return NextResponse.json({ ok: true });
}
