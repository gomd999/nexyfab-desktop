import { NextRequest, NextResponse } from 'next/server';
import { POST as solvePost } from '@/app/api/assembly-solve/route';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import { assemblyInterferencesSpatial, type AABB } from '@/lib/assembly/interference';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';
import { analyzeConstraintRank, type ConstraintRankResult } from '@/lib/assembly/constraintJacobianRank';
import {
  collisionGeometryFromFeatureTree,
  refineFeatureTreeInterferences,
  type FeatureTreeCollisionGeometry,
  type RefinedInterference,
} from '@/lib/assembly/featureTreePreciseInterference';
import { runMotionSweep, type MotionSweepRequest } from '@/lib/assembly/motionStudy';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  preciseInterference?: boolean;
};

/** Solve mates, count DoF, scan conservative interference, and optionally sweep motion. */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-assembly-verify:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT', message: 'Too many assembly verification requests' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as VerifyBody;
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
  const boxes = validBoxes(body.localBoxes) && solvedState
    ? new Map(Object.entries(body.localBoxes!))
    : null;
  const interferences = boxes && solvedState
    ? assemblyInterferencesSpatial(solvedState.parts, boxes, interferenceExclusions)
    : [];
  const collisionGeometries = new Map<string, FeatureTreeCollisionGeometry>();
  if (body.preciseInterference && body.featureTrees) {
    const built = await Promise.all(Object.entries(body.featureTrees).map(async ([partId, tree]) => (
      [partId, await collisionGeometryFromFeatureTree(partId, tree)] as const
    )));
    for (const [partId, geometry] of built) collisionGeometries.set(partId, geometry);
  }
  const staticRefinement = body.preciseInterference && solvedState
    ? refineFeatureTreeInterferences(interferences, solvedState.parts, collisionGeometries)
    : [];
  const flaggedInterferences = body.preciseInterference
    ? staticRefinement.filter(result => !result.available || result.intersects).map(result => result.pair)
    : interferences;

  let motion: unknown = null;
  let motionInterference: unknown = null;
  const motionRefinements: RefinedInterference[] = [];
  if (body.motion) {
    if (!solvedState || !body.featureTrees) {
      return NextResponse.json({ ok: false, code: 'MOTION_REQUIRES_GEOMETRY', message: 'motion requires solved state and featureTrees' }, { status: 422 });
    }
    if (!Number.isInteger(body.motion.steps) || body.motion.steps < 1 || body.motion.steps > 360) {
      return NextResponse.json({ ok: false, code: 'INVALID_MOTION', message: 'motion.steps must be an integer from 1 to 360' }, { status: 422 });
    }
    try {
      motion = runMotionSweep(
        solvedState,
        featureTreeGeometryResolver(new Map(Object.entries(body.featureTrees))),
        body.motion,
      );
      if (boxes) {
        const frameResults = (motion as ReturnType<typeof runMotionSweep>).frames.map(frame => {
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
          return { frame: frame.index, parameterValue: frame.parameterValue, rawPairs, pairs, refinement };
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
  const preciseAvailable = allRefinements.filter(result => result.available);
  const preciseFallback = allRefinements.filter(result => !result.available);
  const preciseInterference = {
    requested: body.preciseInterference === true,
    status: body.preciseInterference !== true ? 'not-requested'
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
    motion: body.motion ? (motionOk ? 'pass' : 'fail') : 'not_required',
  };
  const releaseReady = assemblyCertificate.solver === 'pass' && assemblyCertificate.converged
    && typeof assemblyCertificate.finalMaxResidual === 'number' && assemblyCertificate.finalMaxResidual <= tolerance
    && unsupportedResiduals === 0 && assemblyCertificate.dofAccepted && preciseComplete
    && flaggedInterferences.length === 0 && assemblyCertificate.intendedContactsDocumented && motionOk;
  const previewOk = solved.success === true && interferenceChecked && flaggedInterferences.length === 0 && motionOk;
  return NextResponse.json({
    ...solved,
    ok: true,
    interferences,
    flaggedInterferences,
    interferenceMethod: boxes ? 'aabb-spatial-conservative' : 'not-run-no-local-boxes',
    motion,
    motionInterference,
    preciseInterference,
    verificationUnavailable: interferenceChecked ? [] : ['interference: localBoxes were not supplied'],
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

function finiteVec(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false;
  const vec = value as { x?: unknown; y?: unknown; z?: unknown };
  return [vec.x, vec.y, vec.z].every(item => typeof item === 'number' && Number.isFinite(item));
}
