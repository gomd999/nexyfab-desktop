/**
 * /api/nexyfab/drawing/edit-part — 선택 부품 단위 수정(픽킹→대상만, 260719).
 *
 * POST { assembly, partId, instruction, face?: {face,label} }
 * → { ok, assembly, patch, note, interferences, floating, massKg } | { ok:false, error, gateErrors? }
 *
 * 계약: AI=지시→패치 이해만(대상 부품 JSON+선택 면+이웃 AABB 만 전달), 적용·게이트=
 * buildAssembly 결정론(대상 외 부품 불변은 코드가 보장). scripts/drawing-to-3d/edit-part.mjs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-edit-part:${ip}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ ok: false, error: 'AI가 일시 중지되어 있습니다.' }, { status: 503 });
  } catch { /* ignore */ }

  let body: { assembly?: { parts?: unknown[] }; partId?: string; instruction?: string; face?: { face?: string; label?: string } };
  try {
    const raw = await req.text();
    if (raw.length > 800_000) return NextResponse.json({ ok: false, error: 'assembly 가 너무 큽니다(≤800KB)' }, { status: 400 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const { assembly, partId, instruction } = body;
  if (!assembly || !Array.isArray(assembly.parts) || !partId || !instruction?.trim()) {
    return NextResponse.json({ ok: false, error: 'assembly.parts / partId / instruction 필요' }, { status: 400 });
  }
  if (assembly.parts.length > 600) return NextResponse.json({ ok: false, error: '부품 수 초과(≤600)' }, { status: 400 });

  try {
    const { aiEditPart } = await import('../../../../../../scripts/drawing-to-3d/edit-part.mjs');
    const r = await aiEditPart(assembly, partId, instruction.trim(), { face: (body.face ?? null) as null });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, gateErrors: r.gateErrors ?? [] }, { status: 422 });
    return NextResponse.json({
      ok: true, assembly: r.assembly, patch: r.patch, note: r.note,
      interferences: r.interferences, floating: r.floating, massKg: r.massKg,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'edit-part failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
