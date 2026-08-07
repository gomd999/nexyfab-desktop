// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FeatureNode } from '@/lib/cad/featureTree';
import { collisionGeometryFromFeatureTree } from '@/lib/assembly/featureTreePreciseInterference';
import { adaptCadNativeAssembly } from './cadNativeAssemblyAdapter';
import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';
import { planCadNativeJointMotion } from './cadNativeJointMotionPlan';
import { buildCadProductBundleManifest } from './cadCorpusProductBundle';
import { bindJointsToOccurrences, buildJointMotionClearanceCertificate } from './jointMotionClearanceCertificate';
import { computeJointDefinitionHash, evaluateEditAgainstConfirmations, planLocalJointRepair, validateConfirmations, type UserConfirmationRegistry } from './userConfirmedJointGuard';

const bytes = (value: string) => new TextEncoder().encode(value);
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rect = (x0: number, x1: number, y0: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const bar = (id: string, x0: number, x1: number): FeatureNode => ({
  id, name: id, dependencies: [],
  payload: { kind: 'extrude', loop: rect(x0, x1, -5, 5), depth: 10, direction: 'one_sided', mode: 'add' },
});

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

async function certify(limits: { lower: number; upper: number }) {
  const { bundle, evidence } = fixture(limits);
  const adapter = adaptCadNativeAssembly(bundle, evidence);
  const plan = planCadNativeJointMotion(evidence, adapter.compiledJointIds);
  const geometries = new Map([
    ['native:base-1', await collisionGeometryFromFeatureTree('native:base-1', { nodes: [bar('base-bar', 0, 90)] })],
    ['native:link-1', await collisionGeometryFromFeatureTree('native:link-1', { nodes: [bar('link-bar', 0, 80)] })],
  ]);
  const certificate = buildJointMotionClearanceCertificate({ evidence, adapter, plan, geometries });
  return { evidence, plan, certificate };
}

const emptyRegistry: UserConfirmationRegistry = { joints: [], dimensions: [] };
function confirmedRegistry(evidence: CadNativeAssemblyEvidence): UserConfirmationRegistry {
  const binding = bindJointsToOccurrences(evidence);
  return { joints: binding.joints.map(joint => ({ jointId: joint.jointId, jointDefinitionHash: computeJointDefinitionHash(joint) })), dimensions: [] };
}

describe('joint definition hash and confirmation validity', () => {
  it('hash is deterministic and changes when limits change (confirmation goes stale)', () => {
    const a = bindJointsToOccurrences(fixture({ lower: 0, upper: 90 }).evidence).joints[0]!;
    const b = bindJointsToOccurrences(fixture({ lower: 0, upper: 90 }).evidence).joints[0]!;
    const widened = bindJointsToOccurrences(fixture({ lower: 0, upper: 180 }).evidence).joints[0]!;
    expect(computeJointDefinitionHash(a)).toBe(computeJointDefinitionHash(b));
    expect(computeJointDefinitionHash(widened)).not.toBe(computeJointDefinitionHash(a));
  });

  it('flags stale and unknown confirmations', () => {
    const { evidence } = fixture({ lower: 0, upper: 90 });
    const registry = confirmedRegistry(evidence);
    registry.joints.push({ jointId: 'ghost', jointDefinitionHash: registry.joints[0]!.jointDefinitionHash });
    const widened = bindJointsToOccurrences(fixture({ lower: 0, upper: 180 }).evidence).joints;
    expect(validateConfirmations(registry, widened)).toEqual([
      { jointId: 'shoulder', status: 'stale' },
      { jointId: 'ghost', status: 'unknown_joint' },
    ]);
  });
});

describe('edit guard for user-confirmed joints and dimensions', () => {
  const registry: UserConfirmationRegistry = {
    joints: [{ jointId: 'shoulder', jointDefinitionHash: 'a'.repeat(64) }],
    dimensions: [{ partId: 'link', featureId: 'link-bar', parameter: 'depth', value: 10, unit: 'mm' }],
  };

  it('blocks mate edits that target a confirmed joint (native: prefix resolved)', () => {
    const verdict = evaluateEditAgainstConfirmations([
      { kind: 'remove_mate', mateId: 'native:shoulder' },
    ], registry);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations).toEqual(['user_confirmed_joint_protected:shoulder:remove_mate']);
  });

  it('an explicit override releases exactly that confirmation', () => {
    const operations = [{ kind: 'set_mate_parameter', mateId: 'native:shoulder', parameter: 'angle', value: 45, unit: 'deg' } as const];
    expect(evaluateEditAgainstConfirmations(operations, registry).allowed).toBe(false);
    expect(evaluateEditAgainstConfirmations(operations, registry, ['shoulder']).allowed).toBe(true);
  });

  it('blocks confirmed dimension changes but allows a same-value no-op and other features', () => {
    const change = { kind: 'set_feature_parameter', partId: 'link', featureId: 'link-bar', parameter: 'depth', value: 12, unit: 'mm' } as const;
    const noop = { ...change, value: 10 } as const;
    const other = { ...change, featureId: 'other-feature' } as const;
    expect(evaluateEditAgainstConfirmations([change], registry).violations).toEqual(['user_confirmed_dimension_protected:link/link-bar/depth']);
    expect(evaluateEditAgainstConfirmations([noop], registry).allowed).toBe(true);
    expect(evaluateEditAgainstConfirmations([other], registry).allowed).toBe(true);
  });

  it('unconfirmed joints stay freely editable', () => {
    expect(evaluateEditAgainstConfirmations([{ kind: 'remove_mate', mateId: 'native:elbow' }], registry).allowed).toBe(true);
  });
});

