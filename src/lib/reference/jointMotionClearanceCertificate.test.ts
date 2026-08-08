// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FeatureNode } from '@/lib/cad/featureTree';
import { collisionGeometryFromFeatureTree } from '@/lib/assembly/featureTreePreciseInterference';
import { adaptCadNativeAssembly } from './cadNativeAssemblyAdapter';
import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';
import { planCadNativeJointMotion } from './cadNativeJointMotionPlan';
import { buildCadProductBundleManifest } from './cadCorpusProductBundle';
import { bindJointsToOccurrences, buildJointMotionClearanceCertificate, computeOccurrenceHash } from './jointMotionClearanceCertificate';

const bytes = (value: string) => new TextEncoder().encode(value);
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rect = (x0: number, x1: number, y0: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const bar = (id: string, x0: number, x1: number): FeatureNode => ({
  id, name: id, dependencies: [],
  payload: { kind: 'extrude', loop: rect(x0, x1, -5, 5), depth: 10, direction: 'one_sided', mode: 'add' },
});

/** 2링크 힌지 픽스처 — base 바 x∈[0,90], link 바 x∈[0,80]이 (100,0,0) 힌지에
 *  결합. 해석 기대값: 0→90° 스윕의 최소 간극은 정확히 5mm(θ=90°에서 링크
 *  코너 (0,±5)가 x=95 원호를 그리고 base 면은 x=90). 180°까지 열면 링크가
 *  base 위로 되접혀 θ≈126.87°에서 base 코너 (90,5)와 첫 접촉한다. */
function fixture(limits: { lower: number; upper: number }) {
  const bundle = buildCadProductBundleManifest([
    { relativePath: 'set/hinge.snapshot.1/root.SLDASM', bytes: bytes('asm') },
    { relativePath: 'set/hinge.snapshot.1/link.SLDPRT', bytes: bytes('part') },
  ]);
  const source = bundle.members.find(item => item.role === 'native_assembly')!;
  const evidence: CadNativeAssemblyEvidence = {
    schema: 'nexyfab.native-assembly-evidence.v1.1', lineageId: bundle.lineageId,
    extractor: { name: 'fixture', version: '1', cadSystem: 'fixture', cadVersion: null },
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

async function geometries() {
  const base = await collisionGeometryFromFeatureTree('native:base-1', { nodes: [bar('base-bar', 0, 90)] });
  const link = await collisionGeometryFromFeatureTree('native:link-1', { nodes: [bar('link-bar', 0, 80)] });
  expect(base.available, base.reason).toBe(true);
  expect(link.available, link.reason).toBe(true);
  return new Map([['native:base-1', base], ['native:link-1', link]]);
}

function certify(limits: { lower: number; upper: number }) {
  const { bundle, evidence } = fixture(limits);
  const adapter = adaptCadNativeAssembly(bundle, evidence);
  const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
  return { evidence, adapter, plan };
}

describe('joint occurrence binding', () => {
  it('binds joint origin/axis/limits to deterministic parent/child occurrence hashes', () => {
    const { evidence } = fixture({ lower: 0, upper: 90 });
    const binding = bindJointsToOccurrences(evidence);
    expect(binding.status).toBe('pass');
    expect(binding.joints).toHaveLength(1);
    const joint = binding.joints[0]!;
    expect(joint.parentOccurrenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(joint.childOccurrenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(joint.parentOccurrenceHash).not.toBe(joint.childOccurrenceHash);
    expect(joint.axis).toEqual([0, 0, 1]);
    expect(joint.originMm).toEqual([100, 0, 0]);
  });

  it('occurrence transform change changes the hash (approval invalidation basis)', () => {
    const { evidence } = fixture({ lower: 0, upper: 90 });
    const before = computeOccurrenceHash(evidence.occurrences[1]!);
    const moved = { ...evidence.occurrences[1]!, transform: [1, 0, 0, 101, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    expect(computeOccurrenceHash(moved)).not.toBe(before);
  });

  it('refuses joints that reference missing occurrences', () => {
    const { evidence } = fixture({ lower: 0, upper: 90 });
    evidence.joints[0]!.childOccurrenceId = 'ghost';
    const binding = bindJointsToOccurrences(evidence);
    expect(binding.status).toBe('fail');
    expect(binding.errors).toEqual(['joint_child_occurrence_missing:shoulder']);
  });

  it('never coerces an unknown joint type to fixed', () => {
    const { evidence } = fixture({ lower: 0, upper: 90 });
    (evidence.joints[0] as { type: string }).type = 'magnetic';
    const binding = bindJointsToOccurrences(evidence);
    expect(binding.status).toBe('fail');
    expect(binding.errors).toEqual(['joint_type_unknown:shoulder:magnetic']);
    expect(binding.joints).toHaveLength(0);
  });
});

describe('joint motion clearance certificate', () => {
  it('0→90° sweep passes with the analytic 5mm minimum clearance', async () => {
    const { evidence, adapter, plan } = certify({ lower: 0, upper: 90 });
    expect(adapter.status).toBe('pass');
    expect(plan.status).toBe('pass');
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await geometries() });
    expect(certificate.status).toBe('pass');
    const sweep = certificate.sweeps[0]!;
    expect(sweep.status).toBe('pass');
    expect(sweep.framesEvaluated).toBeGreaterThanOrEqual(19);
    // 해석값: 링크 힌지측 코너의 원호 최소 x=95 vs base 면 x=90 → 5mm.
    expect(sweep.minimumClearanceMm).toBeGreaterThan(4.5);
    expect(sweep.minimumClearanceMm).toBeLessThanOrEqual(5.0 + 1e-6);
    expect(certificate.pairBudget.exhausted).toBe(false);
  });

  it('0→180° sweep detects the fold-back collision near the analytic 126.9°', async () => {
    const { evidence, adapter, plan } = certify({ lower: 0, upper: 180 });
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await geometries() });
    expect(certificate.status).toBe('fail');
    const sweep = certificate.sweeps[0]!;
    expect(sweep.status).toBe('fail');
    expect(sweep.minimumClearanceMm).toBe(0);
    expect(sweep.collision).not.toBeNull();
    // 5° 스텝 격자에서 첫 접촉(≈126.87°)을 지난 최초 프레임에서 잡혀야 한다.
    expect(sweep.collision!.parameterValue).toBeGreaterThan(120);
    expect(sweep.collision!.parameterValue).toBeLessThanOrEqual(135);
    expect([sweep.collision!.partA, sweep.collision!.partB].sort()).toEqual(['native:base-1', 'native:link-1']);
  });

  it('pair budget exhaustion is not_run, never pass (false-clear 0)', async () => {
    const { evidence, adapter, plan } = certify({ lower: 0, upper: 90 });
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await geometries(), maximumPairChecks: 3 });
    expect(certificate.status).toBe('not_run');
    expect(certificate.sweeps[0]!.status).toBe('not_run');
    expect(certificate.sweeps[0]!.reason).toBe('pair_budget_exhausted');
    expect(certificate.sweeps[0]!.minimumClearanceMm).toBeNull();
    expect(certificate.pairBudget.exhausted).toBe(true);
  });

  it('missing collision geometry is not_run, never a clearance claim', async () => {
    const { evidence, adapter, plan } = certify({ lower: 0, upper: 90 });
    const partial = await geometries();
    partial.delete('native:link-1');
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: partial });
    expect(certificate.status).toBe('not_run');
    expect(certificate.sweeps[0]!.status).toBe('not_run');
    expect(certificate.sweeps[0]!.reason).toBe('collision_geometry_unavailable:native:link-1');
  });

  it('unsupported planar joints surface as not_run with the adapter reason, not as fixed', async () => {
    const { bundle, evidence } = fixture({ lower: 0, upper: 90 });
    (evidence.joints[0] as { type: string }).type = 'planar';
    const adapter = adaptCadNativeAssembly(bundle, evidence);
    const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await geometries() });
    expect(certificate.status).toBe('not_run');
    expect(certificate.sweeps.some(item => item.reason === 'native_joint_planar_unsupported')).toBe(true);
    expect(certificate.sweeps.every(item => item.status !== 'pass')).toBe(true);
  });
});

