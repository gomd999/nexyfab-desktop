import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { buildNexyFlowClient } from '@/lib/nexyflow-client';

export const dynamic = 'force-dynamic';

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_nexyflow_integrations (
      id                     TEXT PRIMARY KEY,
      user_id                TEXT NOT NULL UNIQUE,
      nexyflow_url           TEXT NOT NULL,
      access_token           TEXT NOT NULL,
      sync_tasks             INTEGER NOT NULL DEFAULT 1,
      sync_calendar          INTEGER NOT NULL DEFAULT 1,
      sync_approvals         INTEGER NOT NULL DEFAULT 0,
      approval_threshold_krw INTEGER NOT NULL DEFAULT 1000000,
      status                 TEXT NOT NULL DEFAULT 'active',
      last_tested_at         INTEGER,
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nf_nexyflow_sync_map (
      id             TEXT PRIMARY KEY,
      nexyfab_type   TEXT NOT NULL,
      nexyfab_id     TEXT NOT NULL,
      nexyflow_id    TEXT,
      user_id        TEXT NOT NULL,
      synced_at      INTEGER NOT NULL,
      UNIQUE(nexyfab_type, nexyfab_id, user_id)
    );
  `).catch(() => {});
}

// GET — fetch integration config (token masked)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'team')) return NextResponse.json({ error: 'Team plan required for NexyFlow integration.' }, { status: 403 });

  await ensureTable();
  const db = getDbAdapter();
  const row = await db.queryOne<{
    id: string; nexyflow_url: string; sync_tasks: number; sync_calendar: number;
    sync_approvals: number; approval_threshold_krw: number; status: string;
    last_tested_at: number | null; created_at: number; updated_at: number;
  }>(
    `SELECT id, nexyflow_url, sync_tasks, sync_calendar, sync_approvals,
            approval_threshold_krw, status, last_tested_at, created_at, updated_at
     FROM nf_nexyflow_integrations WHERE user_id = ?`,
    authUser.userId,
  );

  if (!row) return NextResponse.json({ integration: null });

  return NextResponse.json({
    integration: {
      id: row.id,
      nexyflowUrl: row.nexyflow_url,
      syncTasks: !!row.sync_tasks,
      syncCalendar: !!row.sync_calendar,
      syncApprovals: !!row.sync_approvals,
      approvalThresholdKrw: row.approval_threshold_krw,
      status: row.status,
      lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      // token is never returned — write-only
    },
  });
}

// POST — save or update integration + test connection
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    nexyflowUrl: z.string().url().max(500),
    accessToken: z.string().min(10).max(2000),
    syncTasks: z.boolean().default(true),
    syncCalendar: z.boolean().default(true),
    syncApprovals: z.boolean().default(false),
    approvalThresholdKrw: z.number().int().min(0).default(1_000_000),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  // Test connection before saving
  const client = buildNexyFlowClient({
    nexyflow_url: parsed.data.nexyflowUrl,
    access_token: parsed.data.accessToken,
  });
  const testResult = await client.testConnection();
  if (!testResult.ok) {
    return NextResponse.json({
      error: `NexyFlow 연결 실패: ${testResult.error}`,
      hint: 'NexyFlow URL과 토큰을 확인하세요.',
    }, { status: 400 });
  }

  await ensureTable();
  const db = getDbAdapter();
  const now = Date.now();
  const id = `nfi-${authUser.userId}`;

  await db.execute(
    `INSERT INTO nf_nexyflow_integrations
     (id, user_id, nexyflow_url, access_token, sync_tasks, sync_calendar, sync_approvals, approval_threshold_krw, status, last_tested_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       nexyflow_url = excluded.nexyflow_url,
       access_token = excluded.access_token,
       sync_tasks = excluded.sync_tasks,
       sync_calendar = excluded.sync_calendar,
       sync_approvals = excluded.sync_approvals,
       approval_threshold_krw = excluded.approval_threshold_krw,
       status = 'active',
       last_tested_at = excluded.last_tested_at,
       updated_at = excluded.updated_at`,
    id, authUser.userId,
    parsed.data.nexyflowUrl,
    parsed.data.accessToken,
    parsed.data.syncTasks ? 1 : 0,
    parsed.data.syncCalendar ? 1 : 0,
    parsed.data.syncApprovals ? 1 : 0,
    parsed.data.approvalThresholdKrw,
    now, now, now,
  );

  return NextResponse.json({
    ok: true,
    connected: true,
    orgName: testResult.orgName,
    message: `NexyFlow (${testResult.orgName ?? '연결됨'}) 연동이 완료되었습니다.`,
  });
}

// DELETE — remove integration
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureTable();
  const db = getDbAdapter();
  await db.execute(
    'DELETE FROM nf_nexyflow_integrations WHERE user_id = ?',
    authUser.userId,
  );

  return NextResponse.json({ ok: true });
}
