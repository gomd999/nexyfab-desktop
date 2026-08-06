import { NextRequest, NextResponse } from 'next/server';
import { POST as legacyPost } from '@/app/api/nexyfab/cad-feature-step/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** JSON/Base64 wrapper around the existing analytic OCCT STEP exporter. */
export async function POST(req: NextRequest) {
  const response = await legacyPost(req);
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/step')) return response;
  const bytes = Buffer.from(await response.arrayBuffer());
  return NextResponse.json({
    ok: true,
    step: bytes.toString('base64'),
    encoding: 'base64',
    artifactId: response.headers.get('x-artifact-id'),
    manufacturingGates: response.headers.get('x-manufacturing-gates'),
    skipped: response.headers.get('x-skipped'),
    clamped: response.headers.get('x-clamped'),
  });
}
