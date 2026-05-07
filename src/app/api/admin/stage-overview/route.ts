/**
 * GET /api/admin/stage-overview
 * Stage별 유저 분포, 24시간 내 outbox 이벤트 추이, 락인 이탈 후보,
 * dead-letter 이벤트를 한 번에 반환.
 *
 * 운영자가 광고 첫날부터 "어느 Stage에서 drop-off가 생기는지"
 * 실시간으로 보고 카피/UX를 튜닝하기 위한 단일 진입점.
 *
 * Header: X-Admin-Secret 또는 super_admin JWT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const STAGES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const CHURN_WINDOW_MS = 7 * 24 * 3600 * 1000;
const RECENT_EVENT_WINDOW_MS = 24 * 3600 * 1000;

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db  = getDbAdapter();
  const now = Date.now();

  // ─── 1) Stage별 유저 분포 ────────────────────────────────────────
  const distRows = await db.queryAll<{ stage: string; n: number }>(
    `SELECT stage, COUNT(*) AS n FROM nf_users GROUP BY stage`,
  );
  const distMap = new Map(distRows.map(r => [r.stage, Number(r.n) || 0]));
  const distribution = STAGES.map(s => ({ stage: s, users: distMap.get(s) ?? 0 }));

  // ─── 2) 최근 24h Stage 전환 이벤트 ───────────────────────────────
  const recentEvents = await db.queryAll<{
    id: string; user_id: string; from_stage: string; to_stage: string;
    trigger_type: string; occurred_at: number; processed_at: number | null;
  }>(
    `SELECT id, user_id, from_stage, to_stage, trigger_type, occurred_at, processed_at
       FROM nf_stage_event
      WHERE occurred_at >= ?
      ORDER BY occurred_at DESC
      LIMIT 100`,
    now - RECENT_EVENT_WINDOW_MS,
  );

  // ─── 3) 락인 이탈(churn) 후보: Stage C+ 인데 7일 무활동 ────────
  // BM-3 보강안 §1 — 즉시 운영 액션이 필요한 가장 중요한 타겟.
  const churnRows = await db.queryAll<{
    id: string; email: string; name: string; stage: string;
    cumulative_order_krw: number; last_order_at: number | null;
  }>(
    `SELECT id, email, name, stage, cumulative_order_krw, last_order_at
       FROM nf_users
      WHERE stage IN ('C','D','E','F')
        AND (last_order_at IS NULL OR last_order_at < ?)
      ORDER BY cumulative_order_krw DESC
      LIMIT 50`,
    now - CHURN_WINDOW_MS,
  );

  // ─── 4) Dead-letter: retry_count 가 한도에 도달한 미처리 이벤트 ───
  const deadLetter = await db.queryAll<{
    id: string; user_id: string; from_stage: string; to_stage: string;
    retry_count: number; last_error: string | null; occurred_at: number;
  }>(
    `SELECT id, user_id, from_stage, to_stage, retry_count, last_error, occurred_at
       FROM nf_stage_event
      WHERE processed_at IS NULL AND retry_count >= 5
      ORDER BY occurred_at DESC
      LIMIT 30`,
  );

  // ─── 5) 처리 대기 (in-flight) ────────────────────────────────────
  const pendingRow = await db.queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM nf_stage_event
      WHERE processed_at IS NULL AND retry_count < 5`,
  );

  // ─── 6) 최근 DFM 검증 활동 (Phase B-1 진입 신호) ───────────────────
  // Stage A 유저가 실제로 DFM을 돌렸는지 = "광고는 효과 있는데 첫 액션에서
  // 막혔는지" 가 한눈에 보임. 추후 매칭/번들링 활동도 같은 패턴으로 추가.
  const dfmRecent = await db.queryAll<{
    id: string; user_id: string | null; file_id: string | null;
    issues: number; warnings: number; created_at: number;
  }>(
    `SELECT id, user_id, file_id, issues, warnings, created_at
       FROM nf_dfm_check
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 30`,
    now - RECENT_EVENT_WINDOW_MS,
  ).catch(() => []);

  const dfmAggRow = await db.queryOne<{ n: number; with_issues: number }>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN issues > 0 THEN 1 ELSE 0 END) AS with_issues
       FROM nf_dfm_check WHERE created_at >= ?`,
    now - RECENT_EVENT_WINDOW_MS,
  ).catch(() => null);

  // ─── 7) Funnel Insights ────────────────────────────────────────────
  // Stage(결제) 와 별개의 의도/행동 레이어. 핵심 지표:
  //   (a) 이벤트 타입별 24h 발생 수
  //   (b) "DFM PASS → 매칭 의뢰" 한 유저 중 실제로 Stage C 도달한 비율
  //       — 광고가 효과 있는데 결제 직전에 막히면 이 비율이 낮게 나온다.
  const funnelByType = await db.queryAll<{ event_type: string; n: number }>(
    `SELECT event_type, COUNT(*) AS n
       FROM nf_funnel_event
      WHERE created_at >= ?
      GROUP BY event_type
      ORDER BY n DESC`,
    now - RECENT_EVENT_WINDOW_MS,
  ).catch(() => []);

  // dfm_pass_to_match 한 유저들 중 stage가 C 이상인 비율 (전환율).
  // 윈도우는 30일 — 결제까지 며칠 걸리는 정상 케이스를 잡기 위해.
  const FUNNEL_CONV_WINDOW_MS = 30 * 24 * 3600 * 1000;
  const conversionRow = await db.queryOne<{ intent_users: number; converted: number }>(
    `SELECT COUNT(DISTINCT fe.user_id) AS intent_users,
            SUM(CASE WHEN u.stage IN ('C','D','E','F') THEN 1 ELSE 0 END) AS converted
       FROM (SELECT DISTINCT user_id FROM nf_funnel_event
              WHERE event_type = 'dfm_pass_to_match' AND created_at >= ?) fe
       JOIN nf_users u ON u.id = fe.user_id`,
    now - FUNNEL_CONV_WINDOW_MS,
  ).catch(() => null);

  return NextResponse.json({
    generatedAt: now,
    distribution,
    pendingCount:  Number(pendingRow?.n ?? 0),
    deadLetterCount: deadLetter.length,
    recentEvents: recentEvents.map(e => ({
      id:          e.id,
      userId:      e.user_id,
      fromStage:   e.from_stage,
      toStage:     e.to_stage,
      triggerType: e.trigger_type,
      occurredAt:  Number(e.occurred_at),
      processed:   e.processed_at !== null,
    })),
    churnCandidates: churnRows.map(r => ({
      userId:        r.id,
      email:         r.email,
      name:          r.name,
      stage:         r.stage,
      cumulativeKrw: Number(r.cumulative_order_krw) || 0,
      lastOrderAt:   r.last_order_at,
      daysSinceOrder: r.last_order_at
        ? Math.floor((now - r.last_order_at) / 86_400_000)
        : null,
    })),
    deadLetter: deadLetter.map(e => ({
      id:         e.id,
      userId:     e.user_id,
      fromStage:  e.from_stage,
      toStage:    e.to_stage,
      retryCount: e.retry_count,
      lastError:  e.last_error,
      occurredAt: Number(e.occurred_at),
    })),
    dfmActivity: {
      total24h:        Number(dfmAggRow?.n ?? 0),
      withIssues24h:   Number(dfmAggRow?.with_issues ?? 0),
      recent: dfmRecent.map(d => ({
        id:        d.id,
        userId:    d.user_id,
        fileId:    d.file_id,
        issues:    Number(d.issues) || 0,
        warnings:  Number(d.warnings) || 0,
        createdAt: Number(d.created_at),
      })),
    },
    funnelInsights: {
      eventCounts24h: funnelByType.map(r => ({
        eventType: r.event_type,
        count:     Number(r.n) || 0,
      })),
      dfmToMatchConversion: {
        windowDays:    30,
        intentUsers:   Number(conversionRow?.intent_users ?? 0),
        convertedToC:  Number(conversionRow?.converted    ?? 0),
        rate: conversionRow && Number(conversionRow.intent_users) > 0
          ? Number(conversionRow.converted) / Number(conversionRow.intent_users)
          : null,
      },
    },
  });
}
