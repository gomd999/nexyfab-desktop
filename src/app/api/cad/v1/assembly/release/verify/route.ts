import { NextRequest, NextResponse } from 'next/server';
import { POST as staticVerifyPost } from '@/app/api/cad/v1/assembly/verify/route';
import { POST as continuousVerifyPost } from '@/app/api/cad/v1/assembly/animation/verify/route';
import type { AssemblyAnimation } from '@/lib/assembly/assemblyAnimation';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { evaluateJointEvidenceRelease, type JointEvidenceClaim } from '@/lib/reference/jointEvidenceReleaseGate';
import { hashNativeCadVerificationInput } from '@/lib/reference/nativeCadExpertReview';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 32 * 1024 * 1024;

interface ReleaseVerifyBody {
  state?: AssemblyState;
  featureTrees?: Record<string, FeatureTree>;
  animation?: AssemblyAnimation;
  allowedDoF?: number;
  solver?: string;
  solverOptions?: unknown;
  useGroups?: boolean;
  maxParallel?: number;
  intendedContacts?: Array<{ partA: string; partB: string; justification: string }>;
  interferenceWhitelist?: string[];
  frameStep?: number;
  rotationalMaxDepth?: number;
  toiMaxDepth?: number;
  toiFrameTolerance?: number;
  toiMaxEvaluations?: number;
  jointEvidence?: JointEvidenceClaim;
}

interface ExactCadEvidence {
  solidCount?: number;
  stepSha256?: string;
  stepRoundTripVolumeRelError?: number;
}

interface StaticVerificationPayload {
  ok?: boolean;
  code?: string;
  message?: string;
  state?: AssemblyState;
  exactCadEvidence?: Record<string, ExactCadEvidence>;
  flaggedInterferences?: unknown[];
  verificationUnavailable?: string[];
  assemblyCertificate?: {
    solver?: string;
    converged?: boolean;
    finalMaxResidual?: number | null;
    tolerance?: number;
    unsupportedResiduals?: number;
    dofAccepted?: boolean;
    interference?: string;
    intendedContactsDocumented?: boolean;
    exactCad?: string;
    motion?: string;
    motionRequired?: boolean;
    jointEvidence?: string;
  };
}

interface ContinuousVerificationPayload {
  ok?: boolean;
  code?: string;
  message?: string;
  precise?: {
    status?: string;
    collisionFree?: boolean;
    failureCodes?: string[];
    geometryErrors?: string[];
    exactCadEvidence?: Record<string, ExactCadEvidence>;
  };
}

function jsonRequest(path: string, baseUrl: string, body: unknown, headers: Headers): NextRequest {
  return new NextRequest(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers.get('x-forwarded-for') ? { 'x-forwarded-for': headers.get('x-forwarded-for')! } : {}),
      ...(headers.get('x-real-ip') ? { 'x-real-ip': headers.get('x-real-ip')! } : {}),
    },
    body: JSON.stringify(body),
  });
}

