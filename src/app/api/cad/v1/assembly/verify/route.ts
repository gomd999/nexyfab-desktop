import { NextRequest, NextResponse } from 'next/server';
import { POST as solvePost } from '@/app/api/assembly-solve/route';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import { assemblyInterferencesSpatial, type AABB } from '@/lib/assembly/interference';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';
import { analyzeConstraintRank, type ConstraintRankResult } from '@/lib/assembly/constraintJacobianRank';
import {
  collisionGeometryFromFeatureTree,
  exactLocalAabb,
  refineFeatureTreeInterferences,
  type FeatureTreeCollisionGeometry,
  type RefinedInterference,
} from '@/lib/assembly/featureTreePreciseInterference';
import {
  runHingeTrajectory,
  runMotionSweep,
  type HingeTrajectoryRequest,
  type MotionSweepRequest,
} from '@/lib/assembly/motionStudy';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { evaluateJointEvidenceRelease, type JointEvidenceClaim } from '@/lib/reference/jointEvidenceReleaseGate';
import { hashNativeCadVerificationInput } from '@/lib/reference/nativeCadExpertReview';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 32 * 1024 * 1024;

type VerifyBody = {
  state?: AssemblyState;
  featureTrees?: Record<string, FeatureTree>;
  solver?: string;
  solverOptions?: unknown;
  useGroups?: boolean;
  maxParallel?: number;
  localBoxes?: Record<string, AABB>;
  interferenceWhitelist?: string[];
  intendedContacts?: Array<{ partA: string; partB: string; justification: string }>;
  allowedDoF?: number;
  motion?: MotionSweepRequest;
  motionTrajectory?: HingeTrajectoryRequest;
  jointEvidence?: JointEvidenceClaim;
  preciseInterference?: boolean;
};

