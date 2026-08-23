import { NextRequest, NextResponse } from 'next/server';
import { validateGdt, type GdtCallout } from '@/lib/drawing/dimension';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 1024 * 1024;

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  let body: { callouts?: GdtCallout[]; validTopologyRefs?: string[] } | null;
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    body = null;
  }
  if (!Array.isArray(body?.callouts) || !Array.isArray(body.validTopologyRefs)) return NextResponse.json({ ok: false, code: 'INVALID_PMI_INPUT' }, { status: 400 });
  const refs = new Set(body.validTopologyRefs);
  const verified: GdtCallout[] = [];
  const review: Array<{ id: string; reason: string }> = [];
  for (const callout of body.callouts) {
    try {
      validateGdt(callout);
      if (!refs.has(callout.targetRef)) review.push({ id: callout.id, reason: `targetRef '${callout.targetRef}' is unresolved` });
      else verified.push(callout);
    } catch (error) { review.push({ id: callout.id || '(missing)', reason: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ ok: true, verified, review, designOk: review.length === 0 && verified.length > 0 });
}
