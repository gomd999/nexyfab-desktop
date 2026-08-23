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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

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

  let body: { assembly?: { parts?: unknown[] }; partId?: string; instruction?: string; face?: { face?: string; label?: string; normal?: number[] } };
  try {
    body = await readBoundedJson<typeof body>(req, 800_000);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ ok: false, error: 'assembly 가 너무 큽니다(≤800KB)' }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const { assembly, partId, instruction } = body;
  if (!assembly || !Array.isArray(assembly.parts) || !partId || !instruction?.trim()) {
    return NextResponse.json({ ok: false, error: 'assembly.parts / partId / instruction 필요' }, { status: 400 });
  }
  if (assembly.parts.length > 600) return NextResponse.json({ ok: false, error: '부품 수 초과(≤600)' }, { status: 400 });

  try {
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    // webpackIgnore 필수(관례): 상대 dynamic import 는 webpack 이 엔진을 번들하려다
    // extract.mjs 의 .env URL 해석에서 빌드 실패(260719 배포 FAILED 원인 — 도커 재현으로 확정)
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'edit-part.mjs')).href);
    // 뷰어는 픽 노멀만 보낼 수 있음(P2) — 서버에서 명명 면으로 해석(클라 중복 로직 금지)
    let face = body.face ?? null;
    if (face?.normal && !face.face) {
      const part = (assembly.parts as Array<{ id?: string }>).find((p) => p.id === partId);
      face = part ? mod.faceOfPart(part, face.normal) : null;
    }
    const r = await mod.aiEditPart(assembly, partId, instruction.trim(), { face: face as null });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, gateErrors: r.gateErrors ?? [] }, { status: 422 });
    return NextResponse.json({
      ok: true, assembly: r.assembly, patch: r.patch, note: r.note,
      interferences: r.interferences, floating: r.floating, massKg: r.massKg,
      openscad: r.openscad, parts: r.parts, contacts: r.contacts, composeIntent: r.composeIntent,
      welds: r.welds, weldTotalMm: r.weldTotalMm, structural: r.structural,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'edit-part failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
