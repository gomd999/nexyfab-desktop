import type { AiAssemblyPart, AiAssemblyProgram } from '../aiAssemblyProgram';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { Mate } from '@/lib/assembly/mate';
import type { RobotEngineeringSpec } from './robotEngineering';
import type { JointSelection } from './componentSelector';

export type GeneratedRobot = { program: AiAssemblyProgram; pendingCatalogComponents: string[] };

export function generateRobot6Axis(spec: RobotEngineeringSpec, name = 'NexyFab 6-axis robot', selections: readonly JointSelection[] = []): GeneratedRobot {
  if (spec.joints.length !== 6) throw new Error('A 6-axis robot requires exactly six joints.');
  const ids = ['base', 'shoulder', 'upper-arm', 'forearm', 'wrist-1', 'wrist-2', 'tool-flange'];
  const assemblyParts = ids.map((id, index) => ({
    id, name: id, partTemplateId: id,
    position: { x: 0, y: 0, z: index === 0 ? 0 : spec.joints.slice(0, index).reduce((sum, j) => sum + Math.max(j.dMm, 60), 0) },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: index === 0,
  }));
  const mates: Mate[] = ids.slice(1).map((id, index) => ({
    id: `J${index + 1}`, kind: 'hinge' as const,
    a: { partId: ids[index]!, refId: 'z_axis', refKind: 'axis' as const },
    b: { partId: id, refId: 'z_axis', refKind: 'axis' as const },
    limit: { minAngleDeg: spec.joints[index]!.minDeg, maxAngleDeg: spec.joints[index]!.maxDeg },
  }));
  const selectedJoints = new Set(selections.map(selection => selection.joint));
  const pendingCatalogComponents = spec.joints.flatMap((_, index) => selectedJoints.has(index + 1) ? [] : [`motor_j${index + 1}`, `reducer_j${index + 1}`, `bearing_set_j${index + 1}`]).concat(['brake', 'encoder', 'internal_harness', 'tool_connector']);
  const parts: AiAssemblyPart[] = ids.map((id, index) => ({
    instanceId: id, definitionId: `robot:${id}`, featureTree: linkTree(id, index === 0 ? 160 : Math.max(80, spec.joints[Math.max(0, index - 1)]!.aMm || spec.joints[Math.max(0, index - 1)]!.dMm)),
    metadata: { partNumber: `NX-R6-${String(index + 1).padStart(3, '0')}`, revision: 'A', material: index === 0 ? 'cast-aluminum' : 'aluminum-6061', process: 'machining', quantity: 1, source: 'assumed' as const },
  }));
  for (const selection of selections) {
    const parentId = ids[selection.joint - 1]!;
    for (const component of [selection.motor, selection.reducer, selection.bearing]) {
      const instanceId = `J${selection.joint}:${component.kind}:${component.id}`;
      assemblyParts.push({ id: instanceId, name: component.model, partTemplateId: component.id, position: { ...assemblyParts[selection.joint - 1]!.position }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: false });
      parts.push({ instanceId, definitionId: `catalog:${component.id}`, featureTree: envelopeTree(instanceId, component.envelopeMm), metadata: { partNumber: component.model, revision: component.revision, material: 'catalog-component', process: 'purchased', quantity: 1, source: 'catalog' as const } });
      mates.push(
        { id: `${instanceId}:axis`, kind: 'concentric', a: { partId: parentId, refId: 'z_axis', refKind: 'axis' }, b: { partId: instanceId, refId: 'z_axis', refKind: 'axis' } },
        { id: `${instanceId}:mount`, kind: 'coincident', a: { partId: parentId, refId: 'xy_plane', refKind: 'plane' }, b: { partId: instanceId, refId: 'xy_plane', refKind: 'plane' } },
      );
    }
  }
  return { program: {
    version: 1, units: 'mm', classification: 'concept_only', name,
    assembly: { parts: assemblyParts, mates }, parts,
    structure: [{ id: 'robot-arm', name: 'Robot arm kinematic chain', instanceIds: ids, rigid: false }, ...selections.map(selection => ({ id: `drive-J${selection.joint}`, name: `Joint ${selection.joint} drive`, instanceIds: assemblyParts.filter(part => part.id.startsWith(`J${selection.joint}:`)).map(part => part.id), rigid: true }))],
    unresolved: pendingCatalogComponents.map(id => `${id}: catalog model and mounting interface must be selected`),
  }, pendingCatalogComponents };
}

function envelopeTree(id: string, size: { x: number; y: number; z: number }): FeatureTree {
  return { nodes: [{ id: `${id}:catalog-envelope`, name: `${id} catalog envelope`, dependencies: [], payload: { kind: 'extrude', loop: [{ x: -size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: size.y / 2 }, { x: -size.x / 2, y: size.y / 2 }], depth: size.z, direction: 'one_sided', mode: 'add' } }] };
}

function linkTree(id: string, length: number): FeatureTree {
  const width = id === 'base' ? 160 : id === 'tool-flange' ? 70 : 90;
  return { nodes: [{ id: `${id}:body`, name: `${id} body`, dependencies: [], payload: {
    kind: 'extrude', loop: [{ x: -width / 2, y: -width / 2 }, { x: width / 2, y: -width / 2 }, { x: width / 2, y: width / 2 }, { x: -width / 2, y: width / 2 }],
    depth: Math.max(40, length), direction: 'one_sided', mode: 'add',
  } }] };
}
