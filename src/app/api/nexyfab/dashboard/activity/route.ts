import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export interface ActivityItem {
  id: string;
  type: 'rfq_submitted' | 'quote_received' | 'order_milestone' | 'contract_signed' | 'project_created';
  message: string;
  createdAt: number;
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = authUser.userId;
  const db = getDbAdapter();

  const items: ActivityItem[] = [];

  try {
    // Recent RFQs submitted
    const rfqs = await db.queryAll<{ id: string; shape_name: string | null; status: string; created_at: number; updated_at: number }>(
      'SELECT id, shape_name, status, created_at, updated_at FROM nf_rfqs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      userId,
    ).catch(() => []);

    for (const rfq of rfqs) {
      if (rfq.status === 'pending') {
        items.push({
          id: `rfq-sub-${rfq.id}`,
          type: 'rfq_submitted',
          message: `RFQ 제출: ${rfq.shape_name ?? `#${rfq.id.slice(4, 12).toUpperCase()}`}`,
          createdAt: rfq.created_at,
        });
      } else if (rfq.status === 'quoted') {
        items.push({
          id: `rfq-quote-${rfq.id}`,
          type: 'quote_received',
          message: `견적 수신: ${rfq.shape_name ?? `#${rfq.id.slice(4, 12).toUpperCase()}`}`,
          createdAt: rfq.updated_at,
        });
      }
    }

    // Recent orders / milestones
    const orders = await db.queryAll<{ id: string; part_name: string; status: string; created_at: number }>(
      'SELECT id, part_name, status, created_at FROM nf_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      userId,
    ).catch(() => []);

    const orderStatusLabel: Record<string, string> = {
      placed: '주문 완료',
      production: '생산 중',
      qc: 'QC 진행 중',
      shipped: '배송 중',
      delivered: '배송 완료',
      completed: '완료',
    };

    for (const order of orders) {
      items.push({
        id: `order-${order.id}`,
        type: 'order_milestone',
        message: `${orderStatusLabel[order.status] ?? order.status}: ${order.part_name}`,
        createdAt: order.created_at,
      });
    }

    // Recent contracts signed (from nf_audit_log if logged, else skip)
    const contractAudit = await db.queryAll<{ id: string; action: string; resource_id: string | null; created_at: number }>(
      "SELECT id, action, resource_id, created_at FROM nf_audit_log WHERE user_id = ? AND action LIKE '%contract%' ORDER BY created_at DESC LIMIT 3",
      userId,
    ).catch(() => []);

    for (const entry of contractAudit) {
      items.push({
        id: `audit-${entry.id}`,
        type: 'contract_signed',
        message: `계약 체결${entry.resource_id ? `: ${entry.resource_id.slice(0, 12)}` : ''}`,
        createdAt: entry.created_at,
      });
    }

    // Recent projects created
    const recentProjects = await db.queryAll<{ id: string; name: string; created_at: number }>(
      'SELECT id, name, created_at FROM nf_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
      userId,
    ).catch(() => []);

    for (const proj of recentProjects) {
      items.push({
        id: `proj-${proj.id}`,
        type: 'project_created',
        message: `프로젝트 생성: ${proj.name}`,
        createdAt: proj.created_at,
      });
    }
  } catch {
    // Return empty if tables don't exist
  }

  // Sort by createdAt desc and take top 10
  items.sort((a, b) => b.createdAt - a.createdAt);
  const activity = items.slice(0, 10);

  return NextResponse.json({ activity });
}
