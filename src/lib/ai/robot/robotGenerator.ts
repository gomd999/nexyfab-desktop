import type { AiAssemblyPart, AiAssemblyProgram } from '../aiAssemblyProgram';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { Mate } from '@/lib/assembly/mate';
import type { RobotEngineeringSpec } from './robotEngineering';
import type { JointSelection } from './componentSelector';
import { AUXILIARY_COMPONENT_KINDS, validateCatalog, type AuxiliaryCatalogComponent, type AuxiliaryComponentKind } from './componentCatalog';
import type { RobotAuxiliaryMount } from './robotCatalogSelection';

export type GeneratedRobot = {
  program: AiAssemblyProgram;
  pendingCatalogComponents: string[];
  intendedContacts: Array<{ partA: string; partB: string; justification: string }>;
};
export type RobotAuxiliarySelection = { kind: AuxiliaryComponentKind; component: AuxiliaryCatalogComponent; mount: RobotAuxiliaryMount; evidence: string[] };

export function generateRobot6Axis(spec: RobotEngineeringSpec, name = 'NexyFab 6-axis robot', selections: readonly JointSelection[] = [], auxiliarySelections: readonly RobotAuxiliarySelection[] = []): GeneratedRobot {
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
  const auxiliaryByKind = validateAuxiliarySelections(auxiliarySelections);
  const ids = ['base', 'shoulder', 'upper-arm', 'forearm', 'wrist-1', 'wrist-2', 'tool-flange'];
  const linkLengths = ids.map((id, index) => index === 0 ? 160 : Math.max(80, spec.joints[index - 1]!.aMm || spec.joints[index - 1]!.dMm));
  const componentsByJoint = spec.joints.map((_, index) => {
    const selection = selections.find(item => item.joint === index + 1);
    return selection ? [selection.motor, selection.reducer, selection.bearing] : placeholderDriveComponents(index + 1);
  });
  const structuralZ = [0];
  for (let joint = 1; joint <= 6; joint += 1) {
    const driveStackMm = componentsByJoint[joint - 1]!.reduce((sum, component) => sum + component.envelopeMm.z, 0);
    structuralZ.push(structuralZ[joint - 1]! + linkLengths[joint - 1]! + driveStackMm);
  }
  const assemblyParts = ids.map((id, index) => ({
    id, name: id, partTemplateId: `robot:${id}`,
    position: { x: 0, y: 0, z: structuralZ[index]! },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: index === 0,
  }));
  const mates: Mate[] = [];
  const intendedContacts: GeneratedRobot['intendedContacts'] = [];
  const pendingCatalogComponents = spec.joints.flatMap((_, index) => selectionJoints.has(index + 1) ? [] : [`motor_j${index + 1}`, `reducer_j${index + 1}`, `bearing_set_j${index + 1}`]).concat(auxiliaryByKind.size === 4 ? [] : ['brake', 'encoder', 'internal_harness', 'tool_connector']);
  const parts: AiAssemblyPart[] = ids.map((id, index) => ({
    instanceId: id, definitionId: `robot:${id}`, featureTree: linkTree(id, linkLengths[index]!),
    metadata: { partNumber: `NX-R6-${String(index + 1).padStart(3, '0')}`, revision: 'A', material: index === 0 ? 'cast-aluminum' : 'aluminum-6061', process: 'machining', quantity: 1, source: 'assumed' as const },
  }));
  for (let joint = 1; joint <= 6; joint += 1) {
    const selection = selections.find(item => item.joint === joint);
    const components = componentsByJoint[joint - 1]!;
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
      intendedContacts.push({
        partA: anchorPartId,
        partB: instanceId,
        justification: `J${joint} ${component.kind} axial mounting faces are coincident by design; volumetric interference is not permitted.`,
      });
      anchorPartId = instanceId;
      anchorAxisRef = 'bbox_axis_z_max';
      anchorPlaneRef = 'f.cap.top';
      nextZ += component.envelopeMm.z;
    }
    // The output link is driven from the top of the complete coaxial drive
    // stack. Mating it directly to the parent link placed the link and all
    // three drive envelopes in the same volume, creating deterministic false
    // geometry rather than a usable robot concept.
    mates.push({
      id: `J${joint}`, kind: 'hinge',
      a: { partId: anchorPartId, refId: 'bbox_axis_z_max', refKind: 'axis' },
      b: { partId: ids[joint]!, refId: 'bbox_axis_z_min', refKind: 'axis' },
      limit: { minAngleDeg: spec.joints[joint - 1]!.minDeg, maxAngleDeg: spec.joints[joint - 1]!.maxDeg },
      zeroAngleRef: {
        a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 },
        axisA: { x: 0, y: 0, z: 1 }, axisB: { x: 0, y: 0, z: 1 },
      },
    });
    intendedContacts.push({
      partA: anchorPartId,
      partB: ids[joint]!,
      justification: `J${joint} bearing output face supports the driven link; volumetric interference is not permitted.`,
    });
  }
  for (const kind of AUXILIARY_COMPONENT_KINDS) {
    const selection = auxiliaryByKind.get(kind); if (!selection) continue;
    const { component, mount } = selection; const parent = assemblyParts.find(part => part.id === mount.parentPartId);
    if (!parent) throw new Error(`${kind} explicit mount parent ${mount.parentPartId} is absent from the robot assembly.`);
    const instanceId = `AUX:${kind}:${component.id}`; const definitionId = `catalog:${component.id}`;
    if (assemblyParts.some(part => part.id === instanceId)) throw new Error(`${kind} auxiliary occurrence ID is duplicated.`);
    assemblyParts.push({ id: instanceId, name: component.model, partTemplateId: definitionId, position: { ...mount.positionMm }, orientation: { ...mount.orientation }, fixed: false });
    parts.push({ instanceId, definitionId, featureTree: envelopeTree(definitionId, component.envelopeMm), metadata: { partNumber: component.model, revision: component.revision, material: 'catalog-component', process: 'purchased', quantity: 1, source: 'catalog' as const } });
    mates.push(
      { id: `${instanceId}:axis`, kind: 'concentric', a: { partId: parent.id, refId: mount.parentAxisRef, refKind: 'axis' }, b: { partId: instanceId, refId: component.interface.axisRef, refKind: 'axis' } },
      { id: `${instanceId}:mount`, kind: 'coincident', a: { partId: parent.id, refId: mount.parentPlaneRef, refKind: 'plane' }, b: { partId: instanceId, refId: component.interface.mountingPlaneRef, refKind: 'plane' } },
    );
    intendedContacts.push({ partA: parent.id, partB: instanceId, justification: `${kind} catalog mounting faces are coincident by explicit placement; volumetric interference is not permitted.` });
  }
  const quantityByDefinition = new Map<string, number>();
  for (const item of parts) if (item.definitionId) quantityByDefinition.set(item.definitionId, (quantityByDefinition.get(item.definitionId) ?? 0) + 1);
  for (const item of parts) if (item.definitionId) item.metadata.quantity = quantityByDefinition.get(item.definitionId) ?? 1;
  return { program: {
    version: 1, units: 'mm', classification: 'concept_only', name,
    assembly: { parts: assemblyParts, mates }, parts,
    structure: [{ id: 'robot-arm', name: 'Robot arm kinematic chain', instanceIds: [...ids], rigid: false }, ...spec.joints.map((_, index) => ({ id: `drive-J${index + 1}`, name: `Joint ${index + 1} drive`, instanceIds: assemblyParts.filter(part => part.id.startsWith(`J${index + 1}:`)).map(part => part.id), rigid: true })), ...(auxiliaryByKind.size ? [{ id: 'robot-auxiliary', name: 'Robot auxiliary catalog components', instanceIds: assemblyParts.filter(part => part.id.startsWith('AUX:')).map(part => part.id), rigid: true }] : [])],
    unresolved: pendingCatalogComponents.map(id => `${id}: catalog model and mounting interface must be selected`),
  }, pendingCatalogComponents, intendedContacts };
}

