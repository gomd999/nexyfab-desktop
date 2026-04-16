/**
 * Next.js instrumentation hook — called once when the server starts.
 * This is the correct place for server-side startup validation and DB init.
 * Does NOT run during `next build`.
 */
export async function register() {
  // ── Server-only startup tasks ──────────────────────────────────────────────
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateStartup } = await import('./lib/startup-validation');
    validateStartup();

    // PostgreSQL 스키마 초기화 (DATABASE_URL 설정 시)
    if (process.env.DATABASE_URL) {
      const { initPostgresSchema } = await import('./lib/db-adapter');
      await initPostgresSchema().catch((err: unknown) => {
        console.error('[instrumentation] PostgreSQL schema init failed:', err);
        process.exit(1);
      });
    }
  }
}
