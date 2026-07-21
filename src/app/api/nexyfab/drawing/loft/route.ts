/**
 * POST /api/nexyfab/drawing/loft
 *
 * ⓒ 로프트 저작 — 프로파일+스테이션 스펙 → 매끈한 곡면 mesh 부품(박스 아님).
 * 로프트 스튜디오 패널이 스펙을 보내면 mesh 부품 + 단일-부품 어셈블리를 돌려준다
 * (AssemblyViewer3D 라이브 미리보기용). 잘못된 스펙은 지어내지 않고 사유 반환(정직).
 * caller: { id?, profile:{type,...}, stations:[{at:[x,y,z],scale,rot}], axis?, material?, role? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type LoftPart = { id: string; type: string; material: string; role: string; at: Record<string, number>; params: { volumeMm3: number; triCount: number; aabb: { min: number[]; max: number[] }; verts: number[][]; faces: number[][] } };
type LoftAssembly = { name: string; domain: string; kind: string; parts: LoftPart[] };
type LoftMod = { loftPartFromSpec: (spec: unknown) => LoftPart; assemblyFromSpec: (spec: unknown) => LoftAssembly };

let _loft: LoftMod | null = null;
async function load(): Promise<LoftMod> {
  if (!_loft) _loft = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'loft.mjs')).href)) as LoftMod;
  return _loft;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-loft:${ip}`, 40, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let spec: unknown;
  try { spec = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  let mod: LoftMod;
  try { mod = await load(); } catch (e) { return NextResponse.json({ ok: false, error: 'loft 모듈 로드 실패: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 }); }

  try {
    // 단일 바디(loft/sweep)든 다중 바디({bodies:[...]}/배열)든 assemblyFromSpec 가 처리.
    const assembly = mod.assemblyFromSpec(spec);
    const volumeMm3 = assembly.parts.reduce((s, p) => s + (p.params.volumeMm3 || 0), 0);
    const triCount = assembly.parts.reduce((s, p) => s + (p.params.triCount || 0), 0);
    return NextResponse.json({
      ok: true,
      assembly,
      part: assembly.parts[0], // 하위호환(단일 바디 소비자)
      parts: assembly.parts.length,
      volumeMm3,
      triCount,
    });
  } catch (e) {
    // 정직: 잘못된 스펙(프로파일 미지·점개수 불일치·스테이션<2 등)은 사유를 그대로 되돌린다.
    return NextResponse.json({ ok: false, stage: 'spec', error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
