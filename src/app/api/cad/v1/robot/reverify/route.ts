import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { POST as verifyAssemblyPost } from '@/app/api/cad/v1/assembly/verify/route';
import { advanceGenerationRun } from '@/lib/ai/advanceGenerationRun';
import type { AssemblyVerifier } from '@/lib/ai/advanceGenerationRun';
import { createGenerationRun, recordGenerationStage } from '@/lib/ai/generationRunState';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '@/lib/ai/aiAssemblyProgram';
import type { AiAssemblyRevisionPackage } from '@/lib/ai/aiAssemblyRevision';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import type { HingeMate } from '@/lib/assembly/mate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const SHA256 = /^[a-f0-9]{64}$/;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  // One accepted package fans out to 12 governed motion sweeps. Keep the
  // outer budget aligned with the assembly verifier's 60 requests/minute.
  if (!(await rateLimitAsync(`cad-v1-robot-reverify:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const programFile = form?.get('program'); const manifestFile = form?.get('manifest');
  if (!(programFile instanceof File) || !(manifestFile instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'program and manifest files are required' }, { status: 400 });
  if (programFile.size < 1 || programFile.size > 50_000_000 || manifestFile.size < 1 || manifestFile.size > 1_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  try {
    const programBytes = Buffer.from(await programFile.arrayBuffer());
    const manifestBytes = Buffer.from(await manifestFile.arrayBuffer());
    const manifest = parseJson(manifestBytes, 'manifest') as AiAssemblyRevisionPackage;
    validateRevisionManifest(manifest, programBytes);
    const program = parseJson(programBytes, 'program') as AiAssemblyProgram;
    const issues = validateAiAssemblyProgram(program);
    if (issues.length) throw new Error(`invalid program: ${issues[0]!.path}: ${issues[0]!.message}`);
    const governedHinges = validateSixAxisRobot(program);
    const motionRanges = Object.fromEntries(governedHinges.map(mate => [mate.id, { min: mate.limit!.minAngleDeg, max: mate.limit!.maxAngleDeg }]));
    const motionSweeps = governedHinges.flatMap(mate => [
      { mateId: mate.id, direction: 'toward-min' as const, fromValue: 0, toValue: mate.limit!.minAngleDeg },
      { mateId: mate.id, direction: 'toward-max' as const, fromValue: 0, toValue: mate.limit!.maxAngleDeg },
    ]);

    let state = createGenerationRun(`robot-reverify:${manifest.lineageId}:r${manifest.revision}`);
    for (const stage of ['intent', 'decomposition', 'interfaces', 'part_programs'] as const) state = recordGenerationStage(state, { stage, input: { lineageId: manifest.lineageId, revision: manifest.revision }, output: { accepted: true }, status: 'passed' });
    let assemblyInput: Parameters<AssemblyVerifier>[0] | undefined;
    const advanced = await advanceGenerationRun(state, program, async input => {
      assemblyInput = input;
      const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ ...input, allowedDoF: 6, intendedContacts: [], interferenceWhitelist: [], motion: { ...motionSweeps[0]!, steps: 12 } }) }));
      return await response.json() as Record<string, unknown>;
    }, 6, undefined, { diagnosticOnly: true });
    type Verification = { ok?: boolean; releaseReady?: boolean; assemblyCertificate?: unknown; preciseInterference?: { status?: string }; flaggedInterferences?: unknown[]; motion?: { allConverged?: boolean; firstFailureFrame?: number; frames?: unknown[] }; motionInterference?: { checkedFrames?: number; collisionFrameCount?: number; firstCollisionFrame?: number; maxPenetrationMm?: number }; code?: string; message?: string };
    const verification = advanced.assemblyVerification as Verification | undefined;
    const motionVerifications: Verification[] = verification ? [verification] : [];
    if (assemblyInput) for (const sweep of motionSweeps.slice(1)) {
      const response = await verifyAssemblyPost(new NextRequest('http://localhost/api/cad/v1/assembly/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ ...assemblyInput, allowedDoF: 6, intendedContacts: [], interferenceWhitelist: [], motion: { ...sweep, steps: 12 } }) }));
      motionVerifications.push(await response.json() as Verification);
    }
    const motionAxes = governedHinges.map((mate, axisIndex) => {
      const items = motionVerifications.slice(axisIndex * 2, axisIndex * 2 + 2);
      const segments = items.map((item, segmentIndex) => ({
        direction: segmentIndex === 0 ? 'toward-min' : 'toward-max', apiOk: item?.ok === true, allConverged: item?.motion?.allConverged === true,
        frameCount: item?.motion?.frames?.length ?? 0, checkedFrames: item?.motionInterference?.checkedFrames ?? 0, collisionFrameCount: item?.motionInterference?.collisionFrameCount ?? 0,
        firstFailureFrame: typeof item?.motion?.firstFailureFrame === 'number' && item.motion.firstFailureFrame >= 0 ? item.motion.firstFailureFrame : null,
        firstCollisionFrame: typeof item?.motionInterference?.firstCollisionFrame === 'number' && item.motionInterference.firstCollisionFrame >= 0 ? item.motionInterference.firstCollisionFrame : null,
        maxPenetrationMm: typeof item?.motionInterference?.maxPenetrationMm === 'number' && item.motionInterference.maxPenetrationMm >= 0 ? item.motionInterference.maxPenetrationMm : null,
        code: item?.code ?? null, message: item?.message ?? null,
      }));
      return { mateId: mate.id, rangeDeg: [motionRanges[mate.id]!.min, motionRanges[mate.id]!.max], apiOk: segments.length === 2 && segments.every(segment => segment.apiOk), allConverged: segments.length === 2 && segments.every(segment => segment.allConverged), frameCount: segments.reduce((sum, segment) => sum + segment.frameCount, 0), checkedFrames: segments.reduce((sum, segment) => sum + segment.checkedFrames, 0), collisionFrameCount: segments.reduce((sum, segment) => sum + segment.collisionFrameCount, 0), segments };
    });
    const motionComplete = motionVerifications.length === 12 && motionAxes.every(axis => axis.apiOk && axis.allConverged && axis.frameCount === 26 && axis.checkedFrames === axis.frameCount);
    const motionCollisionFrames = motionAxes.reduce((sum, axis) => sum + axis.collisionFrameCount, 0);
    const pairs = (verification?.flaggedInterferences ?? []).flatMap((raw) => {
      const pair = raw as { partA?: unknown; partB?: unknown; penetration?: unknown };
      return typeof pair.partA === 'string' && typeof pair.partB === 'string' ? [{ partA: pair.partA, partB: pair.partB, penetrationMm: typeof pair.penetration === 'number' ? pair.penetration : null, category: category(pair.partA, pair.partB) }] : [];
    });
    const report = {
      schema: 'nexyfab.ai-complex-product-demonstrator.v1', generatedAt: new Date().toISOString(), scoreEligible: false, releaseReady: false,
      policy: { holdoutAssetsUsedForGeneration: false, referenceCorpusModified: false, placeholdersAreManufacturingEvidence: false, expertApprovalGranted: false },
      product: { family: 'robot', axes: 6, lineageId: manifest.lineageId, revision: manifest.revision, editableParts: program.parts.length, editableFeatureTrees: program.parts.length, mates: program.assembly.mates.length, structureGroups: program.structure?.length ?? 0, unresolvedCatalogComponents: program.unresolved.length, classification: program.classification, programSha256: manifest.programHash, programArtifact: manifest.programArtifact },
      catalogSelection: { requirementsReady: false, requirements: [], errors: ['engineering selection requirements must be rebound after CAD revision'], productionEvidencePolicy: { fullSha256Required: true, artifactRecordRequired: true, confirmedMassRequired: true }, actualArtifactBytesVerified: false, selectionStatus: 'not_run', reason: 'revised CAD requires production catalog rebinding' },
      housingFit: { status: 'not_run', reason: 'revised CAD requires housing capacity and selected-component rebinding' },
      pipeline: { stoppedAt: advanced.stoppedAt, stages: Object.fromEntries(Object.entries(advanced.state.stages).map(([id, item]) => [id, { status: item.status, errorCodes: item.errorCodes, metrics: item.metrics }])) },
      assembly: { verifierReturned: Boolean(verification), releaseReady: false, certificate: verification?.assemblyCertificate ?? null, preciseInterferenceStatus: verification?.preciseInterference?.status ?? null, flaggedInterferences: pairs.length, code: verification?.code ?? null, message: verification?.message ?? null },
      interferenceAnalysis: { categories: Object.fromEntries(['structural-structural', 'drive-structural', 'drive-drive'].map(kind => [kind, pairs.filter(pair => pair.category === kind).length])), pairs },
      motionStudy: { exploratoryOnly: true, releaseEvidence: false, rangeSource: 'governed-hinge-limits', sweepStrategy: 'zero-to-each-limit', stepsPerSegment: 12, axisCount: motionAxes.length, allConverged: motionAxes.length === 6 && motionAxes.every(axis => axis.allConverged), frameCount: motionAxes.reduce((sum, axis) => sum + axis.frameCount, 0), checkedFrames: motionAxes.reduce((sum, axis) => sum + axis.checkedFrames, 0), collisionFrameCount: motionCollisionFrames, axes: motionAxes, code: motionComplete ? null : 'MOTION_REVERIFY_INCOMPLETE', message: motionComplete ? null : 'Every governed J1..J6 zero-to-limit segment must return 13 checked, converged frames.' },
      blockers: [...program.unresolved, 'catalog_rebind_required', 'housing_reverify_required', ...(motionComplete ? [] : ['motion_reverify_incomplete']), ...(motionCollisionFrames > 0 ? ['precise_motion_collisions_present'] : []), 'manufacturing_not_run', 'step_roundtrip_not_run', 'expert_review_not_run'],
      revisionBinding: { baseProgramHash: manifest.baseProgramHash, manifestSha256: sha256(manifestBytes) }, quoteOrRfqSideEffects: false,
    };
    return NextResponse.json({ ok: true, report, releaseReady: false, quoteOrRfqSideEffects: false });
  } catch (cause) {
    return NextResponse.json({ ok: false, code: 'INVALID_REVISION_PACKAGE', message: cause instanceof Error ? cause.message : String(cause) }, { status: 422 });
  }
}

function parseJson(bytes: Buffer, label: string) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error(`${label} must be valid UTF-8 JSON`); } }
function sha256(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function validateRevisionManifest(manifest: AiAssemblyRevisionPackage, programBytes: Buffer) {
  if (!manifest || manifest.schema !== 'nexyfab.ai-assembly-revision-package.v1') throw new Error('unsupported revision manifest');
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(manifest.lineageId) || !Number.isInteger(manifest.revision) || manifest.revision < 2) throw new Error('invalid lineage or revision');
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('invalid revision creation time');
  if (!SHA256.test(manifest.baseProgramHash) || !SHA256.test(manifest.programHash) || manifest.baseProgramHash === manifest.programHash) throw new Error('invalid revision hashes');
  if (sha256(programBytes) !== manifest.programHash || manifest.programArtifact !== `editable-program-${manifest.programHash}.json`) throw new Error('program bytes do not match manifest');
  if (manifest.sideEffects?.sourceModified !== false || manifest.sideEffects?.quoteCreated !== false || manifest.sideEffects?.rfqSent !== false) throw new Error('revision manifest side effects must all be false');
}
function validateSixAxisRobot(program: AiAssemblyProgram) {
  const hinges = program.assembly.mates.filter((mate): mate is HingeMate => mate.kind === 'hinge' && /^J[1-6]$/.test(mate.id));
  if (hinges.length !== 6 || new Set(hinges.map(mate => mate.id)).size !== 6) throw new Error('robot revision requires governed J1..J6 hinge mates');
  for (const mate of hinges) if (!mate.limit || !Number.isFinite(mate.limit.minAngleDeg) || !Number.isFinite(mate.limit.maxAngleDeg) || mate.limit.minAngleDeg >= mate.limit.maxAngleDeg) throw new Error(`robot revision requires a finite increasing angular limit for ${mate.id}`);
  return hinges.sort((a, b) => a.id.localeCompare(b.id));
}
function category(a: string, b: string) { const driveA = a.startsWith('J'), driveB = b.startsWith('J'); return driveA && driveB ? 'drive-drive' : driveA || driveB ? 'drive-structural' : 'structural-structural'; }
