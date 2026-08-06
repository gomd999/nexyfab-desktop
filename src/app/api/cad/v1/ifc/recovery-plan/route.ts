import { NextRequest, NextResponse } from 'next/server'; import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimit } from '@/lib/rate-limit'; import { buildIfcGeometryRecoveryRequests } from '@/lib/reference/ifcGeometryRecoveryRequests';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'; const MAX = 20 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!rateLimit(`cad-v1-ifc-recovery-plan:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as unknown; if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'ifc') || typeof (body as {ifc?:unknown}).ifc !== 'string') return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'One inline IFC document is required; paths and URLs are forbidden.' }, { status: 400 });
  const source = (body as {ifc:string}).ifc; if (!source.trim()) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 }); if (Buffer.byteLength(source, 'utf8') > MAX) return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', maxIfcBytes: MAX }, { status: 413 });
  try { const report = buildIfcGeometryRecoveryRequests(source); return NextResponse.json({ ok: true, ...report, sourceReturned: false, quoteOrRfqSideEffects: false }); }
  catch (error) { return NextResponse.json({ ok: false, code: 'IFC_RECOVERY_PLAN_FAILED', message: error instanceof Error ? error.message : String(error), quoteOrRfqSideEffects: false }, { status: 422 }); }
}
