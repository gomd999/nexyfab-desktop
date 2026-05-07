import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// GET /api/portal — customer portal: inquiries + linked contracts
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = authUser.email.trim().toLowerCase();
  const db = getDbAdapter();

  // Customer inquiries (exclude partner registration)
  const inquiryRows = await db.queryAll<{
    id: string; action: string; name: string; email: string;
    project_name: string; budget: string | null; message: string;
    phone: string | null; status: string; admin_note: string | null;
    rfq_id: string | null; shape_id: string | null; material_id: string | null;
    volume_cm3: number | null; created_at: string; updated_at: string | null;
  }>(
    `SELECT * FROM nf_inquiries
     WHERE email = ? AND action != 'send_partner_register'
     ORDER BY created_at DESC`,
    email,
  );

  // Linked contracts (quote_id matches inquiry id)
  const inquiryIds = inquiryRows.map(i => i.id);
  const contractsByQuoteId: Record<string, any> = {};

  if (inquiryIds.length > 0) {
    const placeholders = inquiryIds.map(() => '?').join(', ');
    const contractRows = await db.queryAll<{
      id: string; project_name: string; status: string;
      contract_amount: number | null; deadline: string | null;
      progress_percent: number; quote_id: string | null;
      attachments: string | null; created_at: string;
    }>(
      `SELECT id, project_name, status, contract_amount, deadline,
              progress_percent, quote_id, attachments, created_at
       FROM nf_contracts WHERE quote_id IN (${placeholders})`,
      ...inquiryIds,
    );
    for (const c of contractRows) {
      if (c.quote_id) {
        contractsByQuoteId[c.quote_id] = {
          id: c.id,
          projectName: c.project_name,
          status: c.status,
          contractAmount: c.contract_amount,
          deadline: c.deadline,
          progressPercent: c.progress_percent,
          attachments: (() => {
            try { return JSON.parse(c.attachments || '[]'); } catch { return []; }
          })(),
          createdAt: c.created_at,
        };
      }
    }
  }

  const inquiries = inquiryRows.map(inq => ({
    id: inq.id,
    action: inq.action,
    name: inq.name,
    email: inq.email,
    projectName: inq.project_name,
    budget: inq.budget,
    message: inq.message,
    phone: inq.phone,
    status: inq.status,
    adminNote: inq.admin_note,
    rfqId: inq.rfq_id,
    shapeId: inq.shape_id,
    materialId: inq.material_id,
    volume_cm3: inq.volume_cm3,
    date: inq.created_at,
    createdAt: inq.created_at,
    updatedAt: inq.updated_at,
    contract: contractsByQuoteId[inq.id] ?? null,
  }));

  return NextResponse.json({ inquiries });
}
