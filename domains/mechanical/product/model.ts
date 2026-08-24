import { createHash } from 'node:crypto';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { PartRefSpec } from '@/lib/assembly/api';
import type { Mate } from '@/lib/assembly/mate';
import { validateAssembly } from '@/lib/assembly/assemblyState';
import {
  buildMotorGearboxDriveModuleFixtureContract,
} from './fixtures/motorGearboxDriveModuleContract';
import { createMotorGearboxDriveModuleContract, type MotorGearboxDriveModuleContract } from './contract';
import { motorGearboxDriveModuleFixture } from './fixtures/motorGearboxDriveModule';

type LoopPoint = { x: number; y: number };
const rectangle = (width: number, height: number): LoopPoint[] => [
  { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
  { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 },
];

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';

export const hashMechanicalFeatureTree = (tree: FeatureTree): string => createHash('sha256').update(canonical(tree), 'utf8').digest('hex');

const extrude = (id: string, width: number, height: number, depth: number) => ({
  id, name: `${id} base`, dependencies: [],
  payload: { kind: 'extrude' as const, loop: rectangle(width, height), depth, direction: 'one_sided' as const, mode: 'add' as const },
});

const refs = (axis: { x: number; y: number; z: number }, plane: { x: number; y: number; z: number }): Readonly<Record<string, PartRefSpec>> => ({
  origin: { kind: 'point', origin: { x: 0, y: 0, z: 0 } },
  center_axis: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: axis },
  mount_plane: { kind: 'plane', origin: plane, normal: { x: 0, y: 0, z: 1 } },
});

function trees(contract: MotorGearboxDriveModuleContract): Record<string, FeatureTree> {
  const part = (role: string) => contract.parts.find((p) => p.role === role);
  const base = part('base')!;
  const shaft = part('shaft')!;
  const supports = contract.parts.filter((p) => p.role === 'bearing-support');
  const coupling = part('coupling')!;
  const fastener = part('fastener')!;
  const guard = part('guard')!;

  const shaftTree: FeatureTree = { nodes: [{
    id: 'shaft_revolve', name: 'Stepped driven shaft revolve', dependencies: [],
    payload: { kind: 'revolve', loop: [{ x: 12.5, y: 0 }, { x: 12.5, y: 42 }, { x: 8, y: 42 }, { x: 8, y: 0 }], angleDegrees: 360, mode: 'add' },
  }] };
  const couplingTree: FeatureTree = { nodes: [{
    id: 'coupling_revolve', name: 'Coupling envelope revolve', dependencies: [],
    payload: { kind: 'revolve', loop: [{ x: 16, y: 0 }, { x: 16, y: 58 }, { x: 12.5, y: 58 }, { x: 12.5, y: 0 }], angleDegrees: 360, mode: 'add' },
  }] };

  const supportTree = (id: string): FeatureTree => {
    const root = extrude(`${id}_extrude`, 64, 42, 68);
    return { nodes: [root, {
      id: `${id}_bore`, name: 'Bearing bore', dependencies: [root.id],
      payload: { kind: 'hole', childId: root.id, center: { x: 0, y: 0 }, holeType: 'drilled', diameter: 52, depth: 68, terminationMode: 'through' },
    }] };
  };
  const baseRoot = extrude('base_extrude', 240, 160, 16);
  const baseTree: FeatureTree = { nodes: [baseRoot, {
    id: 'base_edge_chamfer', name: 'Base edge chamfer', dependencies: [baseRoot.id],
    payload: {
      kind: 'chamfer', childId: baseRoot.id, childExtrude: baseRoot.payload, distance: 1,
      edgeSelection: 'vertical', edgeRefs: ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'],
    },
  }] };
  const guardRoot = extrude('guard_extrude', 150, 70, 90);
  const guardTree: FeatureTree = { nodes: [guardRoot, {
    id: 'guard_shell', name: 'Removable open guard shell', dependencies: [guardRoot.id],
    payload: { kind: 'shell', childId: guardRoot.id, childExtrude: guardRoot.payload, thickness: 1.5, openTopFace: true },
  }] };
  const fastenerTree: FeatureTree = { nodes: [{
    id: 'fastener_revolve', name: 'Fastener envelope revolve', dependencies: [],
    payload: { kind: 'revolve', loop: [{ x: 5, y: 0 }, { x: 5, y: 20 }, { x: 4, y: 20 }, { x: 4, y: 0 }], angleDegrees: 360, mode: 'add' },
  }] };

  const result: Record<string, FeatureTree> = {
    [base.id]: baseTree, [shaft.id]: shaftTree,
    [supports[0].id]: supportTree('bearing_a'), [supports[1].id]: supportTree('bearing_b'),
    [coupling.id]: couplingTree, [fastener.id]: fastenerTree, [guard.id]: guardTree,
  };
  for (const [partId, tree] of Object.entries(result)) {
    const plan = featureTreeToOcctPlan(tree);
    if (plan.unsupported.length || plan.embeddedChildNodes.length || !plan.finalResultId) {
      throw new Error(`mechanical_model_exact_plan_invalid:${partId}`);
    }
  }
  return result;
}

