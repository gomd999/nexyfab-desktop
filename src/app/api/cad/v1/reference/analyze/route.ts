import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { analyzeCadReference } from '@/lib/reference/cadReferenceAnalyze';
import type { CadLengthUnit, DeclaredSourceTolerance } from '@/lib/reference/cadTolerancePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_STEP_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 28 * 1024 * 1024;
const ALLOWED_FIELDS = new Set(['step', 'encoding', 'format', 'scenarioId', 'lengthUnit', 'declaredSourceTolerance']);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface ReferenceAnalyzeBody {
  step?: unknown;
  encoding?: unknown;
  format?: unknown;
  scenarioId?: unknown;
  lengthUnit?: unknown;
  declaredSourceTolerance?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLengthUnit(value: unknown): CadLengthUnit | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'mm' && Object.keys(value).every(key => key === 'kind')) return { kind: 'mm' };
  if (value.kind === 'scale-to-mm' && Number.isFinite(value.scaleToMm) && (value.scaleToMm as number) > 0 &&
      Object.keys(value).every(key => key === 'kind' || key === 'scaleToMm' || key === 'label') &&
      (value.label === undefined || typeof value.label === 'string')) {
    return { kind: 'scale-to-mm', scaleToMm: value.scaleToMm as number, ...(typeof value.label === 'string' ? { label: value.label } : {}) };
  }
  return null;
}

function parseDeclaredTolerance(value: unknown): DeclaredSourceTolerance | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'value') ||
      !Number.isFinite(value.value) || (value.value as number) <= 0) return null;
  return { value: value.value as number };
}

function decodeStep(step: string, encoding: 'base64' | 'utf8'): { source: string; bytes: number } | null {
  if (encoding === 'utf8') {
    const bytes = Buffer.byteLength(step, 'utf8');
    return bytes <= MAX_STEP_BYTES ? { source: step, bytes } : null;
  }
  if (step.length === 0 || step.length % 4 !== 0 || !BASE64.test(step)) return null;
  const buffer = Buffer.from(step, 'base64');
  if (buffer.byteLength > MAX_STEP_BYTES || buffer.toString('base64') !== step) return null;
  return { source: buffer.toString('utf8'), bytes: buffer.byteLength };
}

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-reference-analyze:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }

  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxStepBytes: MAX_STEP_BYTES }, { status: 413 });
  }
  const raw = await req.json().catch(() => null);
  if (!isRecord(raw) || Object.keys(raw).some(key => !ALLOWED_FIELDS.has(key))) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Only an inline STEP body and documented analysis fields are accepted; paths and URLs are forbidden.' }, { status: 400 });
  }
  const body = raw as ReferenceAnalyzeBody;
  const encoding = body.encoding === undefined ? 'base64' : body.encoding;
  const format = body.format === undefined ? 'step' : body.format;
  const scenarioId = body.scenarioId;
  const lengthUnit = parseLengthUnit(body.lengthUnit);
  const declaredSourceTolerance = parseDeclaredTolerance(body.declaredSourceTolerance);
  if (typeof body.step !== 'string' || (encoding !== 'base64' && encoding !== 'utf8') ||
      (format !== 'step' && format !== 'stp') || typeof scenarioId !== 'string' ||
      scenarioId.length === 0 || scenarioId.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(scenarioId) ||
      lengthUnit === null || declaredSourceTolerance === null) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Valid step, encoding, format, scenarioId, and lengthUnit are required.' }, { status: 400 });
  }
  if (body.step.length > MAX_JSON_BYTES) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxStepBytes: MAX_STEP_BYTES }, { status: 413 });
  }
  const decoded = decodeStep(body.step, encoding);
  if (!decoded) {
    const tooLarge = encoding === 'utf8'
      ? Buffer.byteLength(body.step, 'utf8') > MAX_STEP_BYTES
      : body.step.length > Math.ceil(MAX_STEP_BYTES / 3) * 4;
    return NextResponse.json({ ok: false, code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_STEP_ENCODING', maxStepBytes: MAX_STEP_BYTES }, { status: tooLarge ? 413 : 400 });
  }
  if (!decoded.source.trim()) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'STEP body must be non-empty.' }, { status: 400 });
  }

  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc) {
    return NextResponse.json({ ok: false, code: 'OCCT_UNAVAILABLE', message: loaded.reason ?? 'OCCT load failed.' }, { status: 503 });
  }
  try {
    const result = await analyzeCadReference({
      format,
      source: decoded.source,
      scenarioId,
      lengthUnit,
      ...(declaredSourceTolerance === undefined ? {} : { declaredSourceTolerance }),
    }, createNodeOcctBridge(loaded.oc));
    return NextResponse.json({ ok: true, ...result, quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: 'REFERENCE_ANALYSIS_FAILED',
      message: error instanceof Error ? error.message : String(error),
      quoteOrRfqSideEffects: false,
    }, { status: 422 });
  }
}
