import { NextRequest, NextResponse } from "next/server";
import type { AssemblyState } from "@/lib/assembly/assemblyState";
import type { AssemblyAnimation } from "@/lib/assembly/assemblyAnimation";
import { evaluateAssemblyAnimation } from "@/lib/assembly/assemblyAnimation";
import {
  verifyAssemblyAnimationWithRecovery,
  type ContinuousInterference,
} from "@/lib/assembly/assemblyAnimationVerification";
import {
  aabbPenetration,
  transformAabb,
  type AABB,
  type InterferencePair,
} from "@/lib/assembly/interference";
import type { FeatureTree } from "@/lib/cad/featureTree";
import {
  collisionGeometryFromFeatureTree,
  exactLocalAabb,
  locatePreciseCollisionTime,
  refineFeatureTreeInterferences,
  refineLinearIntervals,
  refineRotationalIntervals,
} from "@/lib/assembly/featureTreePreciseInterference";
import {
  cadFailureDisposition,
  type CadFailureCode,
} from "@/lib/reference/cadFailureTaxonomy";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import {
  evaluateJointEvidenceRelease,
  type JointEvidenceClaim,
} from "@/lib/reference/jointEvidenceReleaseGate";
import { hashNativeCadVerificationInput } from "@/lib/reference/nativeCadExpertReview";
import { boundedJsonError, readBoundedJson } from "@/lib/boundedJsonBody";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-animation-verify:${ip}`, 10, 60_000).allowed)
    return NextResponse.json(
      { ok: false, code: "RATE_LIMIT" },
      { status: 429 },
    );
  let b: {
    state?: AssemblyState;
    animation?: AssemblyAnimation;
    localBoxes?: Record<string, AABB>;
    featureTrees?: Record<string, FeatureTree>;
    frameStep?: number;
    rotationalMaxDepth?: number;
    toiMaxDepth?: number;
    toiFrameTolerance?: number;
    toiMaxEvaluations?: number;
    jointEvidence?: JointEvidenceClaim;
  } | null;
  try { b = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === "PAYLOAD_TOO_LARGE") return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    b = null;
  }
  if (!b?.state || !b.animation || (!b.localBoxes && !b.featureTrees))
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "state, animation, and featureTrees (or preview localBoxes) are required",
      },
      { status: 400 },
    );
  const verificationInputHash = hashNativeCadVerificationInput({
    state: b.state,
    animation: b.animation,
    featureTrees: b.featureTrees ?? null,
  });
  const jointEvidenceGate = b.jointEvidence
    ? evaluateJointEvidenceRelease(b.jointEvidence, undefined, verificationInputHash)
    : {
        status: "not_run" as const,
        nativeKpiEligible: false,
        manufacturingReleaseEligible: false,
        usage: "missing" as const,
        errors: ["joint_evidence_missing"],
      };
  let boxes = new Map(Object.entries(b.localBoxes ?? {}));
  const span = b.animation.endFrame - b.animation.startFrame,
    step = Math.max(
      1,
      Math.floor(b.frameStep ?? Math.ceil(Math.max(1, span) / 500)),
    );
  let ccdRecovery = verifyAssemblyAnimationWithRecovery(
    b.state,
    b.animation,
    boxes,
    { frameStep: step, rotationalMaxDepth: b.rotationalMaxDepth },
  );
  let broad = ccdRecovery.verification;
  let ccdRecoveryEvidence = {
      attempts: ccdRecovery.attempts,
      exhausted: ccdRecovery.exhausted,
    };
  if (!b.featureTrees) {
    const code: CadFailureCode = "COLLISION_GEOMETRY_MISSING";
    return NextResponse.json({
      ok: true,
      broad,
      ccdRecovery: ccdRecoveryEvidence,
      precise: {
        status: "not_run",
        errors: ["featureTrees are required for precise verification"],
        failureCodes: [code],
        recovery: [cadFailureDisposition(code)],
      },
      jointEvidenceGate,
      verificationInputHash,
      releaseReady: false,
      quoteOrRfqSideEffects: false,
    });
  }
  const geometries = new Map(
    await Promise.all(
      Object.entries(b.featureTrees).map(
        async ([id, tree]) =>
          [id, await collisionGeometryFromFeatureTree(id, tree, { requireExact: true })] as const,
      ),
    ),
  );
  const exactBoxEntries = b.state.parts.map(part => {
    const geometry = geometries.get(part.id);
    return [part.id, geometry ? exactLocalAabb(geometry) : null] as const;
  });
  if (exactBoxEntries.every((entry): entry is readonly [string, AABB] => entry[1] !== null)) {
    boxes = new Map(exactBoxEntries);
    ccdRecovery = verifyAssemblyAnimationWithRecovery(
      b.state,
      b.animation,
      boxes,
      { frameStep: step, rotationalMaxDepth: b.rotationalMaxDepth },
    );
    broad = ccdRecovery.verification;
    ccdRecoveryEvidence = { attempts: ccdRecovery.attempts, exhausted: ccdRecovery.exhausted };
  }
  const geometryErrors = b.state.parts.flatMap((part) => {
    const geometry = geometries.get(part.id);
    return geometry?.available
      ? []
      : [
          geometry?.reason ??
            `${part.id}: FeatureTree collision geometry missing`,
        ];
  });
  const exactCadEvidence = Object.fromEntries(
    [...geometries]
      .filter((entry) => Boolean(entry[1].exactCad))
      .map(([partId, geometry]) => [partId, geometry.exactCad]),
  );
  const frames = broad.frames
    .filter((f) => f.pairs.length)
    .map((f) => {
      const pose = evaluateAssemblyAnimation(b.state!, b.animation!, f.frame);
      const refined = refineFeatureTreeInterferences(
        f.pairs,
        pose.parts,
        geometries,
      );
      return {
        frame: f.frame,
        status: refined.some((x) => !x.available)
          ? "unavailable"
          : refined.some((x) => x.intersects)
            ? "failed"
            : "passed",
        pairs: refined.map((x) => ({
          partA: x.pair.partA,
          partB: x.pair.partB,
          available: x.available,
          intersects: x.intersects,
          reason: x.unavailableReason,
        })),
      };
    });
  const rotational = broad.continuous.candidates
    .filter(
      (c) =>
        c.method === "adaptive-rotational-aabb" && c.status === "confirmed",
    )
    .map((candidate) => {
      const pose = evaluateAssemblyAnimation(
          b.state!,
          b.animation!,
          candidate.startFrame,
        ),
        byId = new Map(pose.parts.map((p) => [p.id, p])),
        pa = byId.get(candidate.partA),
        pb = byId.get(candidate.partB),
        la = boxes.get(candidate.partA),
        lb = boxes.get(candidate.partB);
      if (!pa || !pb || !la || !lb)
        return {
          ...candidate,
          status: "unavailable" as const,
          intersects: true,
          reason: "pose or collision box unavailable",
        };
      const bboxA = transformAabb(la, pa),
        bboxB = transformAabb(lb, pb),
        pair: InterferencePair = {
          partA: candidate.partA,
          partB: candidate.partB,
          bboxA,
          bboxB,
          penetration: aabbPenetration(bboxA, bboxB),
        };
      const refined = refineFeatureTreeInterferences(
        [pair],
        pose.parts,
        geometries,
      )[0]!;
      return {
        ...candidate,
        status: refined.available
          ? ("completed" as const)
          : ("unavailable" as const),
        intersects: refined.intersects,
        reason: refined.unavailableReason,
      };
    });
  const preciseIntervals = refineRotationalIntervals(
      b.state,
      b.animation,
      broad.continuous.unresolved,
      boxes,
      geometries,
    ),
    preciseLinear = refineLinearIntervals(
      b.state,
      b.animation,
      broad.continuous.candidates,
      boxes,
      geometries,
    ),
    unresolved = preciseIntervals.some((item) => item.status === "unresolved"),
    linearUnresolved = preciseLinear.some(
      (item) => item.status === "unresolved",
    ),
    rotationalCollision = preciseIntervals.some(
      (item) => item.status === "confirmed_collision",
    ),
    linearCollision = preciseLinear.some(
      (item) => item.status === "confirmed_collision",
    ),
    allPreciseIntervals = [...preciseIntervals, ...preciseLinear],
    budgetExceeded = allPreciseIntervals.some(
      (item) =>
        item.status === "unavailable" && item.reason?.includes("budget"),
    ),
    unavailable =
      frames.some((f) => f.status === "unavailable") ||
      rotational.some((r) => r.status === "unavailable") ||
      allPreciseIntervals.some(
        (item) =>
          item.status === "unavailable" && !item.reason?.includes("budget"),
      );
  const pairKey = (a: string, c: string) => [a, c].sort().join("::");
  const collidingPairKeys = new Set<string>([
    ...preciseIntervals.filter((item) => item.status === "confirmed_collision").map((item) => pairKey(item.partA, item.partB)),
    ...preciseLinear.filter((item) => item.status === "confirmed_collision").map((item) => pairKey(item.partA, item.partB)),
    ...rotational.filter((item) => item.status === "completed" && item.intersects).map((item) => pairKey(item.partA, item.partB)),
    ...frames.flatMap((frame) => frame.pairs.filter((item) => item.available && item.intersects).map((item) => pairKey(item.partA, item.partB))),
  ]);
  const toiIntervals: ContinuousInterference[] = broad.continuous.candidates.filter((item) => collidingPairKeys.has(pairKey(item.partA, item.partB)));
  for (const frame of frames) for (const pair of frame.pairs) {
    if (!pair.available || !pair.intersects || toiIntervals.some((item) => pairKey(item.partA, item.partB) === pairKey(pair.partA, pair.partB) && item.startFrame <= frame.frame && item.endFrame >= frame.frame)) continue;
    toiIntervals.push({ partA: pair.partA, partB: pair.partB, startFrame: frame.frame, endFrame: frame.frame, method: "adaptive-rotational-aabb", status: "confirmed" });
  }
  const timeOfImpact = collidingPairKeys.size ? locatePreciseCollisionTime(b.state, b.animation, toiIntervals, boxes, geometries, { maxDepth: b.toiMaxDepth, frameTolerance: b.toiFrameTolerance, maxEvaluations: b.toiMaxEvaluations }) : [];
  const toiUnresolved = collidingPairKeys.size > 0 && (timeOfImpact.length < collidingPairKeys.size || timeOfImpact.some((item) => item.status !== "collision_bracket"));
  const failureCodes: CadFailureCode[] = [
    ...(unresolved ? ["ROTATIONAL_CCD_UNRESOLVED" as const] : []),
    ...(linearUnresolved ? ["LINEAR_CCD_UNRESOLVED" as const] : []),
    ...(geometryErrors.length || unavailable
      ? ["COLLISION_GEOMETRY_MISSING" as const]
      : []),
    ...(budgetExceeded ? ["PRECISE_CCD_BUDGET_EXCEEDED" as const] : []),
    ...(toiUnresolved ? ["PRECISE_TOI_UNRESOLVED" as const] : []),
  ];
  const complete = failureCodes.length === 0,
    collisionFree =
      complete &&
      !rotationalCollision &&
      !linearCollision &&
      frames.every((f) => f.status === "passed") &&
      rotational.every((r) => !r.intersects);
  return NextResponse.json({
    ok: true,
    broad,
    ccdRecovery: ccdRecoveryEvidence,
    precise: {
      status: complete ? "completed" : "incomplete",
      collisionFree,
      geometryErrors,
      exactCadEvidence,
      failureCodes,
      recovery: failureCodes.map(cadFailureDisposition),
      frames,
      continuous: {
        rotational,
        linear: preciseLinear,
        intervals: preciseIntervals,
        timeOfImpact,
        unresolved: allPreciseIntervals.filter(
          (item) =>
            item.status === "unresolved" || item.status === "unavailable",
        ),
      },
    },
    jointEvidenceGate,
    verificationInputHash,
    releaseReady:
      collisionFree && jointEvidenceGate.manufacturingReleaseEligible,
    quoteOrRfqSideEffects: false,
  });
}
