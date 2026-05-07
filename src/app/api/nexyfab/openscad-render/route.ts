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

export const dynamic = 'force-dynamic';

function parseFormat(v: unknown): OpenScadMeshFormat {
  if (v === 'off') return 'off';
  return 'stl';
}

export async function POST(req: NextRequest) {
  const lang = openscadApiLangFromRequest(req);
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`openscad-render:${ip}:${plan.userId}`, 30, 3_600_000);
  if (!rl.allowed) {
    nfApiInfo('openscad.render', 'RATE_LIMIT', { userId: plan.userId });
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const scad = typeof body.scad === 'string' ? body.scad : '';
  const format = parseFormat(body.format);
  const asyncMode = body.async === true;

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

  const quota = await checkMonthlyLimit(plan.userId, plan.plan, 'openscad_render');
  if (!quota.ok) {
    nfApiInfo('openscad.render', 'MONTHLY_LIMIT', {
      userId: plan.userId,
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

  const forceAsync =
    asyncMode || Buffer.byteLength(scad, 'utf8') > 200_000;

  if (!forceAsync) {
    const r = await runOpenScadCli({ scadSource: scad, format });
    if (!r.ok) {
      const status = r.code === 'ENOENT' ? 503 : r.code === 'TIMEOUT' ? 504 : 500;
      nfApiInfo('openscad.render', 'CLI_FAILED', { code: r.code, status, userId: plan.userId });
      return NextResponse.json({ error: r.message, code: r.code, stderr: r.stderr }, { status });
    }
    if (r.buffer.length > OPENSCAD_SYNC_MAX_OUTPUT_BYTES) {
      nfApiInfo('openscad.render', 'OUTPUT_TOO_LARGE', {
        userId: plan.userId,
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
      userId: plan.userId,
      jobId: syncId,
      format,
    });
    const consumed = await consumeMonthlyMetricSlot(plan.userId, plan.plan, 'openscad_render', {
      mode: 'sync',
      jobId: syncId,
      format,
      bytesOut: r.buffer.length,
    });
    if (!consumed.ok) {
      nfApiInfo('openscad.render', 'MONTHLY_SLOT_RACE_AFTER_SYNC', {
        userId: plan.userId,
        used: consumed.used,
        limit: consumed.limit,
      });
    }
    logCadPipelineAudit({
      userId: plan.userId,
      plan: plan.plan,
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

  const reserved = await consumeMonthlyMetricSlot(plan.userId, plan.plan, 'openscad_render', {
    mode: 'async',
    format,
  });
  if (!reserved.ok) {
    nfApiInfo('openscad.render', 'MONTHLY_LIMIT_RESERVE', {
      userId: plan.userId,
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

  const job = await enqueueOpenScadJob({ userId: plan.userId, scad, format });
  logCadPipelineAudit({
    userId: plan.userId,
    plan: plan.plan,
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
