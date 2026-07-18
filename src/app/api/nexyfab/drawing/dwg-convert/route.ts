/**
 * POST /api/nexyfab/drawing/dwg-convert — DWG(바이너리) → ASCII DXF + 씨앗 (260718).
 *
 * GNU LibreDWG(WASM)로 DWG 를 파싱해 결정론 DXF 재작성 — 하류는 기존 DXF 경로
 * (dxf-seed 씨앗·수치지형 등고 인입·클라이언트 2D 압출)를 그대로 재사용한다.
 * 정직: 파싱 실패(미지원 신형식·손상)는 오류+변환 안내로 반환, 근사(스플라인
 * 폴리라인화·테셀레이션)와 건너뛴 엔티티(3DSOLID/HATCH 등)는 stats 로 전부 보고.
 *
 * body: { dwgBase64: string(≤60MB 디코드) , name? } →
 *   { ok, dxfText, seed{measurements,dimTexts,circles,extents,entityCounts}, stats }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { readDwgToDxf } from '@/lib/brep-bridge/dwgImport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Seed { measurements: number[]; dimTexts: string[]; circles: Array<{ r: number; cx: number; cy: number }>; extents: { w: number; h: number } | null; entityCounts: Record<string, number> }
type DxfSeedMod = { extractDxfSeed: (text: string) => Seed };
let _seedMod: DxfSeedMod | null = null;
async function loadSeed(): Promise<DxfSeedMod> {
  if (_seedMod) return _seedMod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'dxf-seed.mjs');
  _seedMod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as DxfSeedMod;
  return _seedMod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-dwg-convert:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { dwgBase64?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const b64 = typeof body.dwgBase64 === 'string' ? body.dwgBase64 : '';
  if (!b64) return NextResponse.json({ ok: false, error: 'dwgBase64 가 필요합니다.' }, { status: 400 });
  if (b64.length > 84_000_000) return NextResponse.json({ ok: false, error: 'DWG 60MB 초과(웹 업로드 예산) — 외부 참조 분리 또는 DXF 로 저장 후 업로드하세요.' }, { status: 400 });
  const buf = Buffer.from(b64, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const r = await readDwgToDxf(ab);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 200 });

  let seed: Seed | null = null;
  try {
    seed = (await loadSeed()).extractDxfSeed(r.dxfText!);
  } catch {
    seed = null; // 씨앗 추출 실패해도 DXF 변환 자체는 유효 — dxfText 는 반환
  }
  return NextResponse.json({ ok: true, dxfText: r.dxfText, seed, stats: r.stats });
}