describe('local joint repair planning', () => {
  it('proposes a grid-verified limit reduction for the failing unconfirmed joint only', async () => {
    const { plan, certificate } = await certify({ lower: 0, upper: 180 });
    expect(certificate.status).toBe('fail');
    const repair = planLocalJointRepair(certificate, plan, emptyRegistry);
    expect(repair.status).toBe('pass');
    expect(repair.touchedJointIds).toEqual(['shoulder']);
    const item = repair.items[0]!;
    expect(item.disposition).toBe('propose');
    const sweep = certificate.sweeps[0]!;
    const stepDegrees = 180 / (sweep.framesEvaluated - 1);
    expect(item.action!.newUpperLimit).toBeCloseTo(sweep.collision!.parameterValue - stepDegrees, 6);
    expect(item.action!.newUpperLimit).toBeGreaterThan(90);
    expect(item.action!.previousUpperLimit).toBe(180);
    expect(item.action!.requiresRecertification).toBe(true);
  });

  it('a confirmed failing joint is never auto-repaired — user decision required', async () => {
    const { evidence, plan, certificate } = await certify({ lower: 0, upper: 180 });
    const repair = planLocalJointRepair(certificate, plan, confirmedRegistry(evidence));
    expect(repair.status).toBe('pass');
    expect(repair.items[0]!.disposition).toBe('user_input');
    expect(repair.items[0]!.action).toBeNull();
    expect(repair.touchedJointIds).toEqual([]);
  });

  it('a stale confirmation fails the whole repair plan instead of silently ignoring it', async () => {
    const narrow = fixture({ lower: 0, upper: 90 });
    const staleRegistry = confirmedRegistry(narrow.evidence);
    const { plan, certificate } = await certify({ lower: 0, upper: 180 });
    const repair = planLocalJointRepair(certificate, plan, staleRegistry);
    expect(repair.status).toBe('fail');
    expect(repair.errors).toEqual(['user_confirmation_stale:shoulder']);
    expect(repair.items).toEqual([]);
  });

  it('a passing certificate yields no repair touches (locality)', async () => {
    const { plan, certificate } = await certify({ lower: 0, upper: 90 });
    expect(certificate.status).toBe('pass');
    const repair = planLocalJointRepair(certificate, plan, emptyRegistry);
    expect(repair.status).toBe('not_run');
    expect(repair.items).toEqual([]);
    expect(repair.touchedJointIds).toEqual([]);
  });
});
