// Admin: record real quotes (the calibration flywheel for the cost model) and
// list recent ones. Each recorded quote nudges getCalibrationFactor for its
// (process, material, region) bucket toward reality. Auth: super-admin session.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { recordQuote, listQuotes, getCalibrationFactor } from '@/lib/quoteHistory';
import crypto from 'crypto';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const quotes = await listQuotes(50);
  return NextResponse.json({ quotes });
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let b: {
    process?: string; material?: string; region?: string; quantity?: number;
    estimatedKrw?: number; actualKrw?: number;
  } | null;
  try { b = await readBoundedJson(req, 64 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    b = null;
  }
  if (!b?.process || !b?.actualKrw || b.actualKrw <= 0) {
    return NextResponse.json({ error: 'process and actualKrw required' }, { status: 400 });
  }
  const process = b.process;
  const material = b.material || 'unspecified';
  const region = b.region === 'cn' ? 'cn' : 'kr';
  await recordQuote({
    id: crypto.randomUUID(),
    process, material, region,
    quantity: b.quantity ?? null,
    estimatedKrw: b.estimatedKrw ?? null,
    actualKrw: b.actualKrw,
  });
  const factor = await getCalibrationFactor(process, material, region);
  return NextResponse.json({ ok: true, factor });
}
