/**
 * POST /api/nexyfab/request-quote
 *
 * Manufacturer quoting endpoint. Wraps the provider registry so the UI
 * doesn't need to know whether the active provider is the internal
 * estimator or a (future) Xometry / Hubs integration.
 *
 * v1 plan gating: FREE-accessible. Quoting is a conversion funnel — we
 * want users seeing prices before they hit a paywall. Monthly slot cap
 * still applies (free=20, pro=200, team=1000, enterprise=-1) so a
 * runaway script can't burn through provider quota.
 *
 * Provider failures (NOT_CONFIGURED in particular) surface as 503 with
 * the reason text. The UI inspects `code` and offers a "fall back to
 * internal" affordance — we never silently swap providers on the user.
 *
 * Caller flow:
 *   POST { providerId?, process, material, quantity, measuredVolumeMm3?,
 *          bboxMm?, notes? }
 *   → 200 { ok: true, quote: QuoteResponse, ...usage }
 *   → 4xx/5xx { ok: false, code, error/reason }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { getDefaultProvider, getProvider } from '@/lib/quoting/registry';
import type { Material } from '@/lib/ai/scad-agent/costEstimation';
import type { ProcessForDfm } from '@/lib/ai/scad-agent/specVerification';
import type { QuoteRequest } from '@/lib/quoting/types';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Quoting is cheap relative to vision; 60/hr
 *  matches the cost-copilot / dfm-explainer tier. */
const RATE_LIMIT_PER_HOUR = 60;
const MAX_JSON_BODY_BYTES = 64 * 1024;

const VALID_PROCESSES: readonly ProcessForDfm[] = [
  'fdm', 'sla', 'cnc_mill', 'sheet', 'injection_molding', 'die_cast',
] as const;
const VALID_MATERIALS: readonly Material[] = [
  'aluminum_6061', 'steel_a36', 'steel_4140', 'stainless_304', 'pla', 'abs',
] as const;

/** Map provider failure codes to HTTP status. NOT_CONFIGURED is 503 (the
 *  service is genuinely unavailable, not the user's fault). Geometry +
 *  unsupported errors are 422 (request shape is fine, content can't be
 *  priced). PROVIDER_ERROR is 502 (upstream failure). */
function failureStatus(code: string): number {
  switch (code) {
    case 'NOT_CONFIGURED':       return 503;
    case 'UNSUPPORTED_PROCESS':
    case 'UNSUPPORTED_MATERIAL':
    case 'INVALID_GEOMETRY':     return 422;
    case 'PROVIDER_ERROR':       return 502;
    default:                     return 500;
  }
}