function evidenceHash(value: Record<string, ExactCadEvidence> | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return hashNativeCadVerificationInput(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

/**
 * One commercial release decision over one solved state and one canonical
 * input hash. The endpoint deliberately performs no release/RFQ side effect.
 */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-assembly-release-verify:${ip}`, 10, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many assembly release verification requests' }, { status: 429 });
  }
  let body: ReleaseVerifyBody | null;
  try { body = await readBoundedJson<ReleaseVerifyBody>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    body = null;
  }
  if (!body?.state || !body.featureTrees || body.state.parts.length === 0) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'state and exact featureTrees are required' }, { status: 400 });
  }
  if (body.state.parts.some(part => !body.featureTrees?.[part.id])) {
    return NextResponse.json({ ok: false, code: 'FEATURE_TREE_MISSING', message: 'every assembly part requires a FeatureTree' }, { status: 422 });
  }
  const allowedDoF = Number.isInteger(body.allowedDoF) && body.allowedDoF! >= 0 ? body.allowedDoF! : 0;
  const motionRequired = allowedDoF > 0;
  if (motionRequired && (!body.animation || body.animation.tracks.length === 0)) {
    return NextResponse.json({
      ok: false,
      code: 'GOVERNED_ANIMATION_REQUIRED',
      message: 'allowedDoF > 0 requires a non-empty governed AssemblyAnimation',
      quoteOrRfqSideEffects: false,
      releaseExecuted: false,
    }, { status: 422 });
  }
  const intendedContacts = (body.intendedContacts ?? [])
    .filter(contact => contact.justification.trim().length > 0)
    .map(contact => ({ ...contact }))
    .sort((a, b) => `${a.partA}:${a.partB}:${a.justification}`.localeCompare(`${b.partA}:${b.partB}:${b.justification}`));

  const staticResponse = await staticVerifyPost(jsonRequest('/api/cad/v1/assembly/verify', req.url, {
    state: body.state,
    featureTrees: body.featureTrees,
    solver: body.solver ?? 'auto',
    solverOptions: body.solverOptions,
    useGroups: body.useGroups,
    maxParallel: body.maxParallel,
    preciseInterference: true,
    allowedDoF,
    intendedContacts,
    interferenceWhitelist: body.interferenceWhitelist,
  }, req.headers));
  const staticPayload = await staticResponse.json() as StaticVerificationPayload;
  if (!staticResponse.ok || staticPayload.ok === false) {
    return NextResponse.json({
      ok: false,
      code: 'STATIC_VERIFICATION_FAILED',
      cause: staticPayload,
      message: staticPayload.message ?? 'static exact assembly verification failed',
      quoteOrRfqSideEffects: false,
      releaseExecuted: false,
    }, { status: staticResponse.status >= 400 ? staticResponse.status : 422 });
  }
  const solvedState = staticPayload.state ?? body.state;
  let continuousPayload: ContinuousVerificationPayload | null = null;
  if (motionRequired) {
    const continuousResponse = await continuousVerifyPost(jsonRequest('/api/cad/v1/assembly/animation/verify', req.url, {
      state: solvedState,
      animation: body.animation,
      featureTrees: body.featureTrees,
      frameStep: positiveInteger(body.frameStep, Math.max(1, Math.ceil((body.animation!.endFrame - body.animation!.startFrame) / 200))),
      rotationalMaxDepth: body.rotationalMaxDepth,
      toiMaxDepth: body.toiMaxDepth ?? 20,
      toiFrameTolerance: body.toiFrameTolerance ?? 1e-3,
      toiMaxEvaluations: body.toiMaxEvaluations,
    }, req.headers));
    continuousPayload = await continuousResponse.json() as ContinuousVerificationPayload;
    if (!continuousResponse.ok || continuousPayload.ok === false) {
      return NextResponse.json({
        ok: false,
        code: 'CONTINUOUS_VERIFICATION_FAILED',
        cause: continuousPayload,
        message: continuousPayload.message ?? 'continuous exact assembly verification failed',
        quoteOrRfqSideEffects: false,
        releaseExecuted: false,
      }, { status: continuousResponse.status >= 400 ? continuousResponse.status : 422 });
    }
  }

  const verificationInputHash = hashNativeCadVerificationInput({
    schema: 'nexyfab.assembly-release-input.v1',
    solvedState,
    featureTrees: body.featureTrees,
    animation: motionRequired ? body.animation : null,
    allowedDoF,
    intendedContacts,
    solver: body.solver ?? 'auto',
    solverOptions: body.solverOptions ?? null,
  });
  const jointEvidenceGate = motionRequired
    ? body.jointEvidence
      ? evaluateJointEvidenceRelease(body.jointEvidence, undefined, verificationInputHash)
      : {
          status: 'not_run' as const,
          nativeKpiEligible: false,
          manufacturingReleaseEligible: false,
          usage: 'missing' as const,
          errors: ['joint_evidence_missing'],
        }
    : {
        status: 'not_run' as const,
        nativeKpiEligible: false,
        manufacturingReleaseEligible: false,
        usage: 'not-required' as const,
        errors: [] as string[],
      };

  const staticCertificate = staticPayload.assemblyCertificate ?? {};
  const staticEvidenceHash = evidenceHash(staticPayload.exactCadEvidence);
  const motionEvidenceHash = evidenceHash(continuousPayload?.precise?.exactCadEvidence);
  const exactEvidenceConsistent = !motionRequired
    || (staticEvidenceHash !== null && motionEvidenceHash !== null && staticEvidenceHash === motionEvidenceHash);
  const staticPass = staticCertificate.solver === 'pass'
    && staticCertificate.converged === true
    && typeof staticCertificate.finalMaxResidual === 'number'
    && typeof staticCertificate.tolerance === 'number'
    && staticCertificate.finalMaxResidual <= staticCertificate.tolerance
    && staticCertificate.unsupportedResiduals === 0
    && staticCertificate.dofAccepted === true
    && staticCertificate.interference === 'precise'
    && staticCertificate.intendedContactsDocumented === true
    && staticCertificate.exactCad === 'pass'
    && (staticPayload.flaggedInterferences?.length ?? 0) === 0;
  const continuousPass = !motionRequired || (
    continuousPayload?.precise?.status === 'completed'
    && continuousPayload.precise.collisionFree === true
    && (continuousPayload.precise.failureCodes?.length ?? 0) === 0
  );
  const jointPass = !motionRequired || jointEvidenceGate.manufacturingReleaseEligible;
  const releaseReady = staticPass && continuousPass && exactEvidenceConsistent && jointPass;
  const blockers = [
    ...(!staticPass ? ['static exact assembly certificate did not pass'] : []),
    ...(!continuousPass ? [`continuous exact motion verification did not pass: ${(continuousPayload?.precise?.failureCodes ?? []).join(', ') || 'incomplete'}`] : []),
    ...(!exactEvidenceConsistent ? ['static and continuous checks used different exact CAD evidence'] : []),
    ...(!jointPass ? [`native joint evidence did not pass: ${jointEvidenceGate.errors.join(', ')}`] : []),
    ...(staticPayload.verificationUnavailable ?? []),
  ];
  const certificateCore = {
    schema: 'nexyfab.assembly-release-certificate.v1' as const,
    verificationInputHash,
    releaseReady,
    checks: {
      solverAndResidual: staticPass,
      exactCad: staticCertificate.exactCad === 'pass',
      staticInterference: staticPass,
      dofAccepted: staticCertificate.dofAccepted === true,
      continuousMotion: motionRequired ? continuousPass : 'not_required',
      nativeJointEvidence: motionRequired ? jointPass : 'not_required',
      exactEvidenceConsistent,
    },
    evidence: {
      staticExactCadEvidenceHash: staticEvidenceHash,
      continuousExactCadEvidenceHash: motionEvidenceHash,
      partCount: solvedState.parts.length,
      allowedDoF,
      motionRequired,
    },
    blockers,
    releaseExecuted: false as const,
    quoteOrRfqSideEffects: false as const,
  };
  const releaseCertificate = {
    ...certificateCore,
    certificateSha256: hashNativeCadVerificationInput(certificateCore),
  };

  return NextResponse.json({
    ...staticPayload,
    ok: true,
    releaseReady,
    designOk: releaseReady,
    verificationInputHash,
    jointEvidenceGate,
    assemblyCertificate: {
      ...staticCertificate,
      motion: motionRequired ? (continuousPass ? 'pass' : 'fail') : 'not_required',
      motionRequired,
      jointEvidence: motionRequired ? (jointPass ? 'pass' : 'fail') : 'not_required',
      exactEvidenceConsistent,
    },
    continuousMotionVerification: continuousPayload,
    releaseCertificate,
    verificationUnavailable: blockers,
    releaseExecuted: false,
    quoteOrRfqSideEffects: false,
  });
}