/** Solve mates, count DoF, scan conservative interference, and optionally sweep motion. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-assembly-verify:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many assembly verification requests' }, { status: 429 });
  }
  let body: VerifyBody;
  try { body = await readBoundedJson<VerifyBody>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    body = {};
  }
  const motionRequested = Boolean(body.motion || body.motionTrajectory);
  if (body.motion && body.motionTrajectory) {
    return NextResponse.json({ ok: false, code: 'INVALID_MOTION', message: 'motion and motionTrajectory are mutually exclusive' }, { status: 422 });
  }
  if (body.motionTrajectory) {
    const trajectory = body.motionTrajectory;
    const validMateIds = Array.isArray(trajectory.mateIds)
      && trajectory.mateIds.length >= 2
      && trajectory.mateIds.length <= 24
      && trajectory.mateIds.every(id => typeof id === 'string' && id.trim().length > 0)
      && new Set(trajectory.mateIds).size === trajectory.mateIds.length;
    const validKeyframes = Array.isArray(trajectory.keyframes)
      && trajectory.keyframes.length >= 2
      && trajectory.keyframes.length <= 30
      && validMateIds
      && trajectory.keyframes.every(frame => Array.isArray(frame)
        && frame.length === trajectory.mateIds.length
        && frame.every(Number.isFinite));
    const totalFrames = Array.isArray(trajectory.keyframes) && Number.isInteger(trajectory.stepsPerSegment)
      ? (trajectory.keyframes.length - 1) * trajectory.stepsPerSegment + 1
      : Number.POSITIVE_INFINITY;
    if (!validMateIds || !validKeyframes
      || !Number.isInteger(trajectory.stepsPerSegment) || trajectory.stepsPerSegment < 1 || trajectory.stepsPerSegment > 120
      || totalFrames > 360) {
      return NextResponse.json({ ok: false, code: 'INVALID_MOTION', message: 'motionTrajectory exceeds the governed mate, keyframe, step, or 360-frame budget' }, { status: 422 });
    }
  }
  const documentedContacts = (body.intendedContacts ?? []).filter(contact => contact.justification.trim().length > 0);
  const interferenceExclusions = new Set([
    ...(body.interferenceWhitelist ?? []),
    ...documentedContacts.map(contact => [contact.partA, contact.partB].sort().join('::')),
  ]);
  const solveReq = new NextRequest(new URL('/api/assembly-solve', req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state: body.state,
      featureTrees: body.featureTrees,
      solver: body.solver ?? 'auto',
      solverOptions: body.solverOptions,
      useGroups: body.useGroups,
      maxParallel: body.maxParallel,
    }),
  });
  const solvedResponse = await solvePost(solveReq);
  const solved = await solvedResponse.json() as Record<string, unknown>;
  if (!solvedResponse.ok) return NextResponse.json(solved, { status: solvedResponse.status });

  const solvedState = (solved.state ?? body.state) as AssemblyState | undefined;
  const collisionGeometries = new Map<string, FeatureTreeCollisionGeometry>();
  if (body.preciseInterference && body.featureTrees) {
    const built = await Promise.all(Object.entries(body.featureTrees).map(async ([partId, tree]) => (
      [partId, await collisionGeometryFromFeatureTree(partId, tree, { requireExact: true })] as const
    )));
    for (const [partId, geometry] of built) collisionGeometries.set(partId, geometry);
  }
  const suppliedBoxes = validBoxes(body.localBoxes) && solvedState
    ? new Map(Object.entries(body.localBoxes!))
    : null;
  const exactBoxes = body.preciseInterference && solvedState
    ? exactCollisionBoxes(solvedState, collisionGeometries)
    : null;
  // In precise mode the broad phase must use bounds measured from the same
  // OCCT-rebuilt solids as the narrow phase. Caller boxes remain preview hints
  // and cannot suppress a collision candidate or manufacturing release block.
  const boxes = exactBoxes ?? suppliedBoxes;
  const interferences = boxes && solvedState
    ? assemblyInterferencesSpatial(solvedState.parts, boxes, interferenceExclusions)
    : [];
  const staticRefinement = body.preciseInterference && solvedState
    ? refineFeatureTreeInterferences(interferences, solvedState.parts, collisionGeometries)
    : [];
  const flaggedInterferences = body.preciseInterference
    ? staticRefinement.filter(result => !result.available || result.intersects).map(result => result.pair)
    : interferences;

  let motion: unknown = null;
  let motionInterference: unknown = null;
  const motionRefinements: RefinedInterference[] = [];
  if (motionRequested) {
    if (!solvedState || !body.featureTrees) {
      return NextResponse.json({ ok: false, code: 'MOTION_REQUIRES_GEOMETRY', message: 'motion requires solved state and featureTrees' }, { status: 422 });
    }
    if (body.motion && (!Number.isInteger(body.motion.steps) || body.motion.steps < 1 || body.motion.steps > 360)) {
      return NextResponse.json({ ok: false, code: 'INVALID_MOTION', message: 'motion.steps must be an integer from 1 to 360' }, { status: 422 });
    }
    try {
      const resolver = featureTreeGeometryResolver(new Map(Object.entries(body.featureTrees)));
      motion = body.motion
        ? runMotionSweep(solvedState, resolver, body.motion)
        : runHingeTrajectory(solvedState, resolver, body.motionTrajectory!);
      if (boxes) {
        const frameResults = (motion as ReturnType<typeof runMotionSweep> | ReturnType<typeof runHingeTrajectory>).frames.map(frame => {
          const rawPairs = assemblyInterferencesSpatial(
            frame.solve.state.parts,
            boxes,
            interferenceExclusions,
          );
          const refinement = body.preciseInterference
            ? refineFeatureTreeInterferences(rawPairs, frame.solve.state.parts, collisionGeometries)
            : [];
          motionRefinements.push(...refinement);
          const pairs = body.preciseInterference
            ? refinement.filter(result => !result.available || result.intersects).map(result => result.pair)
            : rawPairs;
          return {
            frame: frame.index,
            ...('parameterValue' in frame ? { parameterValue: frame.parameterValue } : { parameterValues: frame.parameterValues }),
            rawPairs,
            pairs,
            refinement,
          };
        });
        const collisionFrames = frameResults.filter(frame => frame.pairs.length > 0);
        motionInterference = {
          checkedFrames: frameResults.length,
          collisionFrameCount: collisionFrames.length,
          firstCollisionFrame: collisionFrames[0]?.frame ?? -1,
          maxPenetrationMm: collisionFrames.reduce(
            (max, frame) => Math.max(max, ...frame.pairs.map(pair => pair.penetration)),
            0,
          ),
          frames: collisionFrames,
        };
      }
    } catch (error) {
      return NextResponse.json({ ok: false, code: 'MOTION_FAILED', message: error instanceof Error ? error.message : 'motion study failed' }, { status: 422 });
    }
  }
  const motionOk = !motion || (
    (motion as { allConverged?: boolean }).allConverged === true &&
    (!motionInterference || (motionInterference as { collisionFrameCount: number }).collisionFrameCount === 0)
  );
  const candidateKeys = new Set(interferences.map(pair => `${pair.partA}::${pair.partB}`));
  if (motionInterference) {
    for (const frame of (motionInterference as { frames: Array<{ pairs: Array<{ partA: string; partB: string }> }> }).frames) {
      for (const pair of frame.pairs) candidateKeys.add(`${pair.partA}::${pair.partB}`);
    }
  }
  const allRefinements: RefinedInterference[] = [...staticRefinement, ...motionRefinements];
  const exactCadFailures = body.preciseInterference && solvedState
    ? solvedState.parts.flatMap(part => {
        const geometry = collisionGeometries.get(part.id);
        return geometry?.available && geometry.source === 'occt-exact' && geometry.exactCad
          ? []
          : [geometry?.reason ?? `${part.id}: exact OCCT/STEP evidence unavailable`];
      })
    : [];
  const exactCadEvidence = Object.fromEntries(
    [...collisionGeometries]
      .filter((entry): entry is [string, FeatureTreeCollisionGeometry & { exactCad: NonNullable<FeatureTreeCollisionGeometry['exactCad']> }] => Boolean(entry[1].exactCad))
      .map(([partId, geometry]) => [partId, geometry.exactCad]),
  );
  const preciseAvailable = allRefinements.filter(result => result.available);
  const preciseFallback = allRefinements.filter(result => !result.available);
  const preciseInterference = {
    requested: body.preciseInterference === true,
    status: body.preciseInterference !== true ? 'not-requested'
      : exactCadFailures.length > 0 ? 'unavailable-no-tessellated-part-geometry'
      : candidateKeys.size === 0 ? 'not-needed-no-candidates'
      : preciseFallback.length === 0 ? 'completed'
      : preciseAvailable.length > 0 ? 'partial-conservative-fallback'
      : 'unavailable-no-tessellated-part-geometry',
    candidates: [...candidateKeys].sort(),
    confirmed: preciseAvailable.filter(result => result.intersects).map(refinementSummary),
    cleared: preciseAvailable.filter(result => !result.intersects).map(refinementSummary),
    fallback: preciseFallback.map(refinementSummary),
    conservativeVerdictRetained: preciseFallback.length > 0,
  };
  const interferenceChecked = boxes !== null;
  let constraintRank: ConstraintRankResult | null = null;
  if (solvedState && body.featureTrees) {
    try {
      constraintRank = analyzeConstraintRank(solvedState, featureTreeGeometryResolver(new Map(Object.entries(body.featureTrees))));
    } catch { /* missing/invalid geometry is reported as unavailable, never guessed */ }
  }
  const tolerance = typeof (body.solverOptions as { tolerance?: unknown } | undefined)?.tolerance === 'number'
    ? (body.solverOptions as { tolerance: number }).tolerance : 1e-4;
  const unsupportedResiduals = Array.isArray(solved.residuals)
    ? solved.residuals.filter(item => !(item as { supported?: boolean }).supported).length : 0;
  const allowedDoF = Number.isInteger(body.allowedDoF) && body.allowedDoF! >= 0 ? body.allowedDoF! : 0;
  const motionRequired = allowedDoF > 0;
  const verificationInputHash = hashNativeCadVerificationInput({
    state: body.state ?? null,
    featureTrees: body.featureTrees ?? null,
    motion: body.motion ?? body.motionTrajectory ?? null,
    allowedDoF,
    intendedContacts: documentedContacts,
  });
  const jointEvidenceGate = body.jointEvidence
    ? evaluateJointEvidenceRelease(body.jointEvidence, undefined, verificationInputHash)
    : {
        status: 'not_run' as const,
        nativeKpiEligible: false,
        manufacturingReleaseEligible: false,
        usage: 'missing' as const,
        errors: ['joint_evidence_missing'],
      };
  const preciseComplete = preciseInterference.requested
    && (preciseInterference.status === 'completed' || preciseInterference.status === 'not-needed-no-candidates');
  const legacyWhitelistUsed = (body.interferenceWhitelist?.length ?? 0) > 0;
  const assemblyCertificate = {
    solver: solved.phase === 'real' ? 'pass' : 'not_run',
    converged: solved.success === true,
    finalMaxResidual: typeof solved.finalMaxResidual === 'number' ? solved.finalMaxResidual : null,
    tolerance,
    unsupportedResiduals,
    approximateDoF: typeof solved.dof === 'number' ? solved.dof : null,
    rankDoF: constraintRank?.dof ?? null,
    constraintRank,
    allowedDoF,
    dofAccepted: constraintRank?.authoritative === true && constraintRank.dof >= 0 && constraintRank.dof <= allowedDoF,
    interference: preciseComplete ? 'precise' : interferenceChecked ? 'conservative' : 'not_run',
    intendedContactsDocumented: !legacyWhitelistUsed && documentedContacts.length === (body.intendedContacts?.length ?? 0),
    motion: motionRequested ? (motionOk ? 'pass' : 'fail') : motionRequired ? 'not_run' : 'not_required',
    motionRequired,
    jointEvidence: motionRequired ? (jointEvidenceGate.manufacturingReleaseEligible ? 'pass' : 'fail') : 'not_required',
    exactCad: !body.preciseInterference ? 'not_run' : exactCadFailures.length === 0 ? 'pass' : 'fail',
  };
  const releaseReady = assemblyCertificate.solver === 'pass' && assemblyCertificate.converged
    && typeof assemblyCertificate.finalMaxResidual === 'number' && assemblyCertificate.finalMaxResidual <= tolerance
    && unsupportedResiduals === 0 && assemblyCertificate.dofAccepted && preciseComplete
    && assemblyCertificate.exactCad === 'pass'
    && flaggedInterferences.length === 0 && assemblyCertificate.intendedContactsDocumented && motionOk
    && (!motionRequired || (assemblyCertificate.motion === 'pass' && jointEvidenceGate.manufacturingReleaseEligible));
  const previewOk = solved.success === true && interferenceChecked && flaggedInterferences.length === 0 && motionOk;
  return NextResponse.json({
    ...solved,
    ok: true,
    interferences,
    flaggedInterferences,
    interferenceMethod: exactBoxes ? 'occt-derived-aabb-plus-precise-mesh'
      : boxes ? 'aabb-spatial-conservative' : 'not-run-no-local-boxes',
    motion,
    motionMode: body.motionTrajectory ? 'coordinated-hinge-trajectory' : body.motion ? 'single-parameter-sweep' : 'not-run',
    motionInterference,
    preciseInterference,
    exactCadEvidence,
    jointEvidenceGate,
    verificationInputHash,
    verificationUnavailable: [
      ...(interferenceChecked ? [] : ['interference: localBoxes were not supplied']),
      ...exactCadFailures,
      ...(motionRequired && !motionRequested ? ['motion: allowedDoF > 0 requires a governed motion sweep'] : []),
      ...(motionRequired && !jointEvidenceGate.manufacturingReleaseEligible ? [`joint evidence: ${jointEvidenceGate.errors.join(', ')}`] : []),
    ],
    previewOk,
    designOk: releaseReady,
    assemblyCertificate,
    releaseReady,
  });
}

