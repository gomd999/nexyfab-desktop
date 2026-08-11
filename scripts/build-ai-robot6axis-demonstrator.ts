import { createHash } from 'node:crypto';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as verifyAssemblyPost } from '../src/app/api/cad/v1/assembly/verify/route';
import { advanceGenerationRun } from '../src/lib/ai/advanceGenerationRun';
import type { AssemblyVerifier } from '../src/lib/ai/advanceGenerationRun';
import { createGenerationRun, recordGenerationStage } from '../src/lib/ai/generationRunState';
import { generateRobot6Axis } from '../src/lib/ai/robot/robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from '../src/lib/ai/robot/robotDemonstrator';
import { verifyRobotEngineering } from '../src/lib/ai/robot/robotEngineering';
import { deriveJointSelectionRequirements } from '../src/lib/ai/robot/driveIntegration';
import {
  buildRobotCoordinatedMotionTrajectory,
  ROBOT_COORDINATED_MOTION_FRAMES,
  ROBOT_COORDINATED_MOTION_STRATEGY,
} from '../src/lib/ai/robot/robotCoordinatedMotion';
import type { HingeMate } from '../src/lib/assembly/mate';
import { writeImmutableArtifactAtomic, writeLatestArtifactAtomic } from '../src/lib/reference/immutableArtifactStore';

async function main() {
const outputDir = path.resolve(process.argv[2] ?? 'docs/evidence/ai-robot6axis-demonstrator-260809');
const designRevision = Number(process.argv[3] ?? 1);
const designLineageId = process.argv[4] ?? 'nexyfab-robot6axis-demonstrator';
if (!Number.isInteger(designRevision) || designRevision < 1 || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(designLineageId)) throw new Error('invalid demonstrator lineage or revision');
const generated = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC, 'NexyFab editable 6-axis demonstrator');
const engineering = verifyRobotEngineering(ROBOT_6AXIS_DEMONSTRATOR_SPEC);
const catalogRequirements = deriveJointSelectionRequirements(ROBOT_6AXIS_DEMONSTRATOR_SPEC, engineering);
let state = createGenerationRun('ai-robot6axis-demonstrator-v1');
for (const [stage, input, output] of [
  ['intent', ROBOT_6AXIS_DEMONSTRATOR_SPEC, { accepted: true, source: 'non-holdout-engineering-brief' }],
  ['decomposition', { requiredAxes: 6 }, { structuralParts: 7, driveComponents: 18 }],
  ['interfaces', { joints: 6 }, { hingeJoints: 6, driveMountConstraints: 54 }],
  ['part_programs', { parts: generated.program.parts.length }, { editableFeatureTrees: generated.program.parts.length }],
] as const) state = recordGenerationStage(state, { stage, input, output, status: 'passed', timestamp: '2026-08-09T00:00:00.000Z' });

let assemblyInput: Parameters<AssemblyVerifier>[0] | undefined;
const advanced = await advanceGenerationRun(state, generated.program, async input => {
  assemblyInput = input;
  const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'ai-robot6axis-demonstrator' }, body: JSON.stringify({ ...input, intendedContacts: generated.intendedContacts, interferenceWhitelist: [], allowedDoF: 6 }) }));
  return await response.json() as Record<string, unknown>;
}, 6, undefined, { diagnosticOnly: true });

const governedAxes = generated.program.assembly.mates.flatMap(mate => (
  /^J[1-6]$/.test(mate.id) && mate.kind === 'hinge' && mate.limit
    ? [{ mateId: mate.id, rangeDeg: [mate.limit.minAngleDeg, mate.limit.maxAngleDeg] as [number, number] }]
    : []
)).sort((left, right) => left.mateId.localeCompare(right.mateId));
const governedHinges = generated.program.assembly.mates
  .filter((mate): mate is HingeMate => mate.kind === 'hinge' && /^J[1-6]$/.test(mate.id))
  .sort((left, right) => left.id.localeCompare(right.id));
