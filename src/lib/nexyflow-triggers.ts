/**
 * NexyFlow trigger functions — fire-and-forget, never throw
 * Called from NexyFab event handlers to push data to NexyFlow.
 */

import { getDbAdapter } from './db-adapter';
import { buildNexyFlowClient } from './nexyflow-client';

// Ensure sync map table exists (idempotent, SQLite + PG compatible)
async function ensureSyncMap(): Promise<void> {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_nexyflow_sync_map (
      id           TEXT PRIMARY KEY,
      nexyfab_type TEXT NOT NULL,
      nexyfab_id   TEXT NOT NULL,
      nexyflow_id  TEXT,
      user_id      TEXT NOT NULL,
      synced_at    INTEGER NOT NULL,
      UNIQUE(nexyfab_type, nexyfab_id, user_id)
    )
  `).catch(() => {});
}

interface NexyFlowIntegration {
  nexyflow_url: string;
  access_token: string;
  sync_tasks: number;       // SQLite 0/1
  sync_calendar: number;
  sync_approvals: number;
  approval_threshold_krw: number;
}

async function getIntegration(userId: string): Promise<NexyFlowIntegration | null> {
  const db = getDbAdapter();
  return (await db.queryOne<NexyFlowIntegration>(
    "SELECT nexyflow_url, access_token, sync_tasks, sync_calendar, sync_approvals, approval_threshold_krw FROM nf_nexyflow_integrations WHERE user_id = ? AND status = 'active'",
    userId,
  ).catch(() => null)) ?? null;
}

/**
 * RFQ 생성 시 → NexyFlow에 업무(Task) 생성
 */
export async function onRfqCreated(params: {
  userId: string;
  rfqId: string;
  partName: string;
  quantity: number;
  material?: string | null;
  note?: string | null;
  dueDate?: string | null;
}): Promise<void> {
  try {
    const integration = await getIntegration(params.userId);
    if (!integration || !integration.sync_tasks) return;

    const client = buildNexyFlowClient(integration);
    await client.createTask({
      title: `[구매요청] ${params.partName} × ${params.quantity}`,
      description: [
        `NexyFab RFQ: ${params.rfqId}`,
        params.material ? `소재: ${params.material}` : null,
        params.note ? `비고: ${params.note}` : null,
      ].filter(Boolean).join('\n'),
      status: 'todo',
      priority: 'medium',
      dueDate: params.dueDate ?? undefined,
      tags: ['nexyfab', 'rfq'],
    });

    // Save task link reference for later sync
    await ensureSyncMap();
    const db = getDbAdapter();
    await db.execute(
      `INSERT OR IGNORE INTO nf_nexyflow_sync_map (id, nexyfab_type, nexyfab_id, user_id, synced_at)
       VALUES (?, 'rfq', ?, ?, ?)`,
      `sm-${crypto.randomUUID()}`, params.rfqId, params.userId, Date.now(),
    ).catch(() => {});
  } catch (err) {
    console.error('[nexyflow] onRfqCreated failed:', err);
  }
}

/**
 * 계약 마일스톤 추가 시 → NexyFlow 캘린더 이벤트 생성
 */
export async function onMilestoneCreated(params: {
  userId: string;
  contractId: string;
  milestoneId: string;
  title: string;
  dueDate?: string | null;
  description?: string | null;
}): Promise<void> {
  try {
    const integration = await getIntegration(params.userId);
    if (!integration || !integration.sync_calendar || !params.dueDate) return;

    const client = buildNexyFlowClient(integration);
    const result = await client.createCalendarEvent({
      title: `[NexyFab] ${params.title}`,
      description: params.description ?? `계약 ${params.contractId} 마일스톤`,
      date: params.dueDate,
      type: 'manufacturing',
      color: '#3b82f6',
    });

    if (result.ok && result.eventId) {
      await ensureSyncMap();
      const db = getDbAdapter();
      await db.execute(
        `INSERT OR IGNORE INTO nf_nexyflow_sync_map (id, nexyfab_type, nexyfab_id, nexyflow_id, user_id, synced_at)
         VALUES (?, 'milestone', ?, ?, ?, ?)`,
        `sm-${crypto.randomUUID()}`, params.milestoneId, result.eventId, params.userId, Date.now(),
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[nexyflow] onMilestoneCreated failed:', err);
  }
}

/**
 * 마일스톤 완료 시 → NexyFlow 캘린더 이벤트 업데이트
 */
export async function onMilestoneCompleted(params: {
  userId: string;
  milestoneId: string;
  title: string;
}): Promise<void> {
  try {
    const integration = await getIntegration(params.userId);
    if (!integration || !integration.sync_calendar) return;

    const db = getDbAdapter();
    const mapping = await db.queryOne<{ nexyflow_id: string }>(
      "SELECT nexyflow_id FROM nf_nexyflow_sync_map WHERE nexyfab_type = 'milestone' AND nexyfab_id = ? AND user_id = ?",
      params.milestoneId, params.userId,
    ).catch(() => null);

    if (!mapping?.nexyflow_id) return;

    const client = buildNexyFlowClient(integration);
    await client.updateCalendarEvent(mapping.nexyflow_id, {
      title: `[완료] ${params.title}`,
      color: '#22c55e',
    });
  } catch (err) {
    console.error('[nexyflow] onMilestoneCompleted failed:', err);
  }
}

/**
 * 계약 생성 시 → 금액이 임계값 이상이면 NexyFlow 결재 문서 생성
 */
export async function onContractCreated(params: {
  userId: string;
  contractId: string;
  partName: string;
  manufacturerName: string;
  totalPriceKrw: number;
  quantity: number;
}): Promise<void> {
  try {
    const integration = await getIntegration(params.userId);
    if (!integration || !integration.sync_approvals) return;
    if (params.totalPriceKrw < (integration.approval_threshold_krw ?? 1_000_000)) return;

    const client = buildNexyFlowClient(integration);
    await client.createApprovalDocument({
      templateName: '구매 결재',
      title: `[NexyFab] ${params.partName} 구매 결재 — ${params.totalPriceKrw.toLocaleString('ko-KR')}원`,
      content: {
        contractId: params.contractId,
        partName: params.partName,
        manufacturer: params.manufacturerName,
        quantity: params.quantity,
        totalPriceKrw: params.totalPriceKrw,
        requestedAt: new Date().toISOString(),
        source: 'NexyFab',
      },
    });
  } catch (err) {
    console.error('[nexyflow] onContractCreated failed:', err);
  }
}

/**
 * Quote 수락 시 → NexyFlow 알림 태스크 생성
 */
export async function onQuoteAccepted(params: {
  userId: string;
  rfqId: string;
  partName: string;
  manufacturerName: string;
  totalPriceKrw: number;
}): Promise<void> {
  try {
    const integration = await getIntegration(params.userId);
    if (!integration || !integration.sync_tasks) return;

    const client = buildNexyFlowClient(integration);
    await client.createTask({
      title: `[NexyFab] 견적 수락 — ${params.partName}`,
      description: `제조사: ${params.manufacturerName}\n금액: ${params.totalPriceKrw.toLocaleString('ko-KR')}원\nRFQ: ${params.rfqId}`,
      status: 'todo',
      priority: 'high',
      tags: ['nexyfab', 'quote-accepted'],
    });
  } catch (err) {
    console.error('[nexyflow] onQuoteAccepted failed:', err);
  }
}
