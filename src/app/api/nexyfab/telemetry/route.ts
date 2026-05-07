import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { logAudit } from '@/lib/audit';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { shouldSkipTelemetryDuplicateForCadAudit } from '@/lib/telemetryCadDedupe';
import { forwardToSentry } from '@/lib/sentry-forward';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { flattenFeaturePipelineContext } from '@/lib/featurePipelineTelemetry';

/**
 * Client-side telemetry ingestion for shape-generator.
 *
 * Accepts a batch of TelemetryEvent objects from the browser and logs each
 * error/warning via the existing audit sink. Auth is optional — anonymous
 * events are still captured so we can catch errors before login.
 *
 * The client POSTs from `src/app/[lang]/shape-generator/lib/telemetry.ts` with
 * `keepalive: true`, so this route must respond quickly and never throw.
 *
 * Cad audit: high-frequency export/CAM events use this batched endpoint; Pro+ also
 * get `cad.*` rows via `logCadPipelineAudit` (see `telemetryCadDedupe.ts`).
 * One-off explicit audit POSTs can use `/api/nexyfab/cad-audit` instead.
 */

interface IncomingEvent {
  id?: string;
  ts?: number;
  level?: 'error' | 'warning' | 'info';
  source?: string;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
  sessionId?: string;
}

const MAX_EVENTS_PER_REQUEST = 100;

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 5000;

function sanitize(ev: IncomingEvent): IncomingEvent {
  return {
    id: typeof ev.id === 'string' ? ev.id.slice(0, 64) : undefined,
    ts: typeof ev.ts === 'number' ? ev.ts : Date.now(),
    level: ev.level === 'warning' || ev.level === 'info' ? ev.level : 'error',
    source: typeof ev.source === 'string' ? ev.source.slice(0, 64) : 'unknown',
    message: typeof ev.message === 'string' ? ev.message.slice(0, MAX_MESSAGE_LEN) : '',
    stack: typeof ev.stack === 'string' ? ev.stack.slice(0, MAX_STACK_LEN) : undefined,
    context: ev.context && typeof ev.context === 'object' ? ev.context : undefined,
    url: typeof ev.url === 'string' ? ev.url.slice(0, 256) : undefined,
    sessionId: typeof ev.sessionId === 'string' ? ev.sessionId.slice(0, 64) : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req).catch(() => null);
    const body = (await req.json().catch(() => null)) as { events?: IncomingEvent[] } | null;
    if (!body || !Array.isArray(body.events)) {
      return NextResponse.json({ ok: false, error: 'events array required' }, { status: 400 });
    }

    const events = body.events.slice(0, MAX_EVENTS_PER_REQUEST).map(sanitize);

    // Fan out to the existing audit log so ops can query it alongside other
    // user activity. logAudit swallows its own errors, so one bad row won't
    // break the batch.
    const ip = getTrustedClientIpOrUndefined(req.headers);
    for (const ev of events) {
      const ctx =
        ev.context && typeof ev.context === 'object' && !Array.isArray(ev.context)
          ? (ev.context as Record<string, unknown>)
          : undefined;
      const flat = flattenFeaturePipelineContext(ctx);

      const skipDuplicateTelemetryForCadAudit = shouldSkipTelemetryDuplicateForCadAudit({
        authUser,
        level: ev.level,
        source: ev.source,
      });

      if (!skipDuplicateTelemetryForCadAudit) {
        void logAudit({
          userId: authUser?.userId ?? 'anonymous',
          action: `telemetry.${ev.source}.${ev.level}`,
          resourceId: ev.sessionId,
          metadata: {
            message: ev.message,
            stack: ev.stack,
            url: ev.url,
            ts: ev.ts,
            ...flat,
          },
          ip,
        });
      }

      // Pro+ enterprise CAD audit stream — stable `cad.*` actions for exports / CAM.
      if (authUser && ev.level === 'info') {
        const cadMeta: Record<string, unknown> = {
          message: ev.message,
          url: ev.url,
          ts: ev.ts,
          ...flat,
        };
        if (ctx) {
          for (const [k, v] of Object.entries(ctx)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') cadMeta[k] = v;
          }
        }
        if (ev.source === 'drawing_export') {
          logCadPipelineAudit({
            userId: authUser.userId,
            plan: authUser.plan,
            action: CadAuditAction.DRAWING_EXPORT,
            resourceId: ev.sessionId,
            metadata: cadMeta,
            ip,
          });
        } else if (ev.source === 'mesh_export') {
          logCadPipelineAudit({
            userId: authUser.userId,
            plan: authUser.plan,
            action: CadAuditAction.MESH_EXPORT,
            resourceId: ev.sessionId,
            metadata: cadMeta,
            ip,
          });
        } else if (ev.source === 'cam_toolpath') {
          logCadPipelineAudit({
            userId: authUser.userId,
            plan: authUser.plan,
            action: CadAuditAction.CAM_TOOLPATH_REQUEST,
            resourceId: ev.sessionId,
            metadata: cadMeta,
            ip,
          });
        }
      }

      // Forward errors/warnings to Sentry (no-op if SENTRY_DSN unset).
      if (ev.level === 'error' || ev.level === 'warning') {
        forwardToSentry({
          level: ev.level,
          message: ev.message ?? '(no message)',
          stack: ev.stack,
          tags: {
            source: ev.source ?? 'unknown',
            ...(flat.diagnosticCode ? { diagnosticCode: flat.diagnosticCode } : {}),
            ...(flat.featureType ? { featureType: flat.featureType } : {}),
            ...(flat.stage ? { pipelineStage: flat.stage } : {}),
          },
          extra: { ...(ctx ?? {}), url: ev.url, sessionId: ev.sessionId },
          user: { id: authUser?.userId ?? 'anonymous', ip_address: ip },
        });
      }
    }

    // In dev, also surface to server console so we see errors in `next dev`.
    if (process.env.NODE_ENV !== 'production') {
      for (const ev of events) {
        if (ev.level === 'error') {
          console.error(`[telemetry:${ev.source}]`, ev.message, ev.context ?? '');
        }
      }
    }

    return NextResponse.json({ ok: true, received: events.length });
  } catch (e) {
    // Telemetry must never fail loudly — return 200 with an error flag.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
}