const coordinatedTrajectory = buildRobotCoordinatedMotionTrajectory(governedHinges);
const motionAxes = [] as Array<{
  mateId: string;
  rangeDeg: [number, number];
  allConverged: boolean;
  frameCount: number;
  checkedFrames: number;
  collisionFrameCount: number;
  segments: Array<ReturnType<typeof summarizeMotionSegment>>;
}>;
if (assemblyInput) {
  for (const axis of governedAxes) {
    const segments = [] as Array<ReturnType<typeof summarizeMotionSegment>>;
    for (const segment of [
      { direction: 'toward-min' as const, toValue: axis.rangeDeg[0] },
      { direction: 'toward-max' as const, toValue: axis.rangeDeg[1] },
    ]) {
      const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `ai-robot6axis-demonstrator-motion-${axis.mateId}` },
        body: JSON.stringify({ ...assemblyInput, intendedContacts: generated.intendedContacts, interferenceWhitelist: [], allowedDoF: 6, motion: { mateId: axis.mateId, fromValue: 0, toValue: segment.toValue, steps: 12 } }),
      }));
      segments.push(summarizeMotionSegment(segment.direction, await response.json() as Record<string, unknown>));
    }
    motionAxes.push({
      mateId: axis.mateId,
      rangeDeg: axis.rangeDeg,
      allConverged: segments.every(segment => segment.apiOk && segment.allConverged),
      frameCount: segments.reduce((sum, segment) => sum + segment.frameCount, 0),
      checkedFrames: segments.reduce((sum, segment) => sum + segment.checkedFrames, 0),
      collisionFrameCount: segments.reduce((sum, segment) => sum + segment.collisionFrameCount, 0),
      segments,
    });
  }
}
let coordinatedMotion = summarizeCoordinatedMotion(null, coordinatedTrajectory);
if (assemblyInput) {
  const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'ai-robot6axis-demonstrator-coordinated' },
    body: JSON.stringify({ ...assemblyInput, intendedContacts: generated.intendedContacts, interferenceWhitelist: [], allowedDoF: 6, motionTrajectory: coordinatedTrajectory }),
  }));
  coordinatedMotion = summarizeCoordinatedMotion(await response.json() as Record<string, unknown>, coordinatedTrajectory);
}

