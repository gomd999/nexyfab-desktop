/**
 * POST /api/nexyfab/drawing/dwg-convert — DWG(바이너리) → ASCII DXF + 씨앗 + 2D 판독 검증 (260718, 2D-gate 260722).
 *
 * GNU LibreDWG(WASM)로 DWG 를 파싱해 결정론 DXF 재작성 — 하류는 기존 DXF 경로
 * (dxf-seed 씨앗·수치지형 등고 인입·클라이언트 2D 압출)를 그대로 재사용한다.
 * 정직: 파싱 실패(미지원 신형식·손상)는 오류+변환 안내로 반환, 근사(스플라인
 * 폴리라인화·테셀레이션)와 건너뛴 엔티티(3DSOLID/HATCH 등)는 stats 로 전부 보고.
 *
 * 2D 판독 검증(reconstruction2dGate): 3D bbox/genus 게이트는 2D 도면에 무의미 —
 * 대신 도면 자신의 2D 증거(치수값·원 반지름·엔티티 수·범위·레이어)를 우리가 파싱한
 * 모델을 재방출(round-trip)해 대조한다. 통과 = 우리가 도면을 충실히 "읽었다"는 증명.
 * 증거 없음(치수·원·범위 전무)은 unavailable(가짜 통과 금지). 근사·미재현 엔티티는 전부 표면화.
 *
 * body: { dwgBase64: string(≤60MB 디코드) , name? } →
 *   { ok, dxfText, seed{...}, ir2d, reconstruction2dGate{status,score,checks,feedback}, stats }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { readDwgToDxf, type DwgConvertStats } from '@/lib/brep-bridge/dwgImport';
import { dxfToIr2d, roundTripVerify2d } from '@/lib/cad-ir/ingestDxf2d';
import { recordUsageEvent } from '@/lib/plan-guard';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 86 * 1024 * 1024;

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

/** Fold the converter's approximation/skip stats into a flat, human-readable list (nothing hidden). */
function statsToApproximations(stats: DwgConvertStats | undefined): string[] {
  const out: string[] = [];
  if (!stats) return out;
  if (stats.approximatedSplines > 0) out.push(`${stats.approximatedSplines} SPLINE approximated as polyline`);
  if (stats.tessellated > 0) out.push(`${stats.tessellated} entity(ies) tessellated (arc/ellipse -> segments)`);
  if (stats.blockInserts > 0) out.push(`${stats.blockInserts} INSERT block(s) expanded inline`);
  for (const [t, n] of Object.entries(stats.skipped ?? {})) if (n > 0) out.push(`${n} ${t} entity(ies) skipped (unsupported)`);
  if (stats.truncated) out.push('entity budget exceeded — output truncated (some geometry dropped)');
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-dwg-convert:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { dwgBase64?: string };
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'DWG 요청 본문이 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
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

  // ── 2D 판독 검증: 소스 Ir2d 구성 → 라운드트립 재방출·재추출·게이트 ──
  let ir2d: Awaited<ReturnType<typeof dxfToIr2d>>['ir2d'] = null;
  let reconstruction2dGate: Awaited<ReturnType<typeof roundTripVerify2d>> | null = null;
  try {
    const parsed = await dxfToIr2d(r.dxfText!, statsToApproximations(r.stats));
    if (parsed.ok && parsed.ir2d) {
      ir2d = parsed.ir2d;
      reconstruction2dGate = await roundTripVerify2d(parsed.ir2d);
    }
  } catch {
    // 게이트 실패는 변환 자체를 막지 않는다 — dxfText/seed 는 반환. 게이트는 null(가짜 통과 금지).
    reconstruction2dGate = null;
  }

  // 측정(best-effort, 요청 차단 금지): 2D 판독 게이트 판정을 기록해 실물 업로드
  // 전반의 통과율을 사후 질의 가능하게 남긴다.
  try {
    recordUsageEvent('anon', 'cad_reconstruction_gate', {
      route: 'dwg-convert',
      status: reconstruction2dGate?.status ?? 'unavailable',
    });
  } catch { /* never block on measurement */ }

  return NextResponse.json({ ok: true, dxfText: r.dxfText, seed, ir2d, reconstruction2dGate, stats: r.stats });
}
