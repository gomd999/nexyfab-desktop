// 요청 정합(intent-match) 텔레메트리 — 불일치·가정·교정 결과를 축적해
// KW_MAP/판정부 보강의 실데이터 근거로 쓴다(260717). 기록 실패=조용히 무시(생성 비차단).
import { getDbAdapter } from './db-adapter';

let ensured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_intent_log (
      id            TEXT PRIMARY KEY,
      description   TEXT NOT NULL,
      domain        TEXT,
      matched       BIGINT,
      mismatched    BIGINT,
      unverifiable  BIGINT,
      results       TEXT,
      assumptions   TEXT,
      repair        TEXT,
      created_at    BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_nf_intent_log_ts ON nf_intent_log (created_at)').catch(() => {});
  ensured = true;
}

export interface IntentMatchLog {
  matched: number; mismatched: number; unverifiable: number;
  results: Array<{ verdict: string; note: string; text: string; kind?: string }>;
  assumptions?: string[];
  repair?: { attempted: boolean; adopted: boolean; before: number; after: number };
}

/** 정합 검사 1회 결과를 기록(비치명 — 실패해도 응답에 영향 없음). */
export async function recordIntentMatch(description: string, domain: string | null, im: IntentMatchLog): Promise<void> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    await db.execute(
      `INSERT INTO nf_intent_log (id, description, domain, matched, mismatched, unverifiable, results, assumptions, repair, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), description.slice(0, 2000), domain,
      im.matched, im.mismatched, im.unverifiable,
      JSON.stringify(im.results.slice(0, 24)),
      im.assumptions?.length ? JSON.stringify(im.assumptions) : null,
      im.repair ? JSON.stringify(im.repair) : null,
      Date.now(),
    );
  } catch { /* non-fatal */ }
}

export interface IntentLogRow {
  id: string; description: string; domain: string | null;
  matched: number; mismatched: number; unverifiable: number;
  results: string; assumptions: string | null; repair: string | null; created_at: number;
}

/** 최근 로그(최신순) — 불일치 우선 분석용. mismatchedOnly=true 면 불일치 발생 건만. */
export async function listIntentLogs(limit = 50, mismatchedOnly = false): Promise<IntentLogRow[]> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const rows = await db.queryAll<IntentLogRow>(
      `SELECT id, description, domain, matched, mismatched, unverifiable, results, assumptions, repair, created_at
       FROM nf_intent_log ${mismatchedOnly ? 'WHERE mismatched > 0' : ''}
       ORDER BY created_at DESC LIMIT ?`,
      limit,
    );
    return rows ?? [];
  } catch {
    return [];
  }
}
