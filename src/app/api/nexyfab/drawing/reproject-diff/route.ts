/**
 * POST /api/nexyfab/drawing/reproject-diff
 *
 * §8-③ 역투영 diff 채점기 v1 — 듀얼-방출 교차검증(방법론 §6.2-③).
 * 같은 intent를 두 커널이 독립 빌드한 결과를 대조해 방출 오류를 탐지한다:
 *   드래프트 = SCAD→WASM 메시(클라이언트가 실측해 보냄)
 *   기록     = OCCT B-rep(여기서 빌드·메시화·실측 — intentToRecordMeasure)
 * 대조: AABB 3축 + 부피. 허용 밴드는 §12.4대로 근거를 명시한다 —
 * 두 방출은 같은 피처셋이므로 기대 차이 = 테셀레이션뿐($fn 다각형 근사 vs OCCT
 * tolerance): 축 max(0.5mm, 0.2%), 부피 1.5%. 이탈 = 방출기 버그 플래그.
 * 한계(정직): v1은 외형 3축+부피 — 치수선 단위 전수 대조(도면 diff)는 후속.
 *
 * caller: { intent, draft: { bbox:{x,y,z}, volume } } →
 *   { ok, verdict, checks:[{name, draft, record, diff, tol, pass}], record, notes }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Measure { bbox: { x: number; y: number; z: number }; volume: number; triangles?: number }
type StepModule = { intentToRecordMeasure: (intent: unknown) => Promise<Measure> };

let _mod: StepModule | null = null;
async function loadStep(): Promise<StepModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'to-step.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as StepModule;
  return _mod;
}

const AXIS_TOL = (v: number) => Math.max(0.5, Math.abs(v) * 0.002); // max(0.5mm, 0.2%)
const VOL_TOL_RATIO = 0.015; // 1.5% — 테셀레이션 차이 상한 근거는 파일 머리 주석

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-reproject-diff:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let intent: unknown, draft: Measure | undefined;
  try {
    const body = (await req.json()) as { intent?: unknown; draft?: Measure };
    intent = body.intent;
    draft = body.draft;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!intent || typeof intent !== 'object') return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  if (!draft?.bbox || typeof draft.volume !== 'number') return NextResponse.json({ ok: false, error: 'draft 실측(bbox·volume)이 필요합니다.' }, { status: 400 });

  // 기록 커널 빌드 + 실측
  let record: Measure;
  try {
    const mod = await loadStep();
    record = await mod.intentToRecordMeasure(intent);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 기록 커널 미지원 형상(unknown kind 등)은 실패가 아니라 정직한 '대조 불가'
    if (/unknown kind/.test(msg)) {
      return NextResponse.json({ ok: false, stage: 'unsupported', error: '기록 커널(OCCT)이 아직 지원하지 않는 피처가 있어 듀얼-방출 대조를 할 수 없습니다: ' + msg.slice(0, 120) }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: 'record build failed: ' + msg.slice(0, 200) }, { status: 502 });
  }

  // 대조 — AABB 3축 + 부피
  const checks: Array<{ name: string; draft: number; record: number; diff: number; tol: number; pass: boolean }> = [];
  for (const [name, key] of [['W (X)', 'x'], ['D (Y)', 'y'], ['H (Z)', 'z']] as Array<[string, 'x' | 'y' | 'z']>) {
    const d = draft.bbox[key], r = record.bbox[key];
    const diff = +Math.abs(d - r).toFixed(3);
    const tol = +AXIS_TOL(r).toFixed(3);
    checks.push({ name, draft: d, record: r, diff, tol, pass: diff <= tol });
  }
  {
    const d = draft.volume, r = record.volume;
    const diff = +Math.abs(d - r).toFixed(1);
    const tol = +(Math.max(r, 1) * VOL_TOL_RATIO).toFixed(1);
    checks.push({ name: 'Volume', draft: d, record: r, diff, tol, pass: diff <= tol });
  }

  const verdict = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
  return NextResponse.json({
    ok: true,
    verdict,
    checks,
    record,
    notes: [
      '듀얼-방출 교차검증(§6.2-③): 드래프트=SCAD→WASM 메시, 기록=OCCT B-rep 메시 — 같은 intent 독립 빌드 대조.',
      '허용 밴드 근거: 동일 피처셋이므로 기대 차이=테셀레이션($fn 근사)뿐 — 축 max(0.5mm, 0.2%) · 부피 1.5%.',
      'v1 범위: 외형 3축+부피. 치수선 단위 전수 도면 diff는 후속.',
    ],
  });
}
