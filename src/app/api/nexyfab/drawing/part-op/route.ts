/**
 * /api/nexyfab/drawing/part-op — 부품 일괄 연산(#5/#7, 260719). AI 없음 — 순수 결정론.
 *
 * POST { assembly, op: 'delete'|'duplicate'|'translate'|'fillet', partIds: string[], opts? }
 * → { ok, assembly, ... 재렌더 payload } | { ok:false, error }
 * fillet 은 part.filletMm 지정 — STEP(B-rep)에만 반영(표시 뷰어=무필렛 명시).
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-part-op:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[] }; op?: string; partIds?: string[]; opts?: Record<string, unknown> };
  try {
    body = await readBoundedJson<typeof body>(req, 800_000);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ ok: false, error: 'assembly 가 너무 큽니다(≤800KB)' }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const { assembly, op, partIds } = body;
  if (!assembly || !Array.isArray(assembly.parts) || !op || !Array.isArray(partIds) || !partIds.length) {
    return NextResponse.json({ ok: false, error: 'assembly.parts / op / partIds[] 필요' }, { status: 400 });
  }
  if (assembly.parts.length > 600 || partIds.length > 100) return NextResponse.json({ ok: false, error: '규모 초과' }, { status: 400 });

  try {
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'edit-part.mjs')).href);
    const r = mod.partOps(assembly, op, partIds, body.opts ?? {});
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, gateErrors: r.gateErrors ?? [] }, { status: 422 });
    return NextResponse.json({
      ok: true, assembly: r.assembly, note: r.note,
      interferences: r.interferences, floating: r.floating, massKg: r.massKg,
      openscad: r.openscad, parts: r.parts, contacts: r.contacts, composeIntent: r.composeIntent,
      welds: r.welds, weldTotalMm: r.weldTotalMm, structural: r.structural,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'part-op failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
