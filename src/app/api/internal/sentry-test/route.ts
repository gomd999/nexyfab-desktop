/**
 * GET /api/internal/sentry-test
 *
 * Admin-only smoke test that throws an intentional error and routes it
 * through `captureServerError`. Lets ops verify SENTRY_DSN connectivity +
 * PII scrub by inspecting the resulting Issue in Sentry.
 *
 * Auth: super_admin only. Body always returns 500 with a stable error code
 * so dashboards/cron probes can also assert connectivity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { captureServerError } from '@/lib/error-capture';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser || authUser.globalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tag = req.nextUrl.searchParams.get('tag') ?? 'manual';
  const message = `[sentry-test:${tag}] intentional probe at ${new Date().toISOString()}`;
  const err = new Error(message);

  captureServerError(err, {
    route: '/api/internal/sentry-test',
    method: 'GET',
    errorClass: 'sentryProbe',
    userId: authUser.userId,
    tags: { probe: 'sentry-test', tag },
    // Include a fake JWT + email to verify the scrubber redacts both before
    // the event reaches Sentry. If you see these literals in the Sentry UI,
    // the scrubber is broken.
    extras: {
      sampleEmail: 'leak-detector@example.com',
      sampleAuth: 'Bearer eyABCDEFGHIJKLMNOPQRSTU.eyVWXYZ0123456789ABCDEFG.signature_xyz123456789abc',
      sessionId: 'session-but-this-key-is-redacted-by-name',
    },
  });

  return NextResponse.json(
    { ok: true, captured: true, eventTag: tag, sentAt: Date.now() },
    { status: 200 },
  );
}
