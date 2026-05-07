/**
 * GET   /api/nexyfab/manufacturers/profile  — partner reads own factory profile
 * PATCH /api/nexyfab/manufacturers/profile  — partner updates own factory profile
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

// ─── DB row type ──────────────────────────────────────────────────────────────

interface FactoryRow {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string;       // JSON array string
  min_lead_time: number;
  max_lead_time: number;
  certifications: string;  // JSON array string
  description: string | null;
  description_ko: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  status: string;
  partner_email: string | null;
  updated_at: number;
}

function parseFactory(row: FactoryRow) {
  return {
    ...row,
    processes: JSON.parse(row.processes || '[]') as string[],
    certifications: JSON.parse(row.certifications || '[]') as string[],
  };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const facRef = await findFactoryForPartnerEmail(authUser.email, { activeOnly: false });
  const factory = facRef
    ? await db.queryOne<FactoryRow>('SELECT * FROM nf_factories WHERE id = ? LIMIT 1', facRef.id).catch(() => null)
    : null;

  if (!factory) {
    return NextResponse.json({ error: 'No factory found for this account' }, { status: 404 });
  }

  return NextResponse.json({ factory: parseFactory(factory) });
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

interface PatchBody {
  name?: string;
  region?: string;
  processes?: string[];
  min_lead_time?: number;
  max_lead_time?: number;
  certifications?: string[];
  contact_email?: string;
  contact_phone?: string;
  description?: string;
  description_ko?: string;
}

export async function PATCH(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate name if provided
  if (body.name !== undefined && body.name.trim() === '') {
    return NextResponse.json({ error: 'name must not be empty' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Ensure factory exists for this partner
  const existing = await findFactoryForPartnerEmail(authUser.email, { activeOnly: false });

  if (!existing) {
    return NextResponse.json({ error: 'No factory found for this account' }, { status: 404 });
  }

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const args: (string | number)[] = [];

  const addField = (col: string, val: string | number | undefined) => {
    if (val !== undefined) {
      setClauses.push(`${col} = ?`);
      args.push(val);
    }
  };

  addField('name', body.name?.trim());
  addField('region', body.region?.trim());
  addField('min_lead_time', body.min_lead_time !== undefined ? Number(body.min_lead_time) : undefined);
  addField('max_lead_time', body.max_lead_time !== undefined ? Number(body.max_lead_time) : undefined);
  addField('contact_email', body.contact_email?.trim());
  addField('contact_phone', body.contact_phone?.trim());
  addField('description', body.description?.trim());
  addField('description_ko', body.description_ko?.trim());

  if (body.processes !== undefined) {
    setClauses.push('processes = ?');
    args.push(JSON.stringify(body.processes));
  }
  if (body.certifications !== undefined) {
    setClauses.push('certifications = ?');
    args.push(JSON.stringify(body.certifications));
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  setClauses.push('updated_at = ?');
  args.push(Date.now());

  args.push(existing.id);

  await db.execute(
    `UPDATE nf_factories SET ${setClauses.join(', ')} WHERE id = ?`,
    ...args,
  );

  // Return updated row
  const updated = await db.queryOne<FactoryRow>(
    'SELECT * FROM nf_factories WHERE id = ? LIMIT 1',
    existing.id,
  );

  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ factory: parseFactory(updated) });
}
