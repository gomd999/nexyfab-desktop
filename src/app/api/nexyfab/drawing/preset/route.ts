/**
 * GET  /api/nexyfab/drawing/preset  → 분야 파라메트릭 프리셋 템플릿 카탈로그(메타)
 * POST /api/nexyfab/drawing/preset  → { templateId, params } → { intent, scad, verify }
 *
 * 완벽화 Pillar ①: 기계·장비·판금 분야의 **결정론 파라메트릭 프리셋**. AI 없이 파라미터로
 * 형상을 만들어 항상 유효·manifold. 산출은 compose와 동일 형식이라 설계 페이지가 그대로
 * 렌더/검증/내보내기/분야검증한다. mech-presets.mjs를 webpackIgnore 런타임 import.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PresetModule = {
  listTemplates: (domain?: string) => unknown;
  presetWithVerify: (domain: string, templateId: string, params: Record<string, number>) => Promise<unknown>;
};

let _mod: PresetModule | null = null;
async function loadPreset(): Promise<PresetModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'preset-registry.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as PresetModule;
  return _mod;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const domain = new URL(req.url).searchParams.get('domain') ?? 'mech';
    const mod = await loadPreset();
    return NextResponse.json({ ok: true, domain, templates: mod.listTemplates(domain) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-preset:${ip}`, 40, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { domain?: string; templateId?: string; params?: Record<string, number> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.templateId) return NextResponse.json({ ok: false, error: 'templateId가 필요합니다.' }, { status: 400 });

  try {
    const mod = await loadPreset();
    const result = await mod.presetWithVerify(body.domain ?? 'mech', body.templateId, body.params ?? {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'preset failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
