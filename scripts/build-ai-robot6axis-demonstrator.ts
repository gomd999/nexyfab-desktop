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
  const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'ai-robot6axis-demonstrator' }, body: JSON.stringify({ ...input, intendedContacts: [], interferenceWhitelist: [], allowedDoF: 6 }) }));
  return await response.json() as Record<string, unknown>;
}, 6);

const motionResponse = assemblyInput
  ? await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'ai-robot6axis-demonstrator-motion' },
      body: JSON.stringify({ ...assemblyInput, intendedContacts: [], interferenceWhitelist: [], allowedDoF: 6, motion: { mateId: 'J1', fromValue: -45, toValue: 45, steps: 12 } }),
    }))
  : undefined;
const motionVerification = motionResponse ? await motionResponse.json() as Record<string, unknown> : undefined;

const programBytes = Buffer.from(`${JSON.stringify(generated.program, null, 2)}\n`);
const programSha256 = createHash('sha256').update(programBytes).digest('hex');
writeImmutableArtifactAtomic(outputDir, `editable-program-${programSha256}.json`, programBytes, 'ai_robot_program_collision');
const verification = advanced.assemblyVerification as { releaseReady?: boolean; assemblyCertificate?: { rankDoF?: number; allowedDoF?: number; dofAccepted?: boolean }; preciseInterference?: { status?: string }; flaggedInterferences?: unknown[]; code?: string; message?: string } | undefined;
const flaggedPairs = (verification?.flaggedInterferences ?? []).flatMap(item => {
  const pair = item as { partA?: unknown; partB?: unknown; penetration?: unknown };
  return typeof pair.partA === 'string' && typeof pair.partB === 'string'
    ? [{ partA: pair.partA, partB: pair.partB, penetrationMm: typeof pair.penetration === 'number' ? pair.penetration : null, category: interferenceCategory(pair.partA, pair.partB) }]
    : [];
});
const motion = motionVerification?.motion as { allConverged?: boolean; firstFailureFrame?: number; frames?: Array<{ index?: number; parameterValue?: number; solve?: { success?: boolean; iterations?: number; finalMaxResidual?: number; residuals?: Array<{ mateId?: string; supported?: boolean; value?: number }> } }> } | undefined;
const motionInterference = motionVerification?.motionInterference as { checkedFrames?: number; collisionFrameCount?: number; firstCollisionFrame?: number; maxPenetrationMm?: number } | undefined;
const report = {
  schema: 'nexyfab.ai-complex-product-demonstrator.v1',
  generatedAt: new Date().toISOString(),
  scoreEligible: false,
  releaseReady: false,
  policy: { holdoutAssetsUsedForGeneration: false, referenceCorpusModified: false, placeholdersAreManufacturingEvidence: false, expertApprovalGranted: false },
  product: { family: 'robot', axes: 6, lineageId: designLineageId, revision: designRevision, editableParts: generated.program.parts.length, editableFeatureTrees: generated.program.parts.length, mates: generated.program.assembly.mates.length, structureGroups: generated.program.structure?.length ?? 0, unresolvedCatalogComponents: generated.pendingCatalogComponents.length, classification: generated.program.classification, programSha256, programArtifact: `editable-program-${programSha256}.json` },
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
  assembly: { verifierReturned: Boolean(verification), releaseReady: verification?.releaseReady === true, certificate: verification?.assemblyCertificate ?? null, preciseInterferenceStatus: verification?.preciseInterference?.status ?? null, flaggedInterferences: verification?.flaggedInterferences?.length ?? 0, code: verification?.code ?? null, message: verification?.message ?? null, verdict: 'solver convergence alone is insufficient; degrees of freedom and every non-whitelisted precise interference must pass' },
  interferenceAnalysis: {
    categories: Object.fromEntries(['structural-structural', 'drive-structural', 'drive-drive'].map(category => [category, flaggedPairs.filter(pair => pair.category === category).length])),
    pairs: flaggedPairs,
  },
  motionStudy: {
    exploratoryOnly: true,
    releaseEvidence: false,
    mateId: 'J1',
    rangeDeg: [-45, 45],
    steps: 12,
    apiOk: motionVerification?.ok === true,
    allConverged: motion?.allConverged === true,
    firstFailureFrame: motion?.firstFailureFrame ?? null,
    frameCount: motion?.frames?.length ?? 0,
    frames: (motion?.frames ?? []).map(frame => ({
      index: frame.index ?? null,
      parameterValue: frame.parameterValue ?? null,
      success: frame.solve?.success === true,
      iterations: frame.solve?.iterations ?? null,
      finalMaxResidual: frame.solve?.finalMaxResidual ?? null,
      unsupportedMateIds: (frame.solve?.residuals ?? []).filter(residual => residual.supported === false).map(residual => residual.mateId).filter((id): id is string => typeof id === 'string'),
    })),
    checkedFrames: motionInterference?.checkedFrames ?? 0,
    collisionFrameCount: motionInterference?.collisionFrameCount ?? 0,
    firstCollisionFrame: motionInterference?.firstCollisionFrame ?? null,
    maxPenetrationMm: motionInterference?.maxPenetrationMm ?? null,
    code: motionVerification?.code ?? null,
    message: motionVerification?.message ?? null,
  },
  blockers: [...generated.pendingCatalogComponents, 'motion_study_not_run', 'manufacturing_not_run', 'step_roundtrip_not_run', 'expert_review_not_run'],
};
if (
  report.product.editableParts !== 25
  || report.product.mates !== 60
  || report.pipeline.stages.kernel?.status !== 'passed'
  || report.pipeline.stages.topology?.status !== 'passed'
  || verification?.assemblyCertificate?.rankDoF !== 6
  || verification.assemblyCertificate.allowedDoF !== 6
  || verification.assemblyCertificate.dofAccepted !== true
  || flaggedPairs.length > 22
  || report.interferenceAnalysis.categories['structural-structural'] !== 0
  || report.motionStudy.allConverged !== true
  || report.motionStudy.frameCount !== 13
  || report.motionStudy.collisionFrameCount < 1
  || report.catalogSelection.requirementsReady !== true
  || report.catalogSelection.requirements.length !== 6
  || report.catalogSelection.selectionStatus !== 'not_run'
  || report.catalogSelection.actualArtifactBytesVerified !== false
  || report.housingFit.status !== 'not_run'
  || report.releaseReady
  || report.assembly.releaseReady
) throw new Error('ai_robot_demonstrator_invariant_failed');
writeLatestArtifactAtomic(path.join(outputDir, 'report.json'), Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
console.log(JSON.stringify({ output: path.relative(process.cwd(), outputDir), parts: report.product.editableParts, mates: report.product.mates, kernel: report.pipeline.stages.kernel.status, topology: report.pipeline.stages.topology.status, assembly: report.pipeline.stages.assembly_solve.status, releaseReady: report.releaseReady }));
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
