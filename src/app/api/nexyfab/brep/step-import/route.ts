/**
 * POST /api/nexyfab/brep/step-import
 * STEP → tessellated preview (sync small / async large). Optional `BREP_WORKER_URL` for OCCT worker.
 */
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkMonthlyLimit, checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { getStorage } from '@/lib/storage';
import { enqueueBrepStepJob, getBrepMemoryQueueLength } from '@/lib/brep-bridge/jobQueue';
import { BREP_STEP_MAX_BYTES, BREP_STEP_SYNC_MAX_BYTES } from '@/lib/brep-bridge/constants';
import { maybeUploadBrepPreviewStl, runBrepStepProcess } from '@/lib/brep-bridge/processBrepStep';
import { brepApiLangFromRequest, brepMsg } from '@/lib/brep-bridge/brepApiI18n';
import { isAllowedStepFilename } from '@/lib/brep-bridge/validation';
import { brepMaxQueueDepth, getBrepPendingQueueDepth } from '@/lib/brep-bridge/capacity';
import { nfApiInfo } from '@/lib/nfApiLog';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const lang = brepApiLangFromRequest(req);
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`brep-step:${ip}:${plan.userId}`, 20, 3_600_000);
  if (!rl.allowed) {
    nfApiInfo('brep.step-import', 'RATE_LIMIT', { userId: plan.userId });
    return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const asyncMode = body.async === true;

  let buffer: Buffer;
  let filename = 'model.step';

  const rawInput = body.input as Record<string, unknown> | undefined;
  if (!rawInput || typeof rawInput !== 'object') {
    return NextResponse.json(
      { error: brepMsg(lang, 'INPUT_REQUIRED'), code: 'INPUT_REQUIRED' },
      { status: 400 },
    );
  }
  const input = rawInput;
  const kind = input.kind;

  if (kind === 'inlineBase64') {
    filename =
      typeof input.filename === 'string' && input.filename.trim()
        ? input.filename.trim()
        : 'model.step';
    const b64 = typeof input.base64 === 'string' ? input.base64 : '';
    buffer = Buffer.from(b64, 'base64');
  } else if (kind === 'objectKey') {
    const key = typeof input.key === 'string' ? input.key : '';
    if (!key.trim()) {
      return NextResponse.json({ error: 'input.key is required for objectKey' }, { status: 400 });
    }
    filename =
      typeof input.filename === 'string' && input.filename.trim()
        ? input.filename.trim()
        : key.split('/').pop() ?? 'model.step';
    const storage = getStorage();
    if (!storage.download) {
      return NextResponse.json(
        { error: brepMsg(lang, 'STORAGE_UNAVAILABLE'), code: 'STORAGE_UNAVAILABLE' },
        { status: 501 },
      );
    }
    try {
      buffer = await storage.download(key);
    } catch {
      return NextResponse.json(
        { error: brepMsg(lang, 'OBJECT_DOWNLOAD_FAILED'), code: 'OBJECT_DOWNLOAD_FAILED' },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'input.kind must be inlineBase64 or objectKey' },
      { status: 400 },
    );
  }

  if (!isAllowedStepFilename(filename)) {
    return NextResponse.json(
      { error: brepMsg(lang, 'FILENAME_STEP'), code: 'FILENAME_STEP' },
      { status: 400 },
    );
  }

  if (buffer.length === 0) {
    return NextResponse.json(
      { error: brepMsg(lang, 'EMPTY_PAYLOAD'), code: 'EMPTY_PAYLOAD' },
      { status: 400 },
    );
  }
  if (buffer.length > BREP_STEP_MAX_BYTES) {
    return NextResponse.json(
      { error: brepMsg(lang, 'TOO_LARGE'), code: 'TOO_LARGE', maxBytes: BREP_STEP_MAX_BYTES },
      { status: 413 },
    );
  }

  const quota = await checkMonthlyLimit(plan.userId, plan.plan, 'brep_step_import');
  if (!quota.ok) {
    nfApiInfo('brep.step-import', 'MONTHLY_LIMIT', {
      userId: plan.userId,
      used: quota.used,
      limit: quota.limit,
    });
    return NextResponse.json(
      {
        error: brepMsg(lang, 'MONTHLY_LIMIT'),
        code: 'MONTHLY_LIMIT',
        used: quota.used,
        limit: quota.limit,
      },
      { status: 403 },
    );
  }

  const forceAsync = asyncMode || buffer.length > BREP_STEP_SYNC_MAX_BYTES;

  if (!forceAsync) {
    const syncId = `sync-${randomBytes(8).toString('hex')}`;
    const r = await runBrepStepProcess({
      userId: plan.userId,
      jobId: syncId,
      filename,
      buffer,
    });
    if (!r.previewMeshBase64 && !r.artifactUrl) {
      const status = r.errorMessage?.includes('Not a valid STEP') ? 422 : 503;
      nfApiInfo('brep.step-import', 'BREP_FAILED', {
        status,
        userId: plan.userId,
        hint: r.errorMessage?.slice(0, 120),
      });
      return NextResponse.json(
        { mode: 'sync', error: r.errorMessage ?? 'Processing failed', code: 'BREP_FAILED' },
        { status },
      );
    }
    let artifactUrl = r.artifactUrl;
    let artifactKey: string | undefined;
    if (r.previewMeshBase64) {
      const up = await maybeUploadBrepPreviewStl({
        userId: plan.userId,
        jobId: syncId,
        previewMeshBase64: r.previewMeshBase64,
      });
      if (up.artifactUrl) {
        artifactUrl = up.artifactUrl;
        artifactKey = up.artifactKey;
      }
    }
    const consumed = await consumeMonthlyMetricSlot(plan.userId, plan.plan, 'brep_step_import', {
      mode: 'sync',
      jobId: syncId,
      filename,
    });
    if (!consumed.ok) {
      nfApiInfo('brep.step-import', 'MONTHLY_SLOT_RACE_AFTER_SYNC', {
        userId: plan.userId,
        used: consumed.used,
        limit: consumed.limit,
      });
    }
    logCadPipelineAudit({
      userId: plan.userId,
      plan: plan.plan,
      action: CadAuditAction.STEP_IMPORT_SYNC,
      resourceId: syncId,
      metadata: { filename, bytes: buffer.length },
      ip,
    });
    return NextResponse.json({
      mode: 'sync',
      previewMeshBase64: r.previewMeshBase64,
      artifactUrl,
      artifactKey,
      brepSessionToken: r.brepSessionToken,
      warning: r.errorMessage,
    });
  }

  const depth = await getBrepPendingQueueDepth(getBrepMemoryQueueLength());
  if (depth >= brepMaxQueueDepth()) {
    nfApiInfo('brep.step-import', 'QUEUE_FULL', { userId: plan.userId, depth, max: brepMaxQueueDepth() });
    return NextResponse.json(
      { error: brepMsg(lang, 'QUEUE_FULL'), code: 'QUEUE_FULL' },
      { status: 503 },
    );
  }

  const reserved = await consumeMonthlyMetricSlot(plan.userId, plan.plan, 'brep_step_import', {
    mode: 'async',
    filename,
  });
  if (!reserved.ok) {
    nfApiInfo('brep.step-import', 'MONTHLY_LIMIT_RESERVE', {
      userId: plan.userId,
      used: reserved.used,
      limit: reserved.limit,
    });
    return NextResponse.json(
      {
        error: brepMsg(lang, 'MONTHLY_LIMIT'),
        code: 'MONTHLY_LIMIT',
        used: reserved.used,
        limit: reserved.limit,
      },
      { status: 403 },
    );
  }

  const job = await enqueueBrepStepJob({ userId: plan.userId, buffer, filename });
  logCadPipelineAudit({
    userId: plan.userId,
    plan: plan.plan,
    action: CadAuditAction.STEP_IMPORT_ASYNC,
    resourceId: job.id,
    metadata: { filename, bytes: buffer.length },
    ip,
  });
  return NextResponse.json({
    mode: 'async',
    jobId: job.id,
    pollUrl: `/api/nexyfab/brep/step-import/job/${job.id}`,
  });
}