export async function POST(req: NextRequest) {
  // (1) Plan gate — FREE accessible (conversion funnel).
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;
  const userId = planCheck.userId;
  const plan = planCheck.plan;

  // (2) Rate limit.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`request-quote:${ip}:${userId}`, RATE_LIMIT_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Rate limit exceeded — please wait before requesting another quote', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  // (3) Body + validation.
  const body = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as Record<string, unknown>;
  const process = typeof body.process === 'string' ? body.process : '';
  if (!process || !(VALID_PROCESSES as readonly string[]).includes(process)) {
    return NextResponse.json(
      {
        ok: false,
        error: `process is required and must be one of: ${VALID_PROCESSES.join(', ')}`,
        code: 'BAD_PROCESS',
      },
      { status: 400 },
    );
  }
  const material = typeof body.material === 'string' ? body.material : '';
  if (!material || !(VALID_MATERIALS as readonly string[]).includes(material)) {
    return NextResponse.json(
      {
        ok: false,
        error: `material is required and must be one of: ${VALID_MATERIALS.join(', ')}`,
        code: 'BAD_MATERIAL',
      },
      { status: 400 },
    );
  }
  const quantityRaw = typeof body.quantity === 'number' ? body.quantity : 1;
  const quantity = Math.max(1, Math.floor(quantityRaw));
  if (!Number.isFinite(quantity)) {
    return NextResponse.json(
      { ok: false, error: 'quantity must be a positive integer', code: 'BAD_QUANTITY' },
      { status: 400 },
    );
  }
  // Optional geometry fields. Validate when present so the provider doesn't
  // have to repeat the typecheck.
  let measuredVolumeMm3: number | undefined;
  if (typeof body.measuredVolumeMm3 === 'number' && body.measuredVolumeMm3 > 0) {
    measuredVolumeMm3 = body.measuredVolumeMm3;
  }
  let bboxMm: QuoteRequest['bboxMm'];
  if (body.bboxMm && typeof body.bboxMm === 'object') {
    const b = body.bboxMm as { wMm?: unknown; hMm?: unknown; dMm?: unknown };
    if (typeof b.wMm === 'number' && typeof b.hMm === 'number' && typeof b.dMm === 'number'
        && b.wMm > 0 && b.hMm > 0 && b.dMm > 0) {
      bboxMm = { wMm: b.wMm, hMm: b.hMm, dMm: b.dMm };
    }
  }
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined;

  // (4) Provider selection — caller may pin one (`providerId`), else use
  // the first configured provider in registry order (always internal).
  const providerId = typeof body.providerId === 'string' ? body.providerId : '';
  const provider = providerId ? getProvider(providerId) : getDefaultProvider();
  if (!provider) {
    return NextResponse.json(
      { ok: false, error: `Unknown provider "${providerId}"`, code: 'UNKNOWN_PROVIDER' },
      { status: 400 },
    );
  }

  // (5) Consume monthly slot BEFORE calling the provider. A NOT_CONFIGURED
  // bounce-back still counts — the user used a quota slot to discover the
  // partner integration isn't live, which is fair and prevents a script
  // probing every provider for free.
  let usage: { used: number; limit: number; remaining: number } | undefined;
  const slot = await consumeMonthlyMetricSlot(userId, plan, 'quote_request', undefined, planCheck.orgId);
  if (!slot.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Monthly quote-request limit reached (${slot.limit}/month).`,
        code: 'MONTHLY_LIMIT',
        limit: slot.limit,
      },
      { status: 429 },
    );
  }
  if (slot.limit > 0) {
    usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
  }

  // (6) Call the provider. The interface contract is "never throws" — but
  // wrap in try/catch anyway so a misbehaving provider can't crash the
  // route handler.
  const quoteReq: QuoteRequest = {
    process: process as ProcessForDfm,
    material: material as Material,
    quantity,
    ...(measuredVolumeMm3 !== undefined ? { measuredVolumeMm3 } : {}),
    ...(bboxMm !== undefined ? { bboxMm } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
  let result;
  try {
    result = await provider.getQuote(quoteReq);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `Provider "${provider.id}" threw: ${(e as Error).message}`,
        code: 'PROVIDER_THREW',
      },
      { status: 500 },
    );
  }

  // (7) Audit — non-blocking. Metadata is intentionally minimal (no PII,
  // no full geometry) so audit rows stay grep-able.
  try {
    logCadPipelineAudit({
      userId,
      plan,
      action: CadAuditAction.QUOTE_REQUESTED,
      metadata: {
        providerId: provider.id,
        process,
        material,
        quantity,
        ok: result.ok,
        ...(result.ok
          ? { totalUsd: Number(result.quote.totalUsd.toFixed(2)), confidence: result.quote.confidence }
          : { code: result.code }),
      },
      ip,
    });
  } catch { /* never block on audit */ }

  // (8) Surface the provider failure verbatim — the UI inspects `code` to
  // decide whether to offer "fall back to internal" (NOT_CONFIGURED) or
  // "try a different material" (UNSUPPORTED_MATERIAL), etc.
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        error: result.reason,
        providerId: provider.id,
        ...(usage ? { usage } : {}),
      },
      { status: failureStatus(result.code) },
    );
  }

  return NextResponse.json({
    ok: true,
    quote: result.quote,
    ...(usage ? { usage } : {}),
  });
}
