/**
 * Next.js instrumentation — SDK-free server error forwarding + startup/DB init.
 * `next build` 시 Node 런타임에서만 startup/Postgres 경로가 실행됩니다.
 */
import { forwardToSentry } from './lib/sentry-forward';
import { scrubString } from './lib/sentryRedact';

export function onRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string }>,
  context: Readonly<{ routerKind: string; routePath: string; routeType: string }>,
) {
  const value = error instanceof Error ? error : new Error(String(error));
  forwardToSentry({
    level: 'error',
    message: String(scrubString(value.message)),
    stack: String(scrubString(value.stack)),
    tags: {
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      method: request.method,
    },
    extra: { path: scrubString(request.path) },
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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
}
