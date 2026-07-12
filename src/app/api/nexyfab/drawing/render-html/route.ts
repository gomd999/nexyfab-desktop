/**
 * POST /api/nexyfab/drawing/render-html
 *
 * 범용 조합 intent(또는 어셈블리) → 자립형 3D 뷰어 HTML(제안서·공유용).
 * 서버에서 openscad-wasm 실렌더 STL을 임베드(webpackIgnore 런타임 import).
 *
 * caller: { intent | assembly, title?, subtitle? } → { ok, html, bytes }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HtmlModule = { renderHtml: (spec: unknown, opts?: { title?: string; subtitle?: string }) => Promise<string> };

let _mod: HtmlModule | null = null;
async function loadHtml(): Promise<HtmlModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'html-render.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as HtmlModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-html:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { intent?: unknown; assembly?: unknown; title?: string; subtitle?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const spec = body.assembly ? { assembly: body.assembly } : body.intent ? { intent: body.intent } : null;
  if (!spec) return NextResponse.json({ ok: false, error: 'intent 또는 assembly가 필요합니다.' }, { status: 400 });

  try {
    const mod = await loadHtml();
    const html = await mod.renderHtml(spec, { title: body.title ?? 'NexyFab 3D', subtitle: body.subtitle ?? '' });
    return NextResponse.json({ ok: true, html, bytes: html.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'HTML render failed: ' + msg.slice(0, 200) }, { status: 502 });
  }
}