function validateAuxiliarySelections(selections: readonly RobotAuxiliarySelection[]): Map<AuxiliaryComponentKind, RobotAuxiliarySelection> {
  if (selections.length !== 0 && selections.length !== 4) throw new Error('Auxiliary catalog integration requires exactly four explicit selections or none.');
  const byKind = new Map<AuxiliaryComponentKind, RobotAuxiliarySelection>();
  for (const selection of selections) {
    if (!AUXILIARY_COMPONENT_KINDS.includes(selection.kind) || selection.component.kind !== selection.kind) throw new Error(`Auxiliary catalog component kind is invalid: ${selection.kind}.`);
    if (byKind.has(selection.kind)) throw new Error(`Duplicate auxiliary catalog selection for ${selection.kind}.`);
    const issues = validateCatalog([selection.component]); if (issues.length) throw new Error(`${selection.kind} catalog selection invalid: ${issues.map(issue => `${issue.id}: ${issue.message}`).join('; ')}`);
    const norm = Math.hypot(selection.mount.orientation.x, selection.mount.orientation.y, selection.mount.orientation.z, selection.mount.orientation.w);
    if (Math.abs(norm - 1) > 1e-6 || ![selection.mount.parentPartId, selection.mount.parentAxisRef, selection.mount.parentPlaneRef].every(value => value.trim()) || Object.values(selection.mount.positionMm).some(value => !Number.isFinite(value))) throw new Error(`${selection.kind} explicit mount placement is invalid.`);
    if (!selection.evidence.length || selection.evidence.some(item => !item.trim())) throw new Error(`${selection.kind} catalog selection evidence is required.`);
    byKind.set(selection.kind, selection);
  }
  if (selections.length === 4 && AUXILIARY_COMPONENT_KINDS.some(kind => !byKind.has(kind))) throw new Error('Auxiliary catalog selections must include brake, encoder, harness and tool_connector exactly once.');
  return byKind;
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
