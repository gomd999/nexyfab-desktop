/**
 * /api/nexyfab/drawing/research — 관련 연구(논문) 참고 레이어 (⑥).
 *
 * POST { assembly?, domain?, format? } → 결정론 검색어 → OpenAlex+Crossref 실조회 →
 * 반환 서지만 정규화(AI 생성 인용 없음 — 날조 원천 차단) + format=html 시 부록 HTML.
 * 특허(침해·회피)는 KIPRIS 등 특허 공식 API 확보 후 동일 파이프에 추가 — 본 라우트는 논문만.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type Mod = {
  researchForDesign: (assembly: unknown, o?: Record<string, unknown>) => Promise<{ ok: boolean; total: number }>;
  researchReport: (r: unknown, o?: Record<string, unknown>) => string;
};

let _mod: Mod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'research.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-research:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[]; name?: string }; domain?: string; format?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  try {
    const mod = await load();
    const result = await mod.researchForDesign(body.assembly ?? {}, { domain: body.domain ?? null });
    if (body.format === 'html') {
      return NextResponse.json({ result, html: mod.researchReport(result, { title: body.assembly?.name ?? '설계' }) });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'research failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
