import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { recoverIfcGeometryWithAuthoritativeInputs, type IfcAuthoritativeGeometryInput } from '@/lib/reference/ifcAuthoritativeGeometryRecovery';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { MAX_INLINE_IFC_BYTES, MAX_SINGLE_IFC_JSON_BYTES } from '../bodyLimits';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const MAX_INPUTS = 1_000;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-ifc-recover-geometry:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson(req, MAX_SINGLE_IFC_JSON_BYTES); }
  catch (error) {
    const boundary = boundedJsonError(error);
    return NextResponse.json({ ok: false, code: boundary?.code ?? 'BAD_REQUEST' }, { status: boundary?.status ?? 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['ifc', 'authoritativeInputs'].includes(key))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const value = body as { ifc?: unknown; authoritativeInputs?: unknown };
  if (typeof value.ifc !== 'string' || !value.ifc.trim() || !Array.isArray(value.authoritativeInputs) || value.authoritativeInputs.length > MAX_INPUTS || value.authoritativeInputs.some(input => !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['globalId', 'physicalWidthMm', 'provenance'].includes(key)))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  if (Buffer.byteLength(value.ifc, 'utf8') > MAX_INLINE_IFC_BYTES) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxIfcBytes: MAX_INLINE_IFC_BYTES }, { status: 413 });
  try {
    const result = recoverIfcGeometryWithAuthoritativeInputs(value.ifc, value.authoritativeInputs as IfcAuthoritativeGeometryInput[]);
    return NextResponse.json({
      ...result,
      recoveryPassed: result.ok,
      // Authoritative inputs supplied in this request are provenance, not independent release authorization.
      releaseReady: false,
      releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, releaseReady: false, code: 'IFC_GEOMETRY_RECOVERY_FAILED', message: error instanceof Error ? error.message : String(error), sourceReturned: false, quoteOrRfqSideEffects: false }, { status: 422 });
  }
}