function refinementSummary(result: RefinedInterference) {
  return {
    pair: `${result.pair.partA}::${result.pair.partB}`,
    aabbPenetrationMm: result.pair.penetration,
    available: result.available,
    intersects: result.intersects,
    triPairsIntersecting: result.triPairsIntersecting,
    byContainment: result.byContainment,
    trianglesA: result.trianglesA,
    trianglesB: result.trianglesB,
    ...(result.unavailableReason ? { reason: result.unavailableReason } : {}),
  };
}

function validBoxes(value: unknown): value is Record<string, AABB> {
  if (value === undefined) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, AABB>).every(box =>
    box && finiteVec(box.min) && finiteVec(box.max) &&
    box.min.x <= box.max.x && box.min.y <= box.max.y && box.min.z <= box.max.z,
  );
}

function exactCollisionBoxes(
  state: AssemblyState,
  geometries: ReadonlyMap<string, FeatureTreeCollisionGeometry>,
): Map<string, AABB> | null {
  const boxes = new Map<string, AABB>();
  for (const part of state.parts) {
    const geometry = geometries.get(part.id);
    const bbox = geometry ? exactLocalAabb(geometry) : null;
    if (!bbox) return null;
    boxes.set(part.id, bbox);
  }
  return boxes;
}

function finiteVec(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false;
  const vec = value as { x?: unknown; y?: unknown; z?: unknown };
  return [vec.x, vec.y, vec.z].every(item => typeof item === 'number' && Number.isFinite(item));
}