/** K6 프리즘 픽스처 — 스토퍼 벽 x∈[200,210](base), 슬라이더 바 x∈[0,80]이
 *  x=100 에 배치(월드 100..180). 프리즘 축 +x, travel 한계 [lower, upper]mm.
 *  해석 기대값: 슬라이더 선단(월드 180)과 벽(200) 사이 간극 20mm →
 *  travel 20 에서 첫 접촉, travel t<20 스윕의 최소 간극 = 20−t. */
function prismaticFixture(limits: { lower: number; upper: number }, type: 'prismatic' | 'cylindrical' = 'prismatic') {
  const bundle = buildCadProductBundleManifest([
    { relativePath: 'set/slider.snapshot.1/root.SLDASM', bytes: bytes('asm') },
    { relativePath: 'set/slider.snapshot.1/slide.SLDPRT', bytes: bytes('part') },
  ]);
  const source = bundle.members.find(item => item.role === 'native_assembly')!;
  const evidence: CadNativeAssemblyEvidence = {
    schema: 'nexyfab.native-assembly-evidence.v1.1', lineageId: bundle.lineageId,
    extractor: { name: 'fixture', version: '1', cadSystem: 'fixture', cadVersion: null },
    coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' },
    units: { length: 'mm', angle: 'deg' },
    sources: [{ relativePath: source.relativePath, sha256: source.sha256 }],
    definitions: [
      { id: 'rail', name: 'Rail', sourceMember: source.relativePath, kind: 'assembly' },
      { id: 'slide', name: 'Slide', sourceMember: bundle.members.find(item => item.role === 'native_part')!.relativePath, kind: 'part' },
    ],
    occurrences: [
      { id: 'rail-1', definitionId: 'rail', parentOccurrenceId: null, transform: I, suppressed: false, state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false } },
      { id: 'slide-1', definitionId: 'slide', parentOccurrenceId: 'rail-1', transform: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], suppressed: false, state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false } },
    ],
    joints: [{ id: 'slide-joint', type, parentOccurrenceId: 'rail-1', childOccurrenceId: 'slide-1', axis: [1, 0, 0], originMm: [100, 0, 0], lowerLimit: limits.lower, upperLimit: limits.upper, frame: 'world' }],
  };
  return { bundle, evidence };
}

