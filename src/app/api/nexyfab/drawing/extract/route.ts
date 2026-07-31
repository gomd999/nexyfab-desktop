/**
 * POST /api/nexyfab/drawing/extract
 *
 * 이미지(도면·스케치) → 3D — 입력 A 경로. Gemini Vision 으로 정투상 도면을 읽어
 * 구조화 intent 로 추출(extract.mjs) → 결정론 게이트(reconstruct/assembly) 통과 시
 * 단일부품 어셈블리로 빌드해 composeIntent+SCAD 반환(체크포인트). 정밀 STEP 은 사용자
 * 승인 후 export-step 이 담당(텍스트 compose 와 동일한 후속 흐름).
 *
 * 원칙: AI 는 "도면 이해"만. 형상·검증은 결정론. confidence 낮거나 판별 불가면
 * 허위 형상 대신 정직하게 ok:false 로 되돌려 사용자에게 텍스트 확인을 요청한다.
 *
 * caller: { imageBase64, mimeType, note? } → { ok, recognized, intent, scad, spec } | { ok:false, ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type FlatIntent = { type?: string; confidence?: number; unit?: string; holes?: Array<{ x: number; y: number; d: number }> } & Record<string, unknown>;
type ReprojectReport = { verdict?: string; askBack?: string; support?: number; scaleResidualPct?: number; reasons?: string[] };
type ExtractModule = { extractDrawingFromImage: (b64: string, mime: string, o?: { model?: string }) => Promise<{ intent: FlatIntent; model?: string; reproject?: ReprojectReport }> };
type ReconstructModule = { PARAMS: Record<string, string[]> };
type BuiltAssembly = { ok: boolean; openscad?: string; gateErrors?: string[]; composeIntent?: { name?: string; features?: unknown[] } };
type AssemblyModule = { buildAssembly: (asm: unknown) => BuiltAssembly };

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIN_CONFIDENCE = 0.4;

let _ex: ExtractModule | null = null;
let _rc: ReconstructModule | null = null;
let _asm: AssemblyModule | null = null;
async function load(): Promise<{ ex: ExtractModule; rc: ReconstructModule; asm: AssemblyModule }> {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_ex) _ex = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'extract.mjs')).href)) as ExtractModule;
  if (!_rc) _rc = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'reconstruct.mjs')).href)) as ReconstructModule;
  if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'assembly.mjs')).href)) as AssemblyModule;
  return { ex: _ex, rc: _rc, asm: _asm };
}

// 사람이 읽을 인식 요약(체크포인트 상단). 순수 숫자/타입만.
const TYPE_LABEL: Record<string, string> = {
  plate_with_holes: '타공 평판', stepped_plate: '단차 평판', l_bracket: 'L 브래킷', flange: '플랜지', bent_sheet: 'U채널 절곡판',
  tube: '원형 파이프', rect_tube: '각관', box: '직육면체 블록', cylinder: '원기둥 봉', gusset: '거셋 보강판', base_plate: '베이스판',
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-extract:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  // 구독 정합(2026-07-16): 로그인=shape_chat 슬롯+예산, 익명=합산 리밋(게스트 데모 유지)
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  // 전역 비용 브레이커 — Vision 호출도 AI 일시정지에 복종(계열 일관, 감사 2026-07-16)
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ ok: false, error: 'AI가 일시 중지되어 있습니다. 잠시 후 다시 시도하세요.' }, { status: 503 });
  } catch { /* 브레이커 조회 실패는 무시하고 진행 */ }

  let imageBase64: string, mimeType: string, dxfText = '';
  try {
    const body = (await req.json()) as { imageBase64?: string; mimeType?: string; dxfText?: string };
    imageBase64 = (body.imageBase64 ?? '').replace(/^data:[^,]+,/, '').trim(); // data: 접두 있으면 제거
    mimeType = (body.mimeType ?? 'image/png').toLowerCase();
    // P1-b(260719b): 같은 부품의 벡터 도면(DXF) 동봉 시 T3 실측값 직사용 — 비전 추론→판독 격상
    if (typeof body.dxfText === 'string' && body.dxfText.length >= 20 && body.dxfText.length <= 4_000_000) dxfText = body.dxfText;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!imageBase64 || imageBase64.length < 100) {
    return NextResponse.json({ ok: false, error: '이미지가 필요합니다.' }, { status: 400 });
  }
  if (imageBase64.length > 8_000_000) { // ~6MB 원본
    return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(6MB 이하로 올려주세요).' }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ ok: false, error: 'PNG·JPG·WebP 이미지만 지원합니다.' }, { status: 415 });
  }

  let mods: { ex: ExtractModule; rc: ReconstructModule; asm: AssemblyModule };
  try {
    mods = await load();
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  // ① Vision 추출 (AI = 이해) + D1 역투영 diff(추출 실루엣↔원본 잉크 — 강등·되묻기)
  let flat: FlatIntent;
  let reproject: ReprojectReport | undefined;
  try {
    const r = await mods.ex.extractDrawingFromImage(imageBase64, mimeType);
    flat = r.intent ?? {};
    reproject = r.reproject;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /GEMINI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: '도면 판독 실패: ' + msg.slice(0, 160) }, { status });
  }

  const type = String(flat.type ?? 'unknown');
  const confidence = typeof flat.confidence === 'number' ? flat.confidence : 0;

  // P1-b(260719b): DXF 동봉 시 T3 reconcile — 비전 수치를 DIMENSION 실측값으로 교체(이력 보고)
  let reconcile: { measuredCount: number; unverified: string[]; coverage: number } | undefined;
  if (dxfText) {
    try {
      const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
      const dx = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'dxf-seed.mjs')).href)) as {
        extractDxfSeed: (t: string) => unknown;
        reconcileIntentWithDxf: (i: Record<string, unknown>, s: unknown) => { intent: Record<string, unknown>; measured: unknown[]; unverified: string[]; coverage: number };
      };
      const seed = dx.extractDxfSeed(dxfText);
      const r = dx.reconcileIntentWithDxf(flat as Record<string, unknown>, seed);
      flat = { ...flat, ...r.intent } as FlatIntent; // 실측 교체본으로 진행(출처·이력=reconcile 필드)
      reconcile = { measuredCount: r.measured.length, unverified: r.unverified, coverage: r.coverage };
    } catch { /* DXF 정합 실패=비전 값 유지(정직 — reconcile 필드 없음) */ }
  }
  /**
   * ★260731 — **불확실성이 응답에 실리지 않고 있었다.**
   *
   * 추출기는 못 읽은 치수(`missingFields`)와 추정한 치수(`estimatedFields`)를 이미
   * 구별해 내보낸다. 그런데 여기서 `confidence` 숫자만 옮기고 **어느 치수인지는 버렸다.**
   * 사용자는 「신뢰도 60%」만 보고 **무엇을 확인해야 하는지** 알 수 없었다.
   *
   * 실측(260731): `l_bracket` 두께(정답 4mm, 치수선 9.6px)가 10 으로 나가는데, 모델은
   * 그것을 「추정」이라고 스스로 표시한다 — 그 표시가 여기서 사라지고 있었다.
   * ⚠ 값을 막지 않는다(0.6 은 MIN_CONFIDENCE 0.4 를 넘는다). **어느 값이 추정인지 알린다.**
   */
  const uncertainty = {
    ...(Array.isArray(flat.missingFields) && flat.missingFields.length
      ? { missingFields: flat.missingFields as string[], missingNote: String(flat.missingNote ?? '') } : {}),
    ...(Array.isArray(flat.estimatedFields) && flat.estimatedFields.length
      ? { estimatedFields: flat.estimatedFields as string[], estimatedNote: String(flat.estimatedNote ?? '') } : {}),
  };
  const recognized = { type, label: TYPE_LABEL[type] ?? type, confidence: +confidence.toFixed(2), unit: String(flat.unit ?? 'mm'), ...uncertainty, ...(reproject?.verdict && reproject.verdict !== 'SKIPPED' ? { reproject: { verdict: reproject.verdict, support: reproject.support, scaleResidualPct: reproject.scaleResidualPct } } : {}), ...(reconcile ? { reconcile } : {}) };

  // 판별 불가 / 저신뢰 → 허위 형상 방출 대신 정직하게 텍스트 확인 요청.
  if (type === 'unknown' || !mods.rc.PARAMS[type]) {
    return NextResponse.json({ ok: false, stage: 'recognize', recognized, error: '도면 유형을 확정하지 못했어요. 지원 어휘(평판·브래킷·플랜지·파이프·각관·봉·거셋·베이스판 등) 도면이면 더 선명한 정투상으로, 아니면 치수를 텍스트로 알려주세요.' }, { status: 200 });
  }
  // D1 역투영 DEMOTE = 수치 신뢰도와 무관하게 되묻기(자신있게 틀린 판독이 D1 의 표적)
  if (reproject?.verdict === 'DEMOTE') {
    return NextResponse.json({ ok: false, stage: 'confidence', recognized, error: reproject.askBack ?? '추출 형상이 도면과 어긋납니다 — 주요 치수를 확인해 주세요.' }, { status: 200 });
  }
  if (confidence < MIN_CONFIDENCE) {
    return NextResponse.json({ ok: false, stage: 'confidence', recognized, error: `판독 신뢰도가 낮아요(${Math.round(confidence * 100)}%). 치수선이 선명한 정투상 도면을 올리거나, 핵심 치수를 텍스트로 확인해 주세요.` }, { status: 200 });
  }

  // ② 추출 intent → 단일부품 어셈블리 → 결정론 빌드(게이트+composeIntent)
  const params: Record<string, unknown> = {};
  for (const k of mods.rc.PARAMS[type]) if (typeof flat[k] === 'number') params[k] = flat[k];
  if (type === 'plate_with_holes' && Array.isArray(flat.holes)) {
    params.holes = flat.holes.filter((h) => h && typeof h.x === 'number' && typeof h.y === 'number' && typeof h.d === 'number');
  }
  const assembly = { name: `${type}-from-drawing`, parts: [{ id: 'part1', type, params, at: { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 } }] };

  let built: BuiltAssembly;
  try {
    built = mods.asm.buildAssembly(assembly);
  } catch (e) {
    return NextResponse.json({ ok: false, stage: 'build', recognized, error: 'build failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  }
  if (!built.ok) {
    return NextResponse.json({ ok: false, stage: 'gate', recognized, gateErrors: built.gateErrors ?? [], error: '판독 치수가 결정론 게이트를 통과하지 못했어요(치수 모순). 치수를 텍스트로 확인해 주세요.' }, { status: 200 });
  }

  // 사람이 검토할 사양 라인(치수 목록) — extract 원문 치수 그대로.
  const spec = mods.rc.PARAMS[type]
    .filter((k) => typeof flat[k] === 'number')
    .map((k) => `${k}: ${flat[k]} ${recognized.unit}`);
  if (type === 'plate_with_holes' && Array.isArray(params.holes)) spec.push(`holes ×${(params.holes as unknown[]).length}`);

  return NextResponse.json({
    ok: true,
    recognized,
    intent: built.composeIntent, // export-step 입력(features 기반)
    scad: built.openscad,
    spec,
  });
}
