/**
 * POST /api/admin/rfq/bulk-match
 * 선택된 pending RFQ들에 대해 자동으로 최적 공장을 매칭·배정합니다.
 *
 * Body: { rfqIds: string[] }
 * Returns: { results: Array<{ rfqId, status, factoryId?, factoryName?, score?, error? }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { matchPartners } from '@/app/lib/matching';
import { createNotification } from '@/app/lib/notify';
import { logAudit } from '@/lib/audit';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { sendEmail, rfqAssignedToFactoryHtml } from '@/lib/nexyfab-email';

export const dynamic = 'force-dynamic';

interface RfqRow {
  id: string;
  shape_name: string | null;
  material_id: string | null;
  dfm_process: string | null;
  note: string | null;
  quantity: number;
  status: string;
  assigned_factory_id: string | null;
}

interface FactoryRow {
  id: string;
  name: string;
  partner_email: string | null;
  contact_email: string | null;
  rating: number;
  match_field: string | null;
  capacity_amount: string | null;
  processes: string;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { rfqIds?: string[] } | null;
  if (!body?.rfqIds || !Array.isArray(body.rfqIds) || body.rfqIds.length === 0) {
    return NextResponse.json({ error: 'rfqIds 배열이 필요합니다.' }, { status: 400 });
  }
  if (body.rfqIds.length > 50) {
    return NextResponse.json({ error: '한 번에 최대 50건까지 처리 가능합니다.' }, { status: 400 });
  }

  const db = getDbAdapter();

  // 활성 공장 목록 (partner_email 있는 것만) + 완료 계약 수
  const factories = await db.queryAll<FactoryRow>(
    `SELECT id, name, partner_email, contact_email, rating, match_field, capacity_amount, processes
     FROM nf_factories
     WHERE status = 'active'`,
  ).catch((): FactoryRow[] => []);

  const completedRows = await db.queryAll<{ partner_email: string; cnt: number }>(
    `SELECT partner_email, COUNT(*) AS cnt
     FROM nf_contracts
     WHERE status IN ('completed','delivered') AND partner_email IS NOT NULL
     GROUP BY partner_email`,
  ).catch(() => [] as { partner_email: string; cnt: number }[]);

  const completedMap: Record<string, number> = {};
  for (const row of completedRows) completedMap[row.partner_email] = row.cnt;

  // matchPartners에 넘길 enriched partner 목록
  const enrichedFactories = factories.map(f => {
    const email = f.partner_email ?? f.contact_email ?? '';
    const processes: string[] = JSON.parse(f.processes || '[]');
    return {
      id: f.id,
      name: f.name,
      company: f.name,
      email,
      partnerStatus: 'approved',
      match_field: [f.match_field, processes.join(' ')].filter(Boolean).join(' '),
      amount: f.capacity_amount ?? '',
      avgRating: f.rating ?? 0,
      completedCount: completedMap[email] ?? 0,
    };
  });

  const now = Date.now();
  const results: Array<{
    rfqId: string;
    status: 'assigned' | 'skipped' | 'no_match' | 'error';
    factoryId?: string;
    factoryName?: string;
    score?: number;
    reason?: string;
  }> = [];

  for (const rfqId of body.rfqIds) {
    try {
      const rfq = await db.queryOne<RfqRow>(
        'SELECT id, shape_name, material_id, dfm_process, note, quantity, status, assigned_factory_id FROM nf_rfqs WHERE id = ?',
        rfqId,
      );

      if (!rfq) {
        results.push({ rfqId, status: 'error', reason: 'RFQ를 찾을 수 없습니다.' });
        continue;
      }
      if (rfq.status !== 'pending') {
        results.push({ rfqId, status: 'skipped', reason: `이미 처리된 상태입니다 (${rfq.status})` });
        continue;
      }
      if (enrichedFactories.length === 0) {
        results.push({ rfqId, status: 'no_match', reason: '등록된 활성 공장이 없습니다.' });
        continue;
      }

      const inquiry = {
        id: rfq.id,
        request_field: [rfq.shape_name, rfq.material_id, rfq.dfm_process, rfq.note]
          .filter(Boolean).join(' '),
        budget_range: '',
      };

      const matches = matchPartners(inquiry, enrichedFactories);
      if (matches.length === 0) {
        results.push({ rfqId, status: 'no_match', reason: '적합한 공장을 찾지 못했습니다.' });
        continue;
      }

      const best = matches[0];
      const factory = factories.find(f => f.id === best.partnerId);

      await db.execute(
        `UPDATE nf_rfqs
         SET assigned_factory_id = ?, status = 'assigned', assigned_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        best.partnerId, now, now, rfqId,
      );

      // 배정된 공장 담당자에게 인앱·이메일 (단건 admin 배정과 동일 정책)
      if (factory) {
        const html = rfqAssignedToFactoryHtml({
          factoryName: factory.name,
          rfqId: rfq.id,
          shapeName: rfq.shape_name || '부품',
          materialId: rfq.material_id || '-',
          quantity: rfq.quantity,
          note: rfq.note ?? undefined,
        });
        const subject = `[NexyFab] 새 견적 요청 배정 — ${rfq.shape_name || rfqId}`;
        const mailTo = new Set<string>();
        const ce = factory.contact_email?.trim();
        const pe = factory.partner_email?.trim();
        if (ce) mailTo.add(ce);
        if (pe && pe.toLowerCase() !== (ce ?? '').toLowerCase()) mailTo.add(pe);
        for (const to of mailTo) {
          sendEmail(to, subject, html).catch(() => {});
        }
        const notifKeys = new Set<string>();
        if (ce) notifKeys.add(`partner:${normPartnerEmail(ce)}`);
        if (pe) notifKeys.add(`partner:${normPartnerEmail(pe)}`);
        const fallbackKey = factory.id ? `factory:${factory.id}` : '';
        const keys = notifKeys.size > 0 ? [...notifKeys] : fallbackKey ? [fallbackKey] : [];
        for (const userId of keys) {
          createNotification(
            userId,
            'rfq_assigned',
            '새 견적 요청이 배정되었습니다',
            `RFQ ${rfqId.slice(0, 8).toUpperCase()} — ${rfq.shape_name || '부품'} 견적이 귀사에 배정되었습니다.`,
            { quoteId: rfqId },
          );
        }
      }

      createNotification(
        'admin',
        'rfq_bulk_matched',
        '자동 매칭 완료',
        `RFQ "${rfq.shape_name || rfqId}"이(가) "${factory?.name || best.company}"에 자동 배정되었습니다. (점수: ${best.score})`,
      );

      logAudit({
        userId: 'admin:bulk-match',
        action: 'rfq.bulk_assign',
        resourceId: rfqId,
        metadata: { factoryId: best.partnerId, score: best.score },
      });

      results.push({
        rfqId,
        status: 'assigned',
        factoryId: best.partnerId,
        factoryName: factory?.name ?? best.company,
        score: best.score,
      });
    } catch (err) {
      results.push({ rfqId, status: 'error', reason: err instanceof Error ? err.message : '처리 중 오류' });
    }
  }

  const assigned = results.filter(r => r.status === 'assigned').length;
  return NextResponse.json({ results, summary: { total: body.rfqIds.length, assigned } });
}
