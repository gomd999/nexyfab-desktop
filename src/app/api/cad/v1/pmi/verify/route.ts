import { NextRequest, NextResponse } from 'next/server';
import { validateGdt, type GdtCallout } from '@/lib/drawing/dimension';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { callouts?: GdtCallout[]; validTopologyRefs?: string[] } | null;
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
