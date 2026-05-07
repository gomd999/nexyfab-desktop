/**
 * Next.js instrumentation — Sentry (Node/Edge) + 서버 기동 검증·DB 초기화.
 * `next build` 시 Node 런타임에서만 startup/Postgres 경로가 실행됩니다.
 */
import { captureRequestError, init as sentryInit } from '@sentry/nextjs';

export const onRequestError = captureRequestError;

const sentryOptions = {
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
} as const;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    sentryInit({ ...sentryOptions });

    const { validateStartup } = await import('./lib/startup-validation');
    validateStartup();

    if (process.env.DATABASE_URL) {
      const { initPostgresSchema } = await import('./lib/db-adapter');
      await initPostgresSchema().catch((err: unknown) => {
        console.error('[instrumentation] PostgreSQL schema init failed:', err);
        process.exit(1);
      });
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    sentryInit({ ...sentryOptions });
  }
}
