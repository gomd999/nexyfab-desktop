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
  listAssemblyPresets: (domain?: string, lang?: string) => Promise<unknown>;
  assemblyPresetWithBuild: (domain: string, templateId: string, params: Record<string, number>) => Promise<unknown>;
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
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain') ?? 'mech';
    const mod = await loadPreset();
    // kind=assembly → 도메인 어셈블리 템플릿 카탈로그 (#6: 건축 RC·조경 파고라/데크·인테리어)
    if (url.searchParams.get('kind') === 'assembly') {
      // ?lang= 을 주면 제목·파라미터 라벨을 그 언어로 내보낸다(260801).
      // 안 주면 예전 그대로 — 기존 호출자를 깨지 않는다.
      return NextResponse.json({
        ok: true, kind: 'assembly',
        templates: await mod.listAssemblyPresets(
          url.searchParams.get('domain') ?? undefined,
          url.searchParams.get('lang') ?? undefined,
        ),
      });
    }
    return NextResponse.json({ ok: true, domain, templates: mod.listTemplates(domain) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-preset:${ip}`, 40, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { domain?: string; templateId?: string; params?: Record<string, number>; kind?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.templateId) return NextResponse.json({ ok: false, error: 'templateId가 필요합니다.' }, { status: 400 });

  try {
    const mod = await loadPreset();
    // kind=assembly → 어셈블리 빌드(게이트·간섭·구조·composeIntent) — 설계 패키지 라우트에 바로 연결 가능
    const result = body.kind === 'assembly'
      ? await mod.assemblyPresetWithBuild(body.domain ?? 'building', body.templateId, body.params ?? {})
      : await mod.presetWithVerify(body.domain ?? 'mech', body.templateId, body.params ?? {});
    // P2 픽킹 뷰어용: 파트별 AABB 동봉 (결정론 — reconstruct.partAabb)
    const asm = (result as { assembly?: { parts?: Array<Record<string, unknown>> } }).assembly;
    if (asm?.parts?.length) {
      try {
        const rp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'reconstruct.mjs');
        const rmod = (await import(/* webpackIgnore: true */ pathToFileURL(rp).href)) as {
          partAabb: (i: Record<string, unknown>) => { min: number[]; max: number[] };
        };
        for (const p of asm.parts) {
          try {
            p.aabb = rmod.partAabb({ type: p.type, ...(p.params as Record<string, unknown>) });
          } catch { /* 매핑 불가 타입은 aabb 생략(정직) */ }
        }
      } catch { /* aabb 동봉 실패는 비치명 — 뷰어가 생략 처리 */ }
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'preset failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
