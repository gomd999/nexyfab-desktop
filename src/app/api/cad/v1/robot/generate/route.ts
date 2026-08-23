import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { generateRobot6Axis } from '@/lib/ai/robot/robotGenerator';
import { verifyRobotEngineering, type RobotEngineeringSpec } from '@/lib/ai/robot/robotEngineering';
import { selectRobotDriveTrain } from '@/lib/ai/robot/componentSelector';
import type { CatalogComponent } from '@/lib/ai/robot/componentCatalog';
import { buildReachabilityMap, type RobotTargetPose } from '@/lib/ai/robot/robotIk';
import { planCartesianRobotPath } from '@/lib/ai/robot/robotPathPlanning';
import { verifyCableRoutes, type CableRoute, type KeepOutSphere } from '@/lib/ai/robot/robotCableRouting';
import { verifyServiceEnvelopes, type ServiceEnvelope, type ServiceObstacle } from '@/lib/ai/robot/robotServiceEnvelope';
import { deriveJointSelectionRequirements } from '@/lib/ai/robot/driveIntegration';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { buildAdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import { createGenerationRun, recordGenerationStage } from '@/lib/ai/generationRunState';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-robot-generate:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: { name?: string; spec?: RobotEngineeringSpec; catalog?: CatalogComponent[]; targets?: RobotTargetPose[]; path?: RobotTargetPose[]; cableRoutes?:CableRoute[]; cableKeepOut?:KeepOutSphere[]; serviceEnvelopes?:ServiceEnvelope[]; serviceObstacles?:ServiceObstacle[] } | null;
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'Robot generation request is too large' }, { status: 413 });
    body = null;
  }
  if (!body?.spec || !Array.isArray(body.spec.joints)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'spec.joints is required' }, { status: 400 });
  if (body.targets && (!Array.isArray(body.targets) || body.targets.length > 200)) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'targets is limited to 200 poses' }, { status: 413 });
  if (body.path && (!Array.isArray(body.path) || body.path.length > 2000)) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'path is limited to 2000 waypoints' }, { status: 413 });
  try {
    const engineering = verifyRobotEngineering(body.spec);
    const requirementDerivation = deriveJointSelectionRequirements(body.spec, engineering);
    const missingSelectionInputs = requirementDerivation.ok ? [] : requirementDerivation.errors;
    const selection = body.catalog && requirementDerivation.ok ? selectRobotDriveTrain(requirementDerivation.requirements, body.catalog) : null;
    const generated = generateRobot6Axis(body.spec, body.name, selection?.ok ? selection.selections : []);
    let generationState = createGenerationRun(`robot-${randomUUID()}`);
    const timestamp = new Date().toISOString();
    const checkpoints = [
      { stage: 'intent' as const, input: body.spec, output: { name: body.name ?? generated.program.name, objective: 'complete_manufacturing_product' } },
      { stage: 'decomposition' as const, input: generated.program.name, output: generated.program.parts.map(part => ({ instanceId: part.instanceId, definitionId: part.definitionId })) },
      { stage: 'interfaces' as const, input: generated.program.assembly.parts, output: generated.program.assembly.mates },
      { stage: 'part_programs' as const, input: generated.program.parts.map(part => part.instanceId), output: generated.program.parts.map(part => ({ instanceId: part.instanceId, featureTree: part.featureTree })) },
    ];
    for (const checkpoint of checkpoints) generationState = recordGenerationStage(generationState, { ...checkpoint, status: 'passed', timestamp });
    const executionPlan = buildAdaptiveComplexProductExecutionPlan(generationState);
    const releaseBlockers = [...generated.pendingCatalogComponents, ...missingSelectionInputs, ...(selection && !selection.ok ? selection.errors : [])];
    if (body.catalog) releaseBlockers.push('Production catalog artifact bytes must be validated by the offline manifest gate; request-body catalog selection is preview-only.');
    const reachability = body.targets?.length ? buildReachabilityMap(body.spec, body.targets) : null;
    const path = body.path?.length ? planCartesianRobotPath(body.spec, body.path) : null;
    if (path && !path.collisionVerified) releaseBlockers.push('Continuous path collision verification requires precise geometry.');
    const cableRouting = body.cableRoutes ? verifyCableRoutes(body.cableRoutes,body.cableKeepOut) : null;
    const serviceEnvelope = verifyServiceEnvelopes(body.serviceEnvelopes??[],body.serviceObstacles??[]);
    if(!cableRouting?.length || cableRouting.some(route=>!route.passed)) releaseBlockers.push('Verified 3D cable routing is required.');
    if(!serviceEnvelope.clear) releaseBlockers.push('Verified clear service envelopes are required.');
    return NextResponse.json({ ok: true, productObjective: 'complete_manufacturing_product', generationState, executionPlan, ...generated, engineering, selectionRequirements: requirementDerivation, selection, catalogEvidence: { status: body.catalog ? 'unverified_request_payload' : 'not_supplied', previewOnly: true, productionEligible: false }, housingFit: { status: 'not_run', reason: 'Traceable production-eligible component selections and artifact-bound housing capacities are required.' }, reachability, path, cableRouting, serviceEnvelope, releaseReady: false, releaseBlockers:[...new Set(releaseBlockers)], quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'INVALID_ROBOT', message: error instanceof Error ? error.message : 'invalid robot' }, { status: 422 });
  }
}