const programBytes = Buffer.from(`${JSON.stringify(generated.program, null, 2)}\n`);
const programSha256 = createHash('sha256').update(programBytes).digest('hex');
writeImmutableArtifactAtomic(outputDir, `editable-program-${programSha256}.json`, programBytes, 'ai_robot_program_collision');
const verification = advanced.assemblyVerification as { releaseReady?: boolean; assemblyCertificate?: { rankDoF?: number; allowedDoF?: number; dofAccepted?: boolean; intendedContactsDocumented?: boolean }; preciseInterference?: { status?: string }; flaggedInterferences?: unknown[]; code?: string; message?: string } | undefined;
const flaggedPairs = (verification?.flaggedInterferences ?? []).flatMap(item => {
  const pair = item as { partA?: unknown; partB?: unknown; penetration?: unknown };
  return typeof pair.partA === 'string' && typeof pair.partB === 'string'
    ? [{ partA: pair.partA, partB: pair.partB, penetrationMm: typeof pair.penetration === 'number' ? pair.penetration : null, category: interferenceCategory(pair.partA, pair.partB) }]
    : [];
});
const totalMotionFrames = motionAxes.reduce((sum, axis) => sum + axis.frameCount, 0);
const totalCheckedMotionFrames = motionAxes.reduce((sum, axis) => sum + axis.checkedFrames, 0);
const totalCollisionFrames = motionAxes.reduce((sum, axis) => sum + axis.collisionFrameCount, 0);
const report = {
  schema: 'nexyfab.ai-complex-product-demonstrator.v1',
  generatedAt: new Date().toISOString(),
  scoreEligible: false,
  releaseReady: false,
  policy: { holdoutAssetsUsedForGeneration: false, referenceCorpusModified: false, placeholdersAreManufacturingEvidence: false, expertApprovalGranted: false },
  product: { family: 'robot', axes: 6, lineageId: designLineageId, revision: designRevision, driveTopology: 'coaxial_parent_drive_output_link', editableParts: generated.program.parts.length, editableFeatureTrees: generated.program.parts.length, mates: generated.program.assembly.mates.length, structureGroups: generated.program.structure?.length ?? 0, unresolvedCatalogComponents: generated.pendingCatalogComponents.length, classification: generated.program.classification, programSha256, programArtifact: `editable-program-${programSha256}.json` },
  engineering: { designOk: engineering.designOk, sampledPoses: engineering.workspace.sampledPoses, selfCollisions: engineering.selfCollision.count, singularSamples: engineering.singularities.count, torquePassed: engineering.torque.filter(item => item.passed).length, cablePassed: engineering.cables.filter(item => item.bendPassed && item.twistPassed).length },
  catalogSelection: {
    requirementsReady: catalogRequirements.ok,
    requirements: catalogRequirements.ok ? catalogRequirements.requirements : [],
    errors: catalogRequirements.ok ? [] : catalogRequirements.errors,
    productionEvidencePolicy: { fullSha256Required: true, artifactRecordRequired: true, confirmedMassRequired: true },
    actualArtifactBytesVerified: false,
    selectionStatus: 'not_run',
    reason: 'no externally traceable production component catalog supplied',
  },
  housingFit: {
    status: 'not_run',
    reason: 'housing fit runs only after traceable motor, reducer and bearing selections plus traceable internal housing capacities exist',
  },
  pipeline: { stoppedAt: advanced.stoppedAt, stages: Object.fromEntries(Object.entries(advanced.state.stages).map(([id, item]) => [id, { status: item.status, errorCodes: item.errorCodes, metrics: item.metrics }])) },
  assembly: { verifierReturned: Boolean(verification), releaseReady: verification?.releaseReady === true, intendedContacts: generated.intendedContacts, releaseContactCount: generated.intendedContacts.length, certificate: verification?.assemblyCertificate ?? null, preciseInterferenceStatus: verification?.preciseInterference?.status ?? null, flaggedInterferences: verification?.flaggedInterferences?.length ?? 0, code: verification?.code ?? null, message: verification?.message ?? null, verdict: 'solver convergence alone is insufficient; degrees of freedom and every non-whitelisted precise interference must pass' },
  interferenceAnalysis: {
    categories: Object.fromEntries(['structural-structural', 'drive-structural', 'drive-drive'].map(category => [category, flaggedPairs.filter(pair => pair.category === category).length])),
    pairs: flaggedPairs,
  },
  motionStudy: {
    exploratoryOnly: true,
    releaseEvidence: false,
    diagnosticScope: 'all_governed_axes_zero_to_each_limit',
    axisCount: motionAxes.length,
    stepsPerSegment: 12,
    allConverged: motionAxes.length === 6 && motionAxes.every(axis => axis.allConverged),
    frameCount: totalMotionFrames,
    checkedFrames: totalCheckedMotionFrames,
    collisionFrameCount: totalCollisionFrames,
    axes: motionAxes,
  },
  coordinatedMotionStudy: coordinatedMotion,
  blockers: [...generated.pendingCatalogComponents, 'signed_governed_motion_release_evidence_required', 'manufacturing_not_run', 'step_roundtrip_not_run', 'expert_review_not_run'],
};
const invariantChecks = {
  editable_parts_25: report.product.editableParts === 25,
  mates_60: report.product.mates === 60,
  kernel_passed: report.pipeline.stages.kernel?.status === 'passed',
  topology_passed: report.pipeline.stages.topology?.status === 'passed',
  rank_dof_6: verification?.assemblyCertificate?.rankDoF === 6,
  allowed_dof_6: verification?.assemblyCertificate?.allowedDoF === 6,
  dof_accepted: verification?.assemblyCertificate?.dofAccepted === true,
  intended_contacts_documented: verification?.assemblyCertificate?.intendedContactsDocumented === true && report.assembly.releaseContactCount === 24,
  no_static_interference: flaggedPairs.length === 0,
  no_structural_interference: report.interferenceAnalysis.categories['structural-structural'] === 0,
  governed_motion_axes_6: report.motionStudy.axisCount === 6 && report.motionStudy.axes.map(axis => axis.mateId).join(',') === 'J1,J2,J3,J4,J5,J6',
  governed_motion_converged: report.motionStudy.allConverged === true,
  governed_motion_frames_156: report.motionStudy.frameCount === 156 && report.motionStudy.checkedFrames === 156,
  governed_motion_collision_free: report.motionStudy.collisionFrameCount === 0,
  coordinated_motion_strategy: report.coordinatedMotionStudy.strategy === ROBOT_COORDINATED_MOTION_STRATEGY,
  coordinated_motion_converged: report.coordinatedMotionStudy.apiOk === true && report.coordinatedMotionStudy.allConverged === true,
  coordinated_motion_frames_49: report.coordinatedMotionStudy.frameCount === ROBOT_COORDINATED_MOTION_FRAMES && report.coordinatedMotionStudy.checkedFrames === ROBOT_COORDINATED_MOTION_FRAMES,
  coordinated_motion_collision_free: report.coordinatedMotionStudy.collisionFrameCount === 0,
  catalog_requirements_ready: report.catalogSelection.requirementsReady === true && report.catalogSelection.requirements.length === 6,
  catalog_selection_not_run: report.catalogSelection.selectionStatus === 'not_run' && report.catalogSelection.actualArtifactBytesVerified === false,
  housing_fit_not_run: report.housingFit.status === 'not_run',
  release_not_claimed: report.releaseReady === false && report.assembly.releaseReady === false,
};
const invariantFailures = Object.entries(invariantChecks).filter(([, passed]) => !passed).map(([name]) => name);
if (invariantFailures.length) {
  throw new Error(`ai_robot_demonstrator_invariant_failed: ${invariantFailures.join(', ')}; ${JSON.stringify({ rankDoF: verification?.assemblyCertificate?.rankDoF, flaggedInterferences: flaggedPairs.length, interferencePairs: flaggedPairs.map(pair => `${pair.partA}::${pair.partB}`), motionAxes: report.motionStudy.axes.map(axis => ({ mateId: axis.mateId, converged: axis.allConverged, frames: axis.frameCount, checked: axis.checkedFrames, collisions: axis.collisionFrameCount, segments: axis.segments })), collisionFrames: report.motionStudy.collisionFrameCount, coordinatedMotion: report.coordinatedMotionStudy })}`);
}
writeLatestArtifactAtomic(path.join(outputDir, 'report.json'), Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
console.log(JSON.stringify({ output: path.relative(process.cwd(), outputDir), parts: report.product.editableParts, mates: report.product.mates, kernel: report.pipeline.stages.kernel.status, topology: report.pipeline.stages.topology.status, assembly: report.pipeline.stages.assembly_solve.status, releaseReady: report.releaseReady }));
}

