import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { onRfqCreated, onMilestoneCreated } from '@/lib/nexyflow-triggers';

export const dynamic = 'force-dynamic';

// POST — manually trigger sync of recent data to NexyFlow
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();

  // Check integration exists
  const integration = await db.queryOne<{
    nexyflow_url: string; access_token: string;
    sync_tasks: number; sync_calendar: number; sync_approvals: number;
  }>(
    "SELECT nexyflow_url, access_token, sync_tasks, sync_calendar, sync_approvals FROM nf_nexyflow_integrations WHERE user_id = ? AND status = 'active'",
    authUser.userId,
  ).catch(() => null);

  if (!integration) {
    return NextResponse.json({ error: 'NexyFlow 연동이 설정되지 않았습니다.' }, { status: 400 });
  }

  const since = Date.now() - 30 * 86_400_000; // last 30 days
  const results = { rfqs: 0, milestones: 0, errors: 0 };

  // Sync recent RFQs that haven't been synced yet
  if (integration.sync_tasks) {
    const rfqs = await db.queryAll<{
      id: string; shape_name: string; material_id: string | null;
      quantity: number; note: string | null; created_at: number;
    }>(
      `SELECT r.id, r.shape_name, r.material_id, r.quantity, r.note, r.created_at
       FROM nf_rfqs r
       WHERE r.user_id = ? AND r.created_at >= ?
         AND NOT EXISTS (
           SELECT 1 FROM nf_nexyflow_sync_map m
           WHERE m.nexyfab_type = 'rfq' AND m.nexyfab_id = r.id AND m.user_id = ?
         )
       ORDER BY r.created_at DESC LIMIT 50`,
      authUser.userId, since, authUser.userId,
    ).catch(() => []);

    for (const rfq of rfqs) {
      try {
        await onRfqCreated({
          userId: authUser.userId,
          rfqId: rfq.id,
          partName: rfq.shape_name ?? '(미입력)',
          quantity: rfq.quantity ?? 1,
          material: rfq.material_id,
          note: rfq.note,
        });
        results.rfqs++;
      } catch { results.errors++; }
    }
  }

  // Sync pending milestones with due dates that haven't been synced
  if (integration.sync_calendar) {
    const milestones = await db.queryAll<{
      id: string; contract_id: string; title: string; description: string | null; due_date: string | null;
    }>(
      `SELECT m.id, m.contract_id, m.title, m.description, m.due_date
       FROM nf_contract_milestones m
       JOIN nf_orders o ON o.id = m.contract_id
       WHERE o.user_id = ? AND m.status != 'completed' AND m.due_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM nf_nexyflow_sync_map sm
           WHERE sm.nexyfab_type = 'milestone' AND sm.nexyfab_id = m.id AND sm.user_id = ?
         )
       LIMIT 50`,
      authUser.userId, authUser.userId,
    ).catch(() => []);

    for (const ms of milestones) {
      try {
        await onMilestoneCreated({
          userId: authUser.userId,
          contractId: ms.contract_id,
          milestoneId: ms.id,
          title: ms.title,
          dueDate: ms.due_date,
          description: ms.description,
        });
        results.milestones++;
      } catch { results.errors++; }
    }
  }

  // Update last_tested_at
  await db.execute(
    'UPDATE nf_nexyflow_integrations SET last_tested_at = ?, updated_at = ? WHERE user_id = ?',
    Date.now(), Date.now(), authUser.userId,
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    synced: results,
    message: `업무 ${results.rfqs}개, 마일스톤 ${results.milestones}개 동기화 완료`,
  });
}

// GET — sync status (what's been synced)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const counts = await db.queryAll<{ nexyfab_type: string; c: number }>(
    `SELECT nexyfab_type, COUNT(*) as c FROM nf_nexyflow_sync_map
     WHERE user_id = ? GROUP BY nexyfab_type`,
    authUser.userId,
  ).catch(() => []);

  const recent = await db.queryAll<{ nexyfab_type: string; nexyfab_id: string; nexyflow_id: string | null; synced_at: number }>(
    `SELECT nexyfab_type, nexyfab_id, nexyflow_id, synced_at
     FROM nf_nexyflow_sync_map WHERE user_id = ? ORDER BY synced_at DESC LIMIT 20`,
    authUser.userId,
  ).catch(() => []);

  return NextResponse.json({
    summary: Object.fromEntries(counts.map(c => [c.nexyfab_type, c.c])),
    recent: recent.map(r => ({ ...r, syncedAt: new Date(r.synced_at).toISOString() })),
  });
}