async function prismaticGeometries() {
  const rail = await collisionGeometryFromFeatureTree('native:rail-1', { nodes: [bar('stop-wall', 200, 210)] });
  const slide = await collisionGeometryFromFeatureTree('native:slide-1', { nodes: [bar('slide-bar', 0, 80)] });
  expect(rail.available, rail.reason).toBe(true);
  expect(slide.available, slide.reason).toBe(true);
  return new Map([['native:rail-1', rail], ['native:slide-1', slide]]);
}

describe('K6 — prismatic/cylindrical joint sweeps', () => {
  it('prismatic 0..15mm travel passes with the analytic 5mm minimum clearance', async () => {
    const { bundle, evidence } = prismaticFixture({ lower: 0, upper: 15 });
    const adapter = adaptCadNativeAssembly(bundle, evidence);
    expect(adapter.status).toBe('pass');
    const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
    expect(plan.status).toBe('pass');
    expect(plan.plans[0]!.parameterBiasMm).toBe(1000);
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await prismaticGeometries() });
    expect(certificate.status).toBe('pass');
    const sweep = certificate.sweeps.find(item => item.mateId === 'native:slide-joint:travel')!;
    expect(sweep.status).toBe('pass');
    expect(sweep.minimumClearanceMm).toBeGreaterThan(4.5);
    expect(sweep.minimumClearanceMm).toBeLessThan(5.5);
  });

  it('prismatic 0..40mm travel detects first contact near the analytic 20mm', async () => {
    const { bundle, evidence } = prismaticFixture({ lower: 0, upper: 40 });
    const adapter = adaptCadNativeAssembly(bundle, evidence);
    const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
    const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries: await prismaticGeometries() });
    expect(certificate.status).toBe('fail');
    const sweep = certificate.sweeps.find(item => item.mateId === 'native:slide-joint:travel')!;
    expect(sweep.status).toBe('fail');
    // parameterValue = BIAS + travel — 첫 접촉 travel ≈ 20mm (step 2mm 공차)
    expect(sweep.collision!.parameterValue).toBeGreaterThanOrEqual(1000 + 18);
    expect(sweep.collision!.parameterValue).toBeLessThanOrEqual(1000 + 22);
  });

  it('cylindrical plans a full rotation section and refuses ambiguous travel limits', async () => {
    const { bundle, evidence } = prismaticFixture({ lower: 0, upper: 40 }, 'cylindrical');
    const adapter = adaptCadNativeAssembly(bundle, evidence);
    expect(adapter.compiledJointIds).toContain('native:slide-joint');
    expect(adapter.compiledJointIds).toContain('native:slide-joint:travel');
    const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
    const rotation = plan.plans.find(item => item.mateId === 'native:slide-joint');
    expect(rotation?.sectionNote).toContain('cylindrical_rotation_section');
    expect(rotation?.request.toValue).toBe(360);
    expect(plan.unresolved.some(item => item.reason === 'cylindrical_travel_limits_ambiguous_not_run')).toBe(true);
    expect(plan.status).toBe('not_run');
  });
});
