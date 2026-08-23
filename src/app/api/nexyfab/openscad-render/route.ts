/**
 * POST /api/nexyfab/openscad-render
 * OpenSCAD CLI → mesh (STL/OFF). Sync for small outputs; async job for large sources or when async=true.
 *
 * @see docs/strategy/JSCAD_OPENSCAD_BRIDGE.md
 */
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkMonthlyLimit, checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { maybeUploadOpenScadArtifact } from '@/lib/openscad-render/artifactUpload';
import { enqueueOpenScadJob } from '@/lib/openscad-render/jobQueue';
import { runOpenScadCli, type OpenScadMeshFormat } from '@/lib/openscad-render/runOpenScadCli';
import {
  OPENSCAD_MAX_SCAD_BYTES,
  OPENSCAD_SYNC_MAX_OUTPUT_BYTES,
} from '@/lib/openscad-render/constants';
import { openscadApiLangFromRequest, openscadMsg } from '@/lib/openscad-render/openscadApiI18n';
import { nfApiInfo } from '@/lib/nfApiLog';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
// 20 MiB decoded import STL expands to about 26.7 MiB base64, plus SCAD and JSON overhead.
const MAX_JSON_BODY_BYTES = 30 * 1024 * 1024;

function parseFormat(v: unknown): OpenScadMeshFormat {
  if (v === 'off') return 'off';
  if (v === '3mf') return '3mf';
  return 'stl';
}

