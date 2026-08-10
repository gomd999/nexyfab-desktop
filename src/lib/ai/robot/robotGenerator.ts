import type { AiAssemblyPart, AiAssemblyProgram } from '../aiAssemblyProgram';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { Mate } from '@/lib/assembly/mate';
import type { RobotEngineeringSpec } from './robotEngineering';
import type { JointSelection } from './componentSelector';
import { validateCatalog } from './componentCatalog';

export type GeneratedRobot = { program: AiAssemblyProgram; pendingCatalogComponents: string[] };

export function generateRobot6Axis(spec: RobotEngineeringSpec, name = 'NexyFab 6-axis robot', selections: readonly JointSelection[] = []): GeneratedRobot {
  if (spec.joints.length !== 6) throw new Error('A 6-axis robot requires exactly six joints.');
  const selectionJoints = new Set<number>();
  for (const selection of selections) {
    if (!Number.isInteger(selection.joint) || selection.joint < 1 || selection.joint > 6) throw new Error(`Catalog selection joint must be an integer from 1 to 6: ${selection.joint}`);
    if (selectionJoints.has(selection.joint)) throw new Error(`Duplicate catalog selection for joint ${selection.joint}.`);
    selectionJoints.add(selection.joint);
  }
  for (const selection of selections) {
    if (!selection.motor || !selection.reducer || !selection.bearing) throw new Error(`J${selection.joint} motor, reducer and bearing selections are required.`);
    const catalogIssues = validateCatalog([selection.motor, selection.reducer, selection.bearing]);
    if (catalogIssues.length) throw new Error(`J${selection.joint} catalog selection invalid: ${catalogIssues.map(issue => `${issue.id}: ${issue.message}`).join('; ')}`);
    if (selection.motor.kind !== 'motor' || selection.reducer.kind !== 'reducer' || selection.bearing.kind !== 'bearing') throw new Error(`J${selection.joint} catalog component kinds are invalid.`);
    if (!selection.margins || Object.values(selection.margins).some(value => !Number.isFinite(value) || value < 1)) throw new Error(`J${selection.joint} catalog selection margins must be finite and at least 1.`);
    if (!Array.isArray(selection.evidence) || !selection.evidence.length || selection.evidence.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`J${selection.joint} catalog selection evidence is required.`);
  }
  const ids = ['base', 'shoulder', 'upper-arm', 'forearm', 'wrist-1', 'wrist-2', 'tool-flange'];
  const linkLengths = ids.map((id, index) => index === 0 ? 160 : Math.max(80, spec.joints[index - 1]!.aMm || spec.joints[index - 1]!.dMm));
  const assemblyParts = ids.map((id, index) => ({
    id, name: id, partTemplateId: `robot:${id}`,
    position: { x: 0, y: 0, z: linkLengths.slice(0, index).reduce((sum, length) => sum + length, 0) },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: index === 0,
  }));
  const mates: Mate[] = ids.slice(1).map((id, index) => ({
    id: `J${index + 1}`, kind: 'hinge' as const,
    a: { partId: ids[index]!, refId: 'bbox_axis_z_max', refKind: 'axis' as const },
    b: { partId: id, refId: 'bbox_axis_z_min', refKind: 'axis' as const },
    limit: { minAngleDeg: spec.joints[index]!.minDeg, maxAngleDeg: spec.joints[index]!.maxDeg },
    zeroAngleRef: {
      a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 },
      axisA: { x: 0, y: 0, z: 1 }, axisB: { x: 0, y: 0, z: 1 },
    },
  }));
  const pendingCatalogComponents = spec.joints.flatMap((_, index) => selectionJoints.has(index + 1) ? [] : [`motor_j${index + 1}`, `reducer_j${index + 1}`, `bearing_set_j${index + 1}`]).concat(['brake', 'encoder', 'internal_harness', 'tool_connector']);
  const parts: AiAssemblyPart[] = ids.map((id, index) => ({
    instanceId: id, definitionId: `robot:${id}`, featureTree: linkTree(id, linkLengths[index]!),
    metadata: { partNumber: `NX-R6-${String(index + 1).padStart(3, '0')}`, revision: 'A', material: index === 0 ? 'cast-aluminum' : 'aluminum-6061', process: 'machining', quantity: 1, source: 'assumed' as const },
  }));
  for (let joint = 1; joint <= 6; joint += 1) {
    const selection = selections.find(item => item.joint === joint);
    const components = selection ? [selection.motor, selection.reducer, selection.bearing] : placeholderDriveComponents(joint);
    const parentId = ids[joint - 1]!, parentPosition = assemblyParts[joint - 1]!.position;
    let anchorPartId = parentId;
    let anchorAxisRef = 'bbox_axis_z_max';
    let anchorPlaneRef = 'f.cap.top';
    let nextZ = parentPosition.z + linkLengths[joint - 1]!;
    for (const component of components) {
      const instanceId = `J${joint}:${component.kind}:${component.id}`;
      const definitionId = selection ? `catalog:${component.id}` : `placeholder:${component.id}`;
      assemblyParts.push({ id: instanceId, name: component.model, partTemplateId: definitionId, position: { x: parentPosition.x, y: parentPosition.y, z: nextZ }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: false });
      parts.push({ instanceId, definitionId, featureTree: envelopeTree(definitionId, component.envelopeMm), metadata: { partNumber: component.model, revision: component.revision, material: selection ? 'catalog-component' : 'engineering-placeholder', process: selection ? 'purchased' : 'selection-required', quantity: 1, source: selection ? 'catalog' as const : 'assumed' as const } });
      mates.push(
        { id: `${instanceId}:axis`, kind: 'concentric', a: { partId: anchorPartId, refId: anchorAxisRef, refKind: 'axis' }, b: { partId: instanceId, refId: 'bbox_axis_z_min', refKind: 'axis' } },
        { id: `${instanceId}:mount`, kind: 'coincident', a: { partId: anchorPartId, refId: anchorPlaneRef, refKind: 'plane' }, b: { partId: instanceId, refId: 'f.cap.bottom', refKind: 'plane' } },
        { id: `${instanceId}:clocking`, kind: 'angle', a: { partId: anchorPartId, refId: 'x_axis', refKind: 'axis' }, b: { partId: instanceId, refId: 'x_axis', refKind: 'axis' }, value: 0 },
      );
      anchorPartId = instanceId;
      anchorAxisRef = 'bbox_axis_z_max';
      anchorPlaneRef = 'f.cap.top';
      nextZ += component.envelopeMm.z;
    }
  }
  const quantityByDefinition = new Map<string, number>();
  for (const item of parts) if (item.definitionId) quantityByDefinition.set(item.definitionId, (quantityByDefinition.get(item.definitionId) ?? 0) + 1);
  for (const item of parts) if (item.definitionId) item.metadata.quantity = quantityByDefinition.get(item.definitionId) ?? 1;
  return { program: {
    version: 1, units: 'mm', classification: 'concept_only', name,
    assembly: { parts: assemblyParts, mates }, parts,
    structure: [{ id: 'robot-arm', name: 'Robot arm kinematic chain', instanceIds: [...ids], rigid: false }, ...spec.joints.map((_, index) => ({ id: `drive-J${index + 1}`, name: `Joint ${index + 1} drive`, instanceIds: assemblyParts.filter(part => part.id.startsWith(`J${index + 1}:`)).map(part => part.id), rigid: true }))],
    unresolved: pendingCatalogComponents.map(id => `${id}: catalog model and mounting interface must be selected`),
  }, pendingCatalogComponents };
}

function placeholderDriveComponents(joint: number) {
  return [
    { id: `motor-j${joint}-unselected`, kind: 'motor', model: `J${joint} motor placeholder`, revision: 'UNSELECTED', envelopeMm: { x: 60, y: 60, z: 80 } },
    { id: `reducer-j${joint}-unselected`, kind: 'reducer', model: `J${joint} reducer placeholder`, revision: 'UNSELECTED', envelopeMm: { x: 90, y: 90, z: 60 } },
    { id: `bearing-j${joint}-unselected`, kind: 'bearing', model: `J${joint} bearing placeholder`, revision: 'UNSELECTED', envelopeMm: { x: 55, y: 55, z: 16 } },
  ] as const;
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
