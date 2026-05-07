// src/lib/logger.ts
// 구조화된 JSON 로깅. 프로덕션에서는 stderr로 출력해 ELK/Datadog 등으로 수집.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };

  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) =>
    process.env.NODE_ENV === 'development' && write('debug', msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
};

/** 요청 성능 측정 헬퍼 */
export function measureRequest(
  method: string,
  path: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  return fn().then(
    (res) => {
      logger.info('request', { method, path, status: res.status, ms: Date.now() - start });
      return res;
    },
    (err: unknown) => {
      logger.error('request_error', {
        method,
        path,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    },
  );
}