function summarizeMotionSegment(direction: 'toward-min' | 'toward-max', verification: Record<string, unknown>) {
  const motion = verification.motion as { allConverged?: boolean; firstFailureFrame?: number; frames?: unknown[] } | undefined;
  const interference = verification.motionInterference as { checkedFrames?: number; collisionFrameCount?: number; firstCollisionFrame?: number; maxPenetrationMm?: number; frames?: Array<{ frame?: number; parameterValue?: number; pairs?: Array<{ partA?: string; partB?: string; penetration?: number }> }> } | undefined;
  const frameCount = motion?.frames?.length ?? 0;
  const firstFailureFrame = typeof motion?.firstFailureFrame === 'number' && motion.firstFailureFrame >= 0 ? motion.firstFailureFrame : null;
  const firstCollisionFrame = typeof interference?.firstCollisionFrame === 'number' && interference.firstCollisionFrame >= 0 ? interference.firstCollisionFrame : null;
  const collisionPairs = [...new Map((interference?.frames ?? []).flatMap(frame => (frame.pairs ?? []).flatMap(pair => (
    typeof pair.partA === 'string' && typeof pair.partB === 'string'
      ? [[`${pair.partA}::${pair.partB}`, { partA: pair.partA, partB: pair.partB, penetrationMm: typeof pair.penetration === 'number' ? pair.penetration : null }]] as const
      : []
  )))).values()];
  return {
    direction,
    apiOk: verification.ok === true,
    allConverged: motion?.allConverged === true,
    frameCount,
    checkedFrames: interference?.checkedFrames ?? 0,
    collisionFrameCount: interference?.collisionFrameCount ?? 0,
    firstFailureFrame,
    firstCollisionFrame,
    maxPenetrationMm: interference?.maxPenetrationMm ?? null,
    collisionPairs,
  };
}

function summarizeCoordinatedMotion(
  verification: Record<string, unknown> | null,
  trajectory: ReturnType<typeof buildRobotCoordinatedMotionTrajectory>,
) {
  const motion = verification?.motion as { allConverged?: boolean; firstFailureFrame?: number; frames?: unknown[] } | undefined;
  const interference = verification?.motionInterference as { checkedFrames?: number; collisionFrameCount?: number; firstCollisionFrame?: number; maxPenetrationMm?: number; frames?: Array<{ pairs?: Array<{ partA?: string; partB?: string; penetration?: number }> }> } | undefined;
  const collisionPairs = [...new Map((interference?.frames ?? []).flatMap(frame => (frame.pairs ?? []).flatMap(pair => (
    typeof pair.partA === 'string' && typeof pair.partB === 'string'
      ? [[`${pair.partA}::${pair.partB}`, { partA: pair.partA, partB: pair.partB, penetrationMm: typeof pair.penetration === 'number' ? pair.penetration : null }]] as const
      : []
  )))).values()];
  const firstFailureFrame = typeof motion?.firstFailureFrame === 'number' && motion.firstFailureFrame >= 0 ? motion.firstFailureFrame : null;
  const firstCollisionFrame = typeof interference?.firstCollisionFrame === 'number' && interference.firstCollisionFrame >= 0 ? interference.firstCollisionFrame : null;
  return {
    exploratoryOnly: true,
    releaseEvidence: false,
    strategy: ROBOT_COORDINATED_MOTION_STRATEGY,
    mateIds: trajectory.mateIds,
    keyframesDeg: trajectory.keyframes,
    stepsPerSegment: trajectory.stepsPerSegment,
    apiOk: verification?.ok === true,
    allConverged: motion?.allConverged === true,
    frameCount: motion?.frames?.length ?? 0,
    checkedFrames: interference?.checkedFrames ?? 0,
    collisionFrameCount: interference?.collisionFrameCount ?? 0,
    firstFailureFrame,
    firstCollisionFrame,
    maxPenetrationMm: interference?.maxPenetrationMm ?? null,
    collisionPairs,
  };
}

function interferenceCategory(partA: string, partB: string) {
  const driveA = partA.startsWith('J');
  const driveB = partB.startsWith('J');
  if (driveA && driveB) return 'drive-drive';
  if (driveA || driveB) return 'drive-structural';
  return 'structural-structural';
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
