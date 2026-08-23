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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// A 256 KiB canonical intent can expand when embedded and JSON-escaped.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Profile { axis: string; w1: number[]; w2: number[] }
interface DimRow { label: string; declared: number; measured: number | null; pos: string; pass: boolean }
interface DimAudit { rows: DimRow[]; declaredCount: number; measuredCount: number; extraFaces: number; note: string }
interface FuseReport { total: number; fused: number; jittered: number; dropped: { kind: string; at: number[] | null; op: string }[] }
interface Measure { bbox: { x: number; y: number; z: number }; volume: number; triangles?: number; profiles?: Profile[]; dims?: DimAudit | null; lumps?: number; fuseReport?: FuseReport }
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
    const body = await readBoundedJson<{ intent?: unknown; draft?: Measure }>(req, MAX_BODY_BYTES);
    intent = body.intent;
    draft = body.draft;
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'intent가 너무 큽니다(피처 200개·256KB 이하).' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!intent || typeof intent !== 'object') return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  if (!draft?.bbox || typeof draft.volume !== 'number') return NextResponse.json({ ok: false, error: 'draft 실측(bbox·volume)이 필요합니다.' }, { status: 400 });
  // 바디 상한 — 거대 intent로 무거운 OCCT 빌드 유발 방지(감사 2026-07-16)
  const featureCount = Array.isArray((intent as { features?: unknown[] }).features) ? (intent as { features: unknown[] }).features.length : 0;
  if (featureCount > 200 || JSON.stringify(intent).length > 262_144) {
    return NextResponse.json({ ok: false, error: 'intent가 너무 큽니다(피처 200개·256KB 이하).' }, { status: 413 });
  }
  for (const k of ['x', 'y', 'z'] as const) {
    if (!Number.isFinite(draft.bbox[k])) return NextResponse.json({ ok: false, error: 'draft.bbox 값이 유효하지 않습니다.' }, { status: 400 });
  }

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

  // 스테이션 프로파일 대조(§12.4 위치 특정) — 부피는 오류를 탐지만 하고 위치를 못 짚는다.
  // 밴드 max(1.0mm, 0.8%): 곡면의 $fn 현(chord) 근사 vs OCCT tolerance 메시 차이 상한 근거.
  if (Array.isArray(draft.profiles) && Array.isArray(record.profiles)) {
    for (let ai = 0; ai < 3; ai++) {
      const dp = draft.profiles[ai], rp = record.profiles[ai];
      // 신뢰불가 클라 입력 방어 — w1·w2 모두 배열이어야 대조(없으면 해당 축 스킵, 크래시 금지)
      if (!Array.isArray(dp?.w1) || !Array.isArray(dp?.w2) || !Array.isArray(rp?.w1) || !Array.isArray(rp?.w2)) continue;
      const N = Math.min(dp.w1.length, rp.w1.length);
      let worst = -1, worstAt = -1, worstD = 0, worstR = 0, worstTol = 1, pass = true;
      for (let s = 0; s < N; s++) {
        for (const key of ['w1', 'w2'] as const) {
          const d = dp[key][s] ?? 0, r = rp[key][s] ?? 0;
          if (d < 1e-6 && r < 1e-6) continue;
          const diff = Math.abs(d - r);
          const tol = Math.max(1.0, r * 0.008);
          if (diff > tol) pass = false;
          if (diff > worst) { worst = diff; worstAt = s; worstD = d; worstR = r; worstTol = tol; }
        }
      }
      if (worst < 0) continue;
      checks.push({
        name: `${'XYZ'[ai]}-축 단면 (${N}st, max@${worstAt + 1})`,
        draft: +worstD.toFixed(3), record: +worstR.toFixed(3),
        diff: +worst.toFixed(3), tol: +worstTol.toFixed(3), pass,
      });
    }
  }

  // 치수 전수 감사(exact, B-rep 면 실측) — 선언 회전체 치수 중 하나라도 미매칭이면 FAIL
  const dimsFail = !!record.dims?.rows?.some((r) => !r.pass);
  // OCCT 융합 드롭이 있으면 기록측이 불완전 → 대조 자체를 PASS로 단정하지 않음(정직)
  const fuseDropped = record.fuseReport?.dropped?.length ?? 0;
  const verdict = checks.every((c) => c.pass) && !dimsFail && fuseDropped === 0 ? 'PASS' : 'FAIL';
  return NextResponse.json({
    ok: true,
    verdict,
    checks,
    dims: record.dims ?? null,
    record,
    manufacturability: {
      lumps: record.lumps ?? null,
      floating: (record.lumps ?? 1) > 1,
      fuseDropped,
      note: (record.lumps ?? 1) > 1 ? '분리 덩어리 ' + record.lumps + '개 — 허공 부품/미접합 가능(제작 전 확인)' : '단일 연결체',
    },
    notes: [
      '듀얼-방출 교차검증(§6.2-③): 드래프트=SCAD→WASM 메시, 기록=OCCT B-rep 메시 — 같은 intent 독립 빌드 대조.',
      '허용 밴드 근거: 동일 피처셋이므로 기대 차이=테셀레이션뿐 — 축 max(0.5mm,0.2%) · 부피 1.5% · 단면 max(1.0mm,0.8%).',
      '단면=스테이션 실루엣(§13-4 래스터 트랙, 위치 특정 §12.4). exact HLR 치수선 대조는 후속.',
    ],
  });
}
