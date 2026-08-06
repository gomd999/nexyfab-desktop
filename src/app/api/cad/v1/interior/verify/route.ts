import { NextRequest, NextResponse } from 'next/server';
import { verifyDoorSwingClearance, type DoorSwingClearanceInput } from '@/lib/assembly/doorSwingClearance';
import { validateArchitectureDocument, validateInteriorDocument, type ArchitectureDocument, type InteriorDocument } from '@/lib/ai/architectureInteriorDocuments';
import { buildDoorSwingInput, verifyInteriorLighting, type LightingRule } from '@/lib/ai/interiorSpatialSystems';
import { verifyExactFurnitureClearance } from '@/lib/ai/interiorFurnitureGeometry';
import { verifyPolygonInteriorRoute } from '@/lib/ai/interiorPolygonRoute';
import { calculateIesIlluminance, parseIesLm63, type IlluminanceCalculation } from '@/lib/ai/iesPhotometricCalculation';
import { verifyMepConnections, type EquipmentPort, type MepConnection, type MepConnectionRules, type MepNode, type MepRun } from '@/lib/ai/mepConnectionVerification';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-interior-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { architecture?: ArchitectureDocument; interior?: InteriorDocument; spaceId?: string; route?: { originMm: [number, number]; destinationMm: [number, number]; maximumDistanceMm: number }; door?: { id: string; obstacles: DoorSwingClearanceInput['obstacles'] }; lightingRule?: LightingRule; iesProfiles?: Record<string, string>; workplaneHeightMm?: number; gridSpacingMm?: number; mep?: { ports: EquipmentPort[]; nodes: MepNode[]; connections: MepConnection[]; runs: MepRun[]; rules?: MepConnectionRules } } | null;
  if (!body?.architecture || !body.interior || !body.spaceId) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'architecture, interior, and spaceId are required' }, { status: 400 });
  const issues = [...validateArchitectureDocument(body.architecture), ...validateInteriorDocument(body.interior, body.architecture)];
  if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_MODEL', issues, releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  const space = body.architecture.spaces.find(item => item.id === body.spaceId);
  if (!space) return NextResponse.json({ ok: false, code: 'UNKNOWN_SPACE', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  const route = body.route ? verifyPolygonInteriorRoute(body.architecture, body.interior, body.spaceId, body.route.originMm, body.route.destinationMm, body.route.maximumDistanceMm) : { status: 'not_run' as const, reason: 'Governed route request is missing.' };
  const doorInput = body.door ? buildDoorSwingInput(body.architecture, body.door.id, body.door.obstacles) : null;
  const doorSwing = doorInput ? verifyDoorSwingClearance(doorInput) : { status: 'not_run' as const, reason: 'Explicit door operation or obstacle geometry is missing.' };
  const doorCollisionIds = 'collidingObstacleIds' in doorSwing ? doorSwing.collidingObstacleIds : [];
  const furniture = verifyExactFurnitureClearance(body.architecture, body.interior, body.spaceId, doorCollisionIds);
  let photometric: IlluminanceCalculation | undefined;
  try {
    if (body.lightingRule?.requirePhotometricEvidence && body.iesProfiles) {
      const preview = verifyInteriorLighting(body.interior, body.spaceId, space.boundaryMm, { ...body.lightingRule, requirePhotometricEvidence: false }, body.gridSpacingMm);
      const profiles = new Map(Object.entries(body.iesProfiles).map(([id, source]) => [id, parseIesLm63(id, source)]));
      const lights = body.interior.lights.filter(light => light.spaceId === body.spaceId).map(light => { if (!light.iesProfileId) throw new Error(`${light.id}: IES profile id is missing.`); return { id: light.id, positionMm: light.positionMm, iesProfileId: light.iesProfileId, yawDeg: light.yawDeg, worldToPhotometricQuaternion: light.worldToPhotometricQuaternion }; });
      photometric = calculateIesIlluminance(lights, preview.calculationPoints, body.workplaneHeightMm ?? 800, profiles);
    }
  } catch (error) { return NextResponse.json({ ok: false, code: 'INVALID_PHOTOMETRIC_EVIDENCE', message: error instanceof Error ? error.message : 'IES calculation failed.', releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 }); }
  const lighting = verifyInteriorLighting(body.interior, body.spaceId, space.boundaryMm, body.lightingRule, body.gridSpacingMm, photometric);
  const mep = body.mep ? verifyMepConnections(body.mep.ports, body.mep.nodes, body.mep.connections, body.mep.runs, body.mep.rules) : { status: 'not_run' as const, failures: [], method: 'explicit_port_network' as const };
  const releaseReady = route.status === 'passed' && 'clear' in doorSwing && doorSwing.clear && furniture.status === 'passed' && lighting.status === 'passed' && mep.status === 'passed';
  return NextResponse.json({ ok: true, releaseReady, route, doorSwing, furniture, lighting, mep, quoteOrRfqSideEffects: false });
}
