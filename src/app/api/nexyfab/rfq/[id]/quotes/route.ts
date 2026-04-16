import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export interface QuoteForRFQ {
  id: string;
  factoryName: string;
  partnerEmail: string | null;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
  createdAt: string;
}

// GET /api/nexyfab/rfq/[id]/quotes
// Returns all quotes submitted by manufacturers for the given RFQ (user-owned)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  // Verify the RFQ belongs to this user
  const rfq = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_rfqs WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  type QuoteRow = {
    id: string;
    factory_name: string;
    partner_email: string | null;
    estimated_amount: number;
    estimated_days: number | null;
    note: string | null;
    status: string;
    valid_until: string | null;
    created_at: string;
  };

  const rows = await db.queryAll<QuoteRow>(
    `SELECT q.id, q.factory_name, q.partner_email, q.estimated_amount,
            q.estimated_days, q.note, q.status, q.valid_until, q.created_at
     FROM nf_quotes q
     WHERE q.inquiry_id = ?
     ORDER BY q.estimated_amount ASC`,
    id,
  ).catch((): QuoteRow[] => []);

  const quotes: QuoteForRFQ[] = rows.map((r: QuoteRow) => ({
    id: r.id,
    factoryName: r.factory_name,
    partnerEmail: r.partner_email,
    estimatedAmount: r.estimated_amount,
    estimatedDays: r.estimated_days,
    note: r.note,
    status: r.status,
    validUntil: r.valid_until,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ quotes });
}
