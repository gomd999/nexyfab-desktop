/**
 * POST /api/nexyfab/drawing/export-step
 *
 * 범용 조합 intent → 진짜 B-rep STEP(제조/CNC용). replicad/OCCT를 서버에서
 * 실행(webpackIgnore 런타임 import로 wasm 번들 회피). STEP 텍스트를 그대로 반환.
 *
 * caller: { intent } → { ok, step, entities, bytes }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { buildDesignArtifactManifest, designRevisionSha256 } from '@/lib/designArtifactBinding';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type FuseReport = { total: number; jittered: number; dropped: { kind: string; at: number[] | null; op: string }[] };
/** 조립 트리 실측치 — 트리 경로로 나갔을 때만 채워진다(NAUO 0 = 평면 나열). */
type StepTree = { nauo: number; products: number; groups: string[] };
type StepModule = {
  intentToStep: (intent: unknown) => Promise<{
    step: string; entities: number; fuseReport?: FuseReport; tree?: StepTree | null; importNotes?: string[];
  }>;
};

let _mod: StepModule | null = null;
async function loadStep(): Promise<StepModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'to-step.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as StepModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-step:${ip}`, 8, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let intent: unknown;
  try {
    intent = (await readBoundedJson<{ intent?: unknown }>(req, MAX_BODY_BYTES)).intent;
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'intent가 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!intent || typeof intent !== 'object') {
    return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  }

  try {
    const step = await loadStep();
    const { step: stepText, entities, fuseReport, tree, importNotes } = await step.intentToStep(intent);
    // 정직 고지: OCCT 융합서 제외된 피처가 있으면 숨기지 않고 응답에 명시(§14 견고화)
    const dropped = fuseReport?.dropped?.length ?? 0;
    const artifactBinding = buildDesignArtifactManifest({
      revisionId: 'intent-' + designRevisionSha256(intent).slice(0, 12),
      revisionValue: intent,
      artifacts: [{ name: 'model.step', mime: 'application/step', bytes: Buffer.from(stepText, 'utf8') }],
    });
    return NextResponse.json({
      ok: true, step: stepText, entities, bytes: stepText.length, format: 'STEP (B-rep, ISO-10303)',
      revisionId: artifactBinding.manifest.revisionId,
      revisionSha256: artifactBinding.manifest.revisionSha256,
      stepSha256: artifactBinding.manifest.artifacts[0]!.sha256,
      artifactManifestSha256: artifactBinding.manifestSha256,
      artifactManifest: artifactBinding.manifest,
      releaseStatus: artifactBinding.manifest.releaseStatus,
      manufacturingAllowed: artifactBinding.manifest.manufacturingAllowed,
      // Export success is not a STEP round-trip. A separate re-import and
      // topology/dimension comparison must set this true in a later receipt.
      analyticStepHandoffPassed: false,
      /**
       * 조립 트리 실측(260803). 있으면 CAD 가 하위조립 계층으로 연다.
       * ⚠ 없으면 **평면 나열**이다 — 「STEP 이 나왔다」와 「조립으로 열린다」는 다르고,
       *   그 차이를 응답에서 감추면 사용자는 CAD 를 열기 전까지 모른다.
       */
      assemblyTree: tree
        ? { nauo: tree.nauo, products: tree.products, groups: tree.groups.length, hierarchical: true }
        : { hierarchical: false, note: '평면 다중 PRODUCT(조립 계층 없음)' },
      ...(importNotes?.length ? { notes: importNotes } : {}),
      ...(dropped > 0 ? { fuseDropped: dropped, fuseNote: dropped + '개 피처가 OCCT 융합 한계로 STEP에서 제외됨(프리뷰·검증 메시에는 포함)' } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /gate/.test(msg) ? 422 : 502;
    return NextResponse.json({ ok: false, error: 'STEP export failed: ' + msg.slice(0, 200) }, { status });
  }
}
