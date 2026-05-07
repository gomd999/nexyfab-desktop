/**
 * Client-side instrumentation (runs before the app is interactive).
 * Sentry는 `NEXT_PUBLIC_SENTRY_DSN`이 유효할 때만 초기화(상용 배포에서 오류 수집).
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 */
import { captureRouterTransitionStart, init } from '@sentry/nextjs';

const rawDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const sentryEnabled = Boolean(
  rawDsn && rawDsn !== 'CHANGE_ME' && !rawDsn.startsWith('CHANGE_ME'),
);

if (sentryEnabled) {
  const traces = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1);
  const replayErr = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? 1);
  const replaySess = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? 0.01);
  init({
    dsn: rawDsn,
    tracesSampleRate: Number.isFinite(traces) ? Math.min(1, Math.max(0, traces)) : 0.1,
    debug: false,
    replaysOnErrorSampleRate: Number.isFinite(replayErr) ? Math.min(1, Math.max(0, replayErr)) : 1,
    replaysSessionSampleRate: Number.isFinite(replaySess) ? Math.min(1, Math.max(0, replaySess)) : 0.01,
    integrations: [],
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_RELEASE,
  });
}

/** App Router 네비게이션 계측 — Sentry 비활성 시 no-op */
export const onRouterTransitionStart = sentryEnabled
  ? captureRouterTransitionStart
  : () => {};