export async function POST(req: NextRequest) {
  const lang = openscadApiLangFromRequest(req);
  // Studio is a wide funnel: GUESTS may render (so they can see + slider-tune
  // their 1 free design), bounded by an IP rate limit. Logged-in users keep
  // their monthly quota; guests are metered only by the rate limit below.
  const plan = await checkPlan(req, 'free');
  const ip = getTrustedClientIp(req.headers);
  const isGuest = !plan.ok;
  const userId = plan.ok ? plan.userId : `guest:${ip}`;
  const planTier = plan.ok ? plan.plan : 'free';

  // Guests get a tighter render budget than logged-in users (abuse guard on an
  // anonymous CPU endpoint); logged-in users keep the generous 30/hr.
  const rl = rateLimit(`openscad-render:${ip}:${userId}`, isGuest ? 12 : 30, 3_600_000);
  if (!rl.allowed) {
    nfApiInfo('openscad.render', 'RATE_LIMIT', { userId });
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  const body = (await readBoundedJson<Record<string, unknown>>(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as Record<string, unknown>;
  const scad = typeof body.scad === 'string' ? body.scad : '';
  const format = parseFormat(body.format);
  const asyncMode = body.async === true;
  // Optional attached STL the source can `import("model.stl")` to modify.
  let importStl: Uint8Array | undefined;
  if (typeof body.importStl === 'string' && body.importStl.length > 0) {
    try {
      const buf = Buffer.from(body.importStl, 'base64');
      if (buf.byteLength > 0 && buf.byteLength <= 20 * 1024 * 1024) importStl = Uint8Array.from(buf);
    } catch { /* ignore bad base64 */ }
  }

  if (!scad.trim()) {
    return NextResponse.json(
      { error: openscadMsg(lang, 'SCAD_REQUIRED'), code: 'SCAD_REQUIRED' },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(scad, 'utf8') > OPENSCAD_MAX_SCAD_BYTES) {
    return NextResponse.json(
      { error: `scad exceeds ${OPENSCAD_MAX_SCAD_BYTES} bytes`, code: 'SCAD_TOO_LARGE' },
      { status: 413 },
    );
  }

  if (plan.ok) {
    const quota = await checkMonthlyLimit(userId, planTier, 'openscad_render', plan.orgId);
    if (!quota.ok) {
      nfApiInfo('openscad.render', 'MONTHLY_LIMIT', {
        userId: userId,
        used: quota.used,
        limit: quota.limit,
      });
      return NextResponse.json(
        {
          error: openscadMsg(lang, 'MONTHLY_LIMIT'),
          code: 'MONTHLY_LIMIT',
          used: quota.used,
          limit: quota.limit,
        },
        { status: 403 },
      );
    }
  }

  const forceAsync =
    process.env.OPENSCAD_EXTERNAL_WORKER === '1'
    || asyncMode
    || Buffer.byteLength(scad, 'utf8') > 200_000;

  if (!forceAsync) {
    const r = await runOpenScadCli({ scadSource: scad, format, importStl });
    if (!r.ok) {
      const status = r.code === 'ENOENT' ? 503 : r.code === 'TIMEOUT' ? 504 : 500;
      nfApiInfo('openscad.render', 'CLI_FAILED', { code: r.code, status, userId: userId });
      return NextResponse.json({ error: r.message, code: r.code, stderr: r.stderr }, { status });
    }
    if (r.buffer.length > OPENSCAD_SYNC_MAX_OUTPUT_BYTES) {
      nfApiInfo('openscad.render', 'OUTPUT_TOO_LARGE', {
        userId: userId,
        bytes: r.buffer.length,
      });
      return NextResponse.json(
        {
          error: 'Rendered mesh too large for inline API response',
          code: 'OUTPUT_TOO_LARGE',
          bytes: r.buffer.length,
          hint: 'Use a smaller model, coarser tessellation, or export locally with OpenSCAD.',
        },
        { status: 413 },
      );
    }
    const syncId = `sync-${randomBytes(8).toString('hex')}`;
    const artifact = await maybeUploadOpenScadArtifact({
      buffer: r.buffer,
      userId: userId,
      jobId: syncId,
      format,
    });
    // Guests aren't on the monthly meter — bounded by the IP rate limit so a
    // free design + slider tweaks don't exhaust a per-IP monthly cap mid-session.
    if (plan.ok) {
      const consumed = await consumeMonthlyMetricSlot(userId, planTier, 'openscad_render', {
        mode: 'sync',
        jobId: syncId,
        format,
        bytesOut: r.buffer.length,
      }, plan.orgId);
      if (!consumed.ok) {
        nfApiInfo('openscad.render', 'MONTHLY_SLOT_RACE_AFTER_SYNC', {
          userId: userId,
          used: consumed.used,
          limit: consumed.limit,
        });
      }
    }
    logCadPipelineAudit({
      userId: userId,
      plan: planTier,
      action: CadAuditAction.OPENSCAD_SYNC,
      resourceId: syncId,
      metadata: { format, bytesOut: r.buffer.length, scadBytes: Buffer.byteLength(scad, 'utf8') },
      ip,
    });
    return NextResponse.json({
      mode: 'sync',
      format,
      dataBase64: r.buffer.toString('base64'),
      ...(artifact.artifactUrl
        ? { artifactUrl: artifact.artifactUrl, artifactKey: artifact.artifactKey }
        : {}),
    });
  }

  if (plan.ok) {
    const reserved = await consumeMonthlyMetricSlot(userId, planTier, 'openscad_render', {
      mode: 'async',
      format,
    }, plan.orgId);
    if (!reserved.ok) {
      nfApiInfo('openscad.render', 'MONTHLY_LIMIT_RESERVE', {
        userId: userId,
        used: reserved.used,
        limit: reserved.limit,
      });
      return NextResponse.json(
        {
          error: openscadMsg(lang, 'MONTHLY_LIMIT'),
          code: 'MONTHLY_LIMIT',
          used: reserved.used,
          limit: reserved.limit,
        },
        { status: 403 },
      );
    }
  }

  const job = await enqueueOpenScadJob({ userId: userId, scad, format, ...(importStl ? { importStl } : {}) });
  if (job.status === 'failed') {
    return NextResponse.json(
      { error: job.errorMessage ?? 'OpenSCAD worker unavailable', code: 'OPENSCAD_WORKER_UNAVAILABLE' },
      { status: 503 },
    );
  }
  logCadPipelineAudit({
    userId: userId,
    plan: planTier,
    action: CadAuditAction.OPENSCAD_ASYNC,
    resourceId: job.id,
    metadata: { format, scadBytes: Buffer.byteLength(scad, 'utf8') },
    ip,
  });
  return NextResponse.json({
    mode: 'async',
    jobId: job.id,
    pollUrl: `/api/nexyfab/openscad-render/job/${job.id}`,
  });
}
