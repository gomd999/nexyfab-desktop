import { getDbAdapter } from '@/lib/db-adapter';

const MAX_LOGS = 1000;

export interface ErrorLog {
  id: string;
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  url?: string;
  userId?: string;
  [key: string]: unknown;
}

function insertLog(log: ErrorLog): void {
  const { id, timestamp, level, message, stack, ...rest } = log;
  const context = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '{}';

  const db = getDbAdapter();
  db.execute(
    `INSERT INTO nf_error_logs (id, level, message, stack, context, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, level, message, stack ?? null, context, timestamp,
  ).then(() => {
    // Trim oldest rows beyond MAX_LOGS (best-effort)
    db.execute(
      `DELETE FROM nf_error_logs WHERE id NOT IN (
         SELECT id FROM nf_error_logs ORDER BY created_at DESC LIMIT ?
       )`,
      MAX_LOGS,
    ).catch(() => {});
  }).catch(() => {});
}

export function logError(
  message: string,
  error?: Error,
  context?: Record<string, unknown>
): void {
  try {
    const log: ErrorLog = {
      id: `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      stack: error?.stack,
      ...context,
    };
    insertLog(log);
  } catch {
    // 로깅 실패는 조용히 무시
  }
}

export function logWarn(
  message: string,
  context?: Record<string, unknown>
): void {
  try {
    const log: ErrorLog = {
      id: `WARN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...context,
    };
    insertLog(log);
  } catch {
    // 무시
  }
}
