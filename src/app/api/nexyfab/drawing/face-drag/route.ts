/**
 * /api/nexyfab/drawing/face-drag — 면 푸시풀(P2, 260719). AI 없음 — 순수 결정론.
 *
 * POST { assembly, partId, normal:[x,y,z], deltaMm }
 * → { ok, assembly, patch, face, ... 재렌더 payload } | { ok:false, error }
 *
 * 뷰어가 픽 노멀과 드래그량만 보내면 faceOfPart(면 명명)→faceDragPatch(파라미터
 * 결정론 매핑)→applyPartPatch(게이트). 모호 조합=정직 거부(422).
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  // AI 미사용(결정론 빌드만) — 슬롯 미소모, 남용 방지 리밋만
  const rl = rateLimit(`drawing-face-drag:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[] }; partId?: string; normal?: number[]; deltaMm?: number; targetMm?: number };
  try {
    const raw = await req.text();
    if (raw.length > 800_000) return NextResponse.json({ ok: false, error: 'assembly 가 너무 큽니다(≤800KB)' }, { status: 400 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const { assembly, partId, normal, deltaMm, targetMm } = body;
  const hasDelta = Number.isFinite(deltaMm) || Number.isFinite(targetMm);
  if (!assembly || !Array.isArray(assembly.parts) || !partId || !Array.isArray(normal) || normal.length !== 3 || !hasDelta) {
    return NextResponse.json({ ok: false, error: 'assembly.parts / partId / normal[3] / deltaMm|targetMm 필요' }, { status: 400 });
  }
  if (assembly.parts.length > 600) return NextResponse.json({ ok: false, error: '부품 수 초과(≤600)' }, { status: 400 });

  try {
    const mod = await import('../../../../../../scripts/drawing-to-3d/edit-part.mjs');
    const part = (assembly.parts as Array<{ id?: string }>).find((p) => p.id === partId);
    if (!part) return NextResponse.json({ ok: false, error: `부품 '${partId}' 없음` }, { status: 404 });
    const face = mod.faceOfPart(part, normal);
    if (!face) return NextResponse.json({ ok: false, error: '면 명명 불가(사면·미지원 타입 — 정직 거부)' }, { status: 422 });
    // #2 치수 직접 입력: targetMm 지정 시 delta = 목표 − 현재(면 치수)
    let d;
    if (Number.isFinite(targetMm)) {
      const dim = mod.faceDimOf(part, face.face);
      if (!dim) return NextResponse.json({ ok: false, error: '이 면은 치수 직접 입력 미지원(모호 — 정직 거부)', face }, { status: 422 });
      d = Number(targetMm) - dim.value;
      if (Math.abs(d) < 0.001) return NextResponse.json({ ok: false, error: '이미 해당 치수입니다', face }, { status: 422 });
    } else {
      d = Math.max(-5000, Math.min(5000, Number(deltaMm)));
    }
    const fp = mod.faceDragPatch(part, face.face, d);
    if (!fp.ok) return NextResponse.json({ ok: false, error: fp.error, face }, { status: 422 });
    const r = mod.applyPartPatch(assembly, partId, fp.patch);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, gateErrors: r.gateErrors ?? [], face }, { status: 422 });
    return NextResponse.json({
      ok: true, assembly: r.assembly, patch: fp.patch, face,
      interferences: r.interferences, floating: r.floating, massKg: r.massKg,
      openscad: r.openscad, parts: r.parts, contacts: r.contacts, composeIntent: r.composeIntent,
      welds: r.welds, weldTotalMm: r.weldTotalMm, structural: r.structural,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'face-drag failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
