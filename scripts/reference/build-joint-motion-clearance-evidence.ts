/**
 * Joint motion clearance capability baseline — P2 스윕×정밀충돌 인증서의
 * fail-closed 성질을 결정론 스펙시멘으로 고정한다(외부 native joint 주장 아님,
 * scoreEligible=false).
 *
 * 스펙시멘: base 바 x∈[0,90] + link 바 x∈[0,80], (100,0,0) z축 힌지.
 * 해석 기대값 — 0→90°: 최소 간극 정확히 5mm(θ=90°에서 링크 코너 원호 x=95
 * vs base 면 x=90). 0→180°: θ≈126.87°에서 base 코너 (90,5)와 첫 접촉.
 *
 * usage: npx tsx scripts/reference/build-joint-motion-clearance-evidence.ts [output.json]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { collisionGeometryFromFeatureTree } from '../../src/lib/assembly/featureTreePreciseInterference';
import type { FeatureNode } from '../../src/lib/cad/featureTree';
import { adaptCadNativeAssembly } from '../../src/lib/reference/cadNativeAssemblyAdapter';
import type { CadNativeAssemblyEvidence } from '../../src/lib/reference/cadNativeAssemblyEvidence';
import { planCadNativeJointMotion } from '../../src/lib/reference/cadNativeJointMotionPlan';
import { buildCadProductBundleManifest } from '../../src/lib/reference/cadCorpusProductBundle';
import { bindJointsToOccurrences, buildJointMotionClearanceCertificate } from '../../src/lib/reference/jointMotionClearanceCertificate';
import { computeJointDefinitionHash, evaluateEditAgainstConfirmations, planLocalJointRepair } from '../../src/lib/reference/userConfirmedJointGuard';

const output = path.resolve(process.argv[2] ?? 'docs/evidence/joint-motion-clearance-260807/specimen-run-1.json');

const bytes = (value: string) => new TextEncoder().encode(value);
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rect = (x0: number, x1: number, y0: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const bar = (id: string, x0: number, x1: number): FeatureNode => ({
  id, name: id, dependencies: [],
  payload: { kind: 'extrude', loop: rect(x0, x1, -5, 5), depth: 10, direction: 'one_sided', mode: 'add' },
});

function specimen(limits: { lower: number; upper: number }) {
  const bundle = buildCadProductBundleManifest([
    { relativePath: 'set/hinge.snapshot.1/root.SLDASM', bytes: bytes('asm') },
    { relativePath: 'set/hinge.snapshot.1/link.SLDPRT', bytes: bytes('part') },
  ]);
  const source = bundle.members.find(item => item.role === 'native_assembly')!;
  const evidence: CadNativeAssemblyEvidence = {
    schema: 'nexyfab.native-assembly-evidence.v1.1', lineageId: bundle.lineageId,
    extractor: { name: 'specimen', version: '1', cadSystem: 'deterministic-fixture', cadVersion: null },
    coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' },
    units: { length: 'mm', angle: 'deg' },
    sources: [{ relativePath: source.relativePath, sha256: source.sha256 }],
    definitions: [
      { id: 'base', name: 'Base', sourceMember: source.relativePath, kind: 'assembly' },
      { id: 'link', name: 'Link', sourceMember: bundle.members.find(item => item.role === 'native_part')!.relativePath, kind: 'part' },
    ],
    occurrences: [
      { id: 'base-1', definitionId: 'base', parentOccurrenceId: null, transform: I, suppressed: false, state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false } },
      { id: 'link-1', definitionId: 'link', parentOccurrenceId: 'base-1', transform: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], suppressed: false, state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false } },
    ],
    joints: [{ id: 'shoulder', type: 'revolute', parentOccurrenceId: 'base-1', childOccurrenceId: 'link-1', axis: [0, 0, 1], originMm: [100, 0, 0], lowerLimit: limits.lower, upperLimit: limits.upper, frame: 'world' }],
  };
  return { bundle, evidence };
}

async function run(limits: { lower: number; upper: number }, maximumPairChecks?: number, dropGeometry = false) {
  const { bundle, evidence } = specimen(limits);
  const adapter = adaptCadNativeAssembly(bundle, evidence);
  const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
  const geometries = new Map([
    ['native:base-1', await collisionGeometryFromFeatureTree('native:base-1', { nodes: [bar('base-bar', 0, 90)] })],
    ['native:link-1', await collisionGeometryFromFeatureTree('native:link-1', { nodes: [bar('link-bar', 0, 80)] })],
  ]);
  if (dropGeometry) geometries.delete('native:link-1');
  return { evidence, plan, certificate: buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries, maximumPairChecks }) };
}

async function main() {
  const clearRun = await run({ lower: 0, upper: 90 });
  const foldBackRun = await run({ lower: 0, upper: 180 });
  const budgetRun = await run({ lower: 0, upper: 90 }, 3);
  const noGeometryRun = await run({ lower: 0, upper: 90 }, undefined, true);
  const clear = clearRun.certificate, foldBack = foldBackRun.certificate, budget = budgetRun.certificate, noGeometry = noGeometryRun.certificate;

  // 사용자 확정 보호·국소 repair 성질 — 같은 스펙시멘으로 고정한다.
  const emptyRegistry = { joints: [], dimensions: [] };
  const confirmedRegistry = {
    joints: bindJointsToOccurrences(foldBackRun.evidence).joints.map(joint => ({ jointId: joint.jointId, jointDefinitionHash: computeJointDefinitionHash(joint) })),
    dimensions: [],
  };
  const staleRegistry = {
    joints: bindJointsToOccurrences(clearRun.evidence).joints.map(joint => ({ jointId: joint.jointId, jointDefinitionHash: computeJointDefinitionHash(joint) })),
    dimensions: [],
  };
  const openRepair = planLocalJointRepair(foldBack, foldBackRun.plan, emptyRegistry);
  const confirmedRepair = planLocalJointRepair(foldBack, foldBackRun.plan, confirmedRegistry);
  const staleRepair = planLocalJointRepair(foldBack, foldBackRun.plan, staleRegistry);
  const guardBlocked = evaluateEditAgainstConfirmations([{ kind: 'remove_mate', mateId: 'native:shoulder' }], confirmedRegistry);
  const guardReleased = evaluateEditAgainstConfirmations([{ kind: 'remove_mate', mateId: 'native:shoulder' }], confirmedRegistry, ['shoulder']);

  const scenarios = { clear, foldBack, budget, noGeometry, guard: { openRepair, confirmedRepair, staleRepair, guardBlocked, guardReleased } };
  const expectations = {
    clearSweepPasses: clear.status === 'pass' && (clear.sweeps[0]?.minimumClearanceMm ?? 0) > 4.5 && (clear.sweeps[0]?.minimumClearanceMm ?? 99) <= 5.000001,
    foldBackCollisionDetected: foldBack.status === 'fail' && (foldBack.sweeps[0]?.collision?.parameterValue ?? 0) > 120 && (foldBack.sweeps[0]?.collision?.parameterValue ?? 999) <= 135,
    budgetExhaustionIsNotRun: budget.status === 'not_run' && budget.sweeps[0]?.reason === 'pair_budget_exhausted',
    missingGeometryIsNotRun: noGeometry.status === 'not_run' && noGeometry.sweeps[0]?.reason === 'collision_geometry_unavailable:native:link-1',
    occurrenceHashesBound: clear.binding.joints.every(joint => /^[a-f0-9]{64}$/.test(joint.parentOccurrenceHash) && /^[a-f0-9]{64}$/.test(joint.childOccurrenceHash)),
    repairIsLocalAndRecertified: openRepair.status === 'pass' && openRepair.touchedJointIds.join(',') === 'shoulder'
      && openRepair.items[0]?.action?.requiresRecertification === true
      && (openRepair.items[0]?.action?.newUpperLimit ?? 999) < (foldBack.sweeps[0]?.collision?.parameterValue ?? 0),
    confirmedJointNeverAutoRepaired: confirmedRepair.items[0]?.disposition === 'user_input' && confirmedRepair.touchedJointIds.length === 0,
    staleConfirmationFailsClosed: staleRepair.status === 'fail' && staleRepair.errors[0] === 'user_confirmation_stale:shoulder',
    editGuardBlocksConfirmedJoint: guardBlocked.allowed === false && guardReleased.allowed === true,
  };
  const status = Object.values(expectations).every(Boolean) ? 'pass' : 'fail';
  const body = JSON.stringify({ scenarios, expectations }, null, 2);
  const artifact = {
    schema: 'nexyfab.joint-motion-clearance-capability.v1',
    generatedAt: new Date().toISOString(),
    status,
    scoreEligible: false,
    scope: 'Deterministic two-link hinge specimen proving sweep×precise-collision fail-closed properties; not an external native joint claim.',
    analyticExpectations: { minimumClearanceMm: 5, firstContactDegrees: 126.87 },
    contentSha256: createHash('sha256').update(body).digest('hex'),
    expectations,
    scenarios,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), status, expectations }));
  if (status !== 'pass') process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
