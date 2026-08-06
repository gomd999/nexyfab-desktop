import { NextRequest, NextResponse } from 'next/server';
import { buildWeldmentArtifact, weldmentGate } from '@/lib/ai/design-driver/weldmentGate';
import type { PlanPart, WeldmentSpec } from '@/lib/ai/design-driver/types';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-weldment-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { partId?: string; spec?: WeldmentSpec } | null;
  if (!body?.spec) return NextResponse.json({ ok: false, code: 'INVALID_WELDMENT', message: 'spec is required' }, { status: 400 });
  try {
    const part = weldmentPart(body.partId ?? 'weldment', body.spec);
    const artifact = buildWeldmentArtifact(part);
    const gate = weldmentGate(part, artifact);
    return NextResponse.json({ ok: true, designOk: gate.pass, artifact, gate, sideEffects: { quoteCreated: false, rfqCreated: false } });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'WELDMENT_FAILED', message: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

function weldmentPart(partId: string, weldment: WeldmentSpec): PlanPart {
  const size = Math.max(1, weldment.sizeMm);
  return { partId, name: partId, weldment, bodies: [{ bodyId: 'representative-stock', feature: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }], depth: size, direction: 'one_sided', mode: 'add' } }] };
}
