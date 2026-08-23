/**
 * POST /api/nexyfab/drawing/fea-quick — 검증 그물 ⑥ 간이 FEA (29축 V, 2026-07-16).
 *
 * 설계 패키지의 FEA 조각(feaFromStl: STL→자동 경계조건→TET10 선형정적, SF<2면
 * 고밀도 재해석 2-step)을 스튜디오 검증 탭에서 단독 실행. AI 없음 — 결정론+수치해석.
 * 정직: 하중은 사용자 명시 입력(기본값 날조 금지), 선형등방·스크리닝 한계를 응답에 명시.
 *
 * caller: { scad, materialKey?, loadKg } →
 *   { ok, method, maxStressMPa, safetyFactor, maxDispMm, material, yieldMPa, refined?, reportHtml }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { feaFromStlAsync, feaReportHtml, FEA_MATERIALS } from '@/app/[lang]/shape-generator/analysis/feaPackage';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { enqueueFeaJob } from '@/lib/fea-jobs/redisFeaJobs';
import { publicFeaJob } from '@/lib/fea-jobs/contracts';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type VerifyMod = { renderStl: (scad: string) => Promise<Uint8Array> };
let _vfy: VerifyMod | null = null;
async function loadVfy(): Promise<VerifyMod> {
  if (_vfy) return _vfy;
  _vfy = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'verify.mjs')).href)) as VerifyMod;
  return _vfy;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-fea-quick:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let scad: string, materialKey: string, loadKg: number, precise: boolean;
  try {
    const body = await readBoundedJson<{ scad?: string; materialKey?: string; loadKg?: number; precise?: boolean }>(req, MAX_BODY_BYTES);
    scad = String(body.scad ?? '');
    materialKey = typeof body.materialKey === 'string' && body.materialKey in FEA_MATERIALS ? body.materialKey : 'steel';
    loadKg = Number(body.loadKg);
    // 옵트인 정밀 해석: 곡률 응력집중부면 A5-급 refine+IC(0)(실측 ~24s). 동기 요청이 길어지므로
    // 명시 요청일 때만 수행 — 무음 타임아웃 금지.
    precise = body.precise === true;
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'scad가 너무 큽니다(1MB 이하).' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (scad.length < 10) return NextResponse.json({ ok: false, error: 'scad가 필요합니다.' }, { status: 400 });
  if (scad.length > 1_000_000) return NextResponse.json({ ok: false, error: 'scad가 너무 큽니다(1MB 이하).' }, { status: 413 });
  // 하중 날조 금지 — 사용자가 명시해야 실행(자중 자동은 어셈블리 패키지 경로가 담당)
  if (!Number.isFinite(loadKg) || loadKg <= 0 || loadKg > 1_000_000) {
    return NextResponse.json({ ok: false, error: '상면 등가 하중(kg)을 입력하세요(0 초과, 1,000t 이하).' }, { status: 400 });
  }

  // Precision work is never executed in the web request process. Keep the
  // fast screening path below for backwards compatibility, but authenticated
  // precision requests are durable Redis jobs handled by nexyfab-fea-worker.
  if (precise) {
    if (!checkOrigin(req)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ ok: false, error: '정밀 FEA는 로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, { status: 401 });
    if (user.apiKey && !user.apiKey.scopes.includes('write:projects')) {
      return NextResponse.json({ ok: false, error: 'Insufficient API key scope', requiredScope: 'write:projects' }, { status: 403 });
    }
    try {
      const submitted = await enqueueFeaJob({
        ownerUserId: user.userId,
        scopeId: `user:${user.userId}`,
        idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
        request: {
          source: { kind: 'scad', source: scad }, materialKey, loadN: loadKg * 9.81, precise: true,
          loadNote: `사용자 지정 ${loadKg} kg × g — 상면 등가(선형등방·스크리닝 한계는 리포트에 명시)`,
        },
      });
      if (!submitted.ok) {
        const status = submitted.code === 'FEA_PENDING_LIMIT' || submitted.code === 'FEA_IDEMPOTENCY_PAYLOAD_CONFLICT' ? 409 : 400;
        return NextResponse.json({ ok: false, error: submitted.message, code: submitted.code }, { status });
      }
      const pollUrl = `/api/nexyfab/fea/jobs/${submitted.job.id}`;
      return NextResponse.json(
        { ok: true, async: true, jobId: submitted.job.id, status: submitted.job.status, progress: submitted.job.progress, pollUrl, job: publicFeaJob(submitted.job) },
        { status: submitted.reused ? 200 : 202, headers: { Location: pollUrl, 'Retry-After': '2' } },
      );
    } catch {
      return NextResponse.json({ ok: false, error: '정밀 FEA 작업 큐를 사용할 수 없습니다.', code: 'FEA_QUEUE_UNAVAILABLE' }, { status: 503 });
    }
  }

  try {
    const vfy = await loadVfy();
    const stl = await vfy.renderStl(scad);
    // precise 경로: gmsh 경계정합 메시(인증후보급) 우선, 부재 시 octree-snap(엔지니어링급) 자동 폴백.
    const out = await feaFromStlAsync({
      stl, materialKey, loadN: loadKg * 9.81, precise,
      loadNote: `사용자 지정 ${loadKg} kg × g — 상면 등가(선형등방·스크리닝 한계는 리포트에 명시)`,
    });
    const r = out.result;
    return NextResponse.json({
      ok: true,
      method: r.method,
      maxStressMPa: +Number(r.maxStress).toFixed(2),
      safetyFactor: Number.isFinite(r.safetyFactor) ? +Number(r.safetyFactor).toFixed(2) : null,
      maxDispMm: Number.isFinite(r.maxDisplacement) ? +Number(r.maxDisplacement).toFixed(3) : null,
      material: out.material.label,
      yieldMPa: out.material.yieldStrength,
      refined: out.refined ?? null,
      raiser: out.raiser ?? null,
      mesh: out.mesh,
      reportHtml: feaReportHtml(out, { title: '간이 FEA — 스튜디오 검증 그물 ⑥' }),
      note: '선형정적·단일물성·자동 경계조건(스크리닝) — 비법정, 상세 해석은 유자격 기술자 검토',
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'FEA 실행 실패: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }
}
