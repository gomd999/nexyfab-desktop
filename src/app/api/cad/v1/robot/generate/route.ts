import { NextRequest, NextResponse } from 'next/server';
import { generateRobot6Axis } from '@/lib/ai/robot/robotGenerator';
import { verifyRobotEngineering, type RobotEngineeringSpec } from '@/lib/ai/robot/robotEngineering';
import { selectRobotDriveTrain } from '@/lib/ai/robot/componentSelector';
import type { CatalogComponent } from '@/lib/ai/robot/componentCatalog';
import { buildReachabilityMap, type RobotTargetPose } from '@/lib/ai/robot/robotIk';
import { planCartesianRobotPath } from '@/lib/ai/robot/robotPathPlanning';
import { verifyCableRoutes, type CableRoute, type KeepOutSphere } from '@/lib/ai/robot/robotCableRouting';
import { verifyServiceEnvelopes, type ServiceEnvelope, type ServiceObstacle } from '@/lib/ai/robot/robotServiceEnvelope';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-robot-generate:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { name?: string; spec?: RobotEngineeringSpec; catalog?: CatalogComponent[]; targets?: RobotTargetPose[]; path?: RobotTargetPose[]; cableRoutes?:CableRoute[]; cableKeepOut?:KeepOutSphere[]; serviceEnvelopes?:ServiceEnvelope[]; serviceObstacles?:ServiceObstacle[] } | null;
  if (!body?.spec || !Array.isArray(body.spec.joints)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'spec.joints is required' }, { status: 400 });
  if (body.targets && (!Array.isArray(body.targets) || body.targets.length > 200)) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'targets is limited to 200 poses' }, { status: 413 });
  if (body.path && (!Array.isArray(body.path) || body.path.length > 2000)) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'path is limited to 2000 waypoints' }, { status: 413 });
  try {
    const engineering = verifyRobotEngineering(body.spec);
    const selectionRequirements = body.spec.joints.map((joint, index) => joint.requiredOutputRpm && joint.radialLoadN && joint.minShaftDiameterMm ? ({ joint: index + 1, requiredOutputTorqueNm: engineering.torque[index]!.requiredNm, requiredOutputRpm: joint.requiredOutputRpm, radialLoadN: joint.radialLoadN, minShaftDiameterMm: joint.minShaftDiameterMm }) : null);
    const missingSelectionInputs = selectionRequirements.flatMap((value, index) => value ? [] : [`J${index + 1}: requiredOutputRpm, radialLoadN and minShaftDiameterMm are required for catalog selection.`]);
    const selection = body.catalog && missingSelectionInputs.length === 0 ? selectRobotDriveTrain(selectionRequirements.filter((value): value is NonNullable<typeof value> => value !== null), body.catalog) : null;
    const generated = generateRobot6Axis(body.spec, body.name, selection?.ok ? selection.selections : []);
    const releaseBlockers = [...generated.pendingCatalogComponents, ...missingSelectionInputs, ...(selection && !selection.ok ? selection.errors : [])];
    const reachability = body.targets?.length ? buildReachabilityMap(body.spec, body.targets) : null;
    const path = body.path?.length ? planCartesianRobotPath(body.spec, body.path) : null;
    if (path && !path.collisionVerified) releaseBlockers.push('Continuous path collision verification requires precise geometry.');
    const cableRouting = body.cableRoutes ? verifyCableRoutes(body.cableRoutes,body.cableKeepOut) : null;
    const serviceEnvelope = verifyServiceEnvelopes(body.serviceEnvelopes??[],body.serviceObstacles??[]);
    if(!cableRouting?.length || cableRouting.some(route=>!route.passed)) releaseBlockers.push('Verified 3D cable routing is required.');
    if(!serviceEnvelope.clear) releaseBlockers.push('Verified clear service envelopes are required.');
    return NextResponse.json({ ok: true, ...generated, engineering, selection, reachability, path, cableRouting, serviceEnvelope, releaseReady: false, releaseBlockers:[...new Set(releaseBlockers)], quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'INVALID_ROBOT', message: error instanceof Error ? error.message : 'invalid robot' }, { status: 422 });
  }
}
