import { NextRequest, NextResponse } from 'next/server';
import { matchPartners } from '@/app/lib/matching';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

function maskEmail(email: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function maskPhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/(\d{2,3})-?(\d{3,4})-?(\d{4})/, '$1-****-$3');
}

export const dynamic = 'force-dynamic';

// GET /api/match?inquiryId=xxx  (admin-only)
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const inquiryId = searchParams.get('inquiryId');
  const rfqId     = searchParams.get('rfqId');

  if (!inquiryId && !rfqId) {
    return NextResponse.json({ error: 'inquiryId or rfqId is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // 1. 문의/RFQ 조회
  let inquiryForMatch: { id: string; request_field: string; budget_range: string };

  if (inquiryId) {
    const inquiry = await db.queryOne<{
      id: string; project_name: string; budget: string | null; message: string | null;
    }>(
      'SELECT id, project_name, budget, message FROM nf_inquiries WHERE id = ?',
      inquiryId,
    ).catch(() => null);

    if (!inquiry) {
      return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404 });
    }

    inquiryForMatch = {
      id: inquiry.id,
      request_field: [inquiry.project_name, inquiry.message].filter(Boolean).join(' '),
      budget_range: inquiry.budget ?? '',
    };
  } else {
    // rfqId 경로: nf_rfqs에서 조회
    const rfq = await db.queryOne<{
      id: string; shape_name: string | null; material_id: string | null;
      note: string | null; dfm_process: string | null;
    }>(
      'SELECT id, shape_name, material_id, note, dfm_process FROM nf_rfqs WHERE id = ?',
      rfqId!,
    ).catch(() => null);

    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    inquiryForMatch = {
      id: rfq.id,
      request_field: [rfq.shape_name, rfq.material_id, rfq.dfm_process, rfq.note]
        .filter(Boolean).join(' '),
      budget_range: '',
    };
  }

  // 2. 파트너 공장 목록 (partner_email이 있는 활성 공장만)
  type FactoryRow = {
    id: string; name: string; contact_email: string | null; contact_phone: string | null;
    rating: number; review_count: number; status: string;
    partner_email: string | null; match_field: string | null; capacity_amount: string | null;
  };
  const factories = await db.queryAll<FactoryRow>(
    `SELECT id, name, contact_email, contact_phone, rating, review_count, status,
            partner_email, match_field, capacity_amount
     FROM nf_factories
     WHERE partner_email IS NOT NULL AND status = 'active'`,
  ).catch((): FactoryRow[] => []);

  // 3. 완료 계약 건수 집계 (partner_email 기준)
  const completedRows = await db.queryAll<{ partner_email: string; cnt: number }>(
    `SELECT partner_email, COUNT(*) AS cnt
     FROM nf_contracts
     WHERE status IN ('completed', 'delivered') AND partner_email IS NOT NULL
     GROUP BY partner_email`,
  ).catch(() => [] as { partner_email: string; cnt: number }[]);

  const completedMap: Record<string, number> = {};
  for (const row of completedRows) {
    completedMap[row.partner_email] = row.cnt;
  }

  // 4. 파트너 데이터 enrichment + PII 마스킹
  const enrichedPartners = factories.map(f => {
    const email = f.partner_email ?? f.contact_email ?? '';
    return {
      id: f.id,
      name: f.name,
      company: f.name,
      email: maskEmail(email),
      phone: f.contact_phone ? maskPhone(f.contact_phone) : undefined,
      partnerStatus: 'approved',           // active factories with partner_email are approved
      match_field: f.match_field ?? '',
      amount: f.capacity_amount ?? '',
      avgRating: f.rating ?? 0,
      completedCount: completedMap[email] ?? 0,
    };
  });

  // 5. matchPartners 호출
  const matches = matchPartners(inquiryForMatch, enrichedPartners);

  return NextResponse.json({
    matches,
    inquiry: {
      id: inquiryForMatch.id,
      request_field: inquiryForMatch.request_field,
      budget_range: inquiryForMatch.budget_range,
    },
  });
}
