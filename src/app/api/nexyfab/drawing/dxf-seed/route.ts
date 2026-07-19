/**
 * POST /api/nexyfab/drawing/dxf-seed — 입구 A Phase 2 (방법론 §9, 2026-07-16).
 *
 * DXF(ASCII)에서 치수·원·전체 범위를 "씨앗"으로만 추출한다(결정론 파서, AI 미사용).
 * 정직 원칙: 완전 자동 DWG→3D를 주장하지 않는다 — 씨앗은 사람 검증 전제로
 * 프롬프트에 프리필되고, 형상 생성은 기존 체크포인트 경로를 그대로 탄다.
 *
 * caller: { dxfText } → { ok, seed: { measurements, dimTexts, circles, extents, entityCounts } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Seed { measurements: number[]; dims?: Array<{ value: number; kind: string; text?: string }>; dimTexts: string[]; circles: Array<{ r: number; cx: number; cy: number }>; extents: { w: number; h: number } | null; entityCounts: Record<string, number> }
type Reconciled = { intent: Record<string, unknown>; measured: unknown[]; unverified: string[]; coverage: number; note: string };
type DxfModule = { extractDxfSeed: (text: string) => Seed; reconcileIntentWithDxf: (intent: Record<string, unknown>, seed: Seed, o?: { tolPct?: number }) => Reconciled };

let _mod: DxfModule | null = null;
async function load(): Promise<DxfModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'dxf-seed.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as DxfModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-dxf-seed:${ip}`, 12, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let dxfText: string;
  let intent: Record<string, unknown> | null = null;
  try {
    const body = (await req.json()) as { dxfText?: string; intent?: Record<string, unknown> };
    dxfText = String(body.dxfText ?? '');
    if (body.intent && typeof body.intent === 'object') intent = body.intent;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (dxfText.length < 20) return NextResponse.json({ ok: false, error: 'DXF 내용이 필요합니다.' }, { status: 400 });
  if (dxfText.length > 4_000_000) return NextResponse.json({ ok: false, error: 'DXF가 너무 큽니다(4MB 이하 ASCII).' }, { status: 413 });
  if (!/\bENTITIES\b/.test(dxfText)) {
    return NextResponse.json({ ok: false, error: 'ENTITIES 섹션이 없습니다 — 바이너리 DXF/DWG는 지원하지 않아요. ASCII DXF(R12 이상)로 저장해 주세요.' }, { status: 200 });
  }

  try {
    const mod = await load();
    const seed = mod.extractDxfSeed(dxfText);
    if (!seed.measurements.length && !seed.circles.length && !seed.extents) {
      return NextResponse.json({ ok: false, error: '치수·원·범위를 찾지 못했어요. 치수(DIMENSION)가 들어있는 도면인지 확인해 주세요.' }, { status: 200 });
    }
    // T3(260719): intent 동봉 시 DIMENSION 실측값 정합 — 추론→판독 격상(교체 이력 전부 보고)
    const reconciled = intent ? mod.reconcileIntentWithDxf(intent, seed) : undefined;
    return NextResponse.json({ ok: true, seed, ...(reconciled ? { reconciled } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'DXF 파싱 실패: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  }
}