function assembly(contract: MotorGearboxDriveModuleContract): AssemblyState {
  const part = (role: string) => contract.parts.find((p) => p.role === role)!;
  const base = part('base');
  const shaft = part('shaft');
  const support = contract.parts.filter((p) => p.role === 'bearing-support');
  const coupling = part('coupling');
  const fastener = part('fastener');
  const guard = part('guard');
  const instance = (id: string, name: string, position: { x: number; y: number; z: number }, fixed: boolean, axis = { x: 0, y: 0, z: 1 }, plane = { x: 0, y: 0, z: 0 }) => ({ id, name, partTemplateId: id, position, orientation: IDENTITY_QUAT, fixed, refs: refs(axis, plane) });
  const parts = [
    instance(base.id, 'Machined support base', { x: 0, y: 0, z: 0 }, true),
    instance(shaft.id, 'Stepped driven shaft', { x: 0, y: 0, z: 68 }, false, { x: 0, y: 0, z: 1 }),
    instance(support[0].id, 'Drive-side bearing pedestal', { x: -55, y: 0, z: 16 }, false),
    instance(support[1].id, 'Opposite-side bearing pedestal', { x: 55, y: 0, z: 16 }, false),
    instance(coupling.id, 'Flexible coupling envelope', { x: 0, y: 0, z: 110 }, false, { x: 0, y: 0, z: 1 }),
    instance(fastener.id, 'Abstract fastener set', { x: -90, y: -60, z: 16 }, false),
    instance(guard.id, 'Removable rotating-part guard', { x: 0, y: 0, z: 60 }, false),
  ];
  const mate = (id: string, a: string, b: string): Mate => ({ id, kind: 'concentric', a: { partId: a, refId: 'center_axis', refKind: 'axis' }, b: { partId: b, refId: 'center_axis', refKind: 'axis' } });
  const state: AssemblyState = { parts, mates: [mate('mate-shaft-support-a', shaft.id, support[0].id), mate('mate-shaft-support-b', shaft.id, support[1].id), mate('mate-shaft-coupling', shaft.id, coupling.id)] };
  validateAssembly(state);
  return state;
}

export interface MotorGearboxDriveModuleModel {
  schema: 'nexyfab.mechanical.product.model.v1';
  contract: MotorGearboxDriveModuleContract;
  featureTrees: Record<string, FeatureTree>;
  assemblyState: AssemblyState;
  metadata: { preview: false; rightsStatus: 'RIGHTS_CLEARED_ORIGINAL'; sourceRevision: string; sourceId: string; manufacturingApproval: false };
}

export function buildMotorGearboxDriveModuleModel(): MotorGearboxDriveModuleModel {
  const seed = buildMotorGearboxDriveModuleFixtureContract();
  const featureTrees = trees(seed);
  const contract = createMotorGearboxDriveModuleContract({
    schema: seed.schema,
    authoritative: true,
    identity: { id: seed.identity.id, revision: seed.identity.revision },
    units: seed.units,
    requirements: seed.requirements,
    parts: seed.parts.map(part => ({ ...part, geometryHash: hashMechanicalFeatureTree(featureTrees[part.id]!) })),
    datums: seed.datums,
    interfaces: seed.interfaces,
    criticalDimensions: seed.criticalDimensions,
  });
  return {
    schema: 'nexyfab.mechanical.product.model.v1', contract,
    featureTrees, assemblyState: assembly(contract),
    metadata: { preview: false, rightsStatus: 'RIGHTS_CLEARED_ORIGINAL', sourceRevision: motorGearboxDriveModuleFixture.provenance.sourceRevision, sourceId: motorGearboxDriveModuleFixture.provenance.sourceId, manufacturingApproval: false },
  };
}
