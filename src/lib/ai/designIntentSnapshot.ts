import type { AiAssemblyProgram } from './aiAssemblyProgram';
import type { ProductDecompositionPlan } from './productDecomposition';
import { serverEvidenceSha256 } from './serverEvidence';

export interface DesignIntentSnapshot {
  schema: 'nexyfab.design-intent-snapshot.v1';
  units: 'mm';
  productName: string;
  requirements: Array<{ id: string; category: string; sourceRef: string; acceptance: string | null }>;
  definitions: Array<{ id: string; makeOrBuy: 'make' | 'buy'; requirementIds: string[]; featureNodeIds: string[] }>;
  instances: Array<{ id: string; definitionId: string }>;
  mates: Array<{ id: string; kind: string; a: string; b: string; refA: string; refB: string }>;
  subassemblies: Array<{ id: string; parentId: string | null; rigid: boolean; instanceIds: string[] }>;
  physicalNetworksSha256: string;
}

export interface SemanticPreservationResult {
  passed: boolean;
  errors: string[];
}

const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));
const same = (left: Iterable<string>, right: Iterable<string>) => {
  const a = sorted(left), b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export function buildDesignIntentSnapshot(plan: ProductDecompositionPlan): DesignIntentSnapshot {
  return {
    schema: 'nexyfab.design-intent-snapshot.v1',
    units: plan.units,
    productName: plan.productName,
    requirements: plan.requirements.map(requirement => ({
      id: requirement.id,
      category: requirement.category,
      sourceRef: requirement.sourceRef ?? '',
      acceptance: requirement.acceptance ?? null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    definitions: plan.definitions.map(definition => ({
      id: definition.id,
      makeOrBuy: definition.makeOrBuy,
      requirementIds: sorted(definition.requirementIds),
      featureNodeIds: sorted(definition.featureTree.nodes.map(node => node.id)),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    instances: plan.instances.map(instance => ({ id: instance.id, definitionId: instance.definitionId })).sort((a, b) => a.id.localeCompare(b.id)),
    mates: plan.mates.map(mate => ({ id: mate.id, kind: mate.kind, a: mate.a.partId, b: mate.b.partId, refA: mate.a.refId, refB: mate.b.refId })).sort((a, b) => a.id.localeCompare(b.id)),
    subassemblies: plan.subassemblies.map(group => ({ id: group.id, parentId: group.parentId ?? null, rigid: group.rigid, instanceIds: sorted(group.instanceIds) })).sort((a, b) => a.id.localeCompare(b.id)),
    physicalNetworksSha256: serverEvidenceSha256(plan.physicalNetworks ?? []),
  };
}

/** Prevents a compiled or repaired program from silently reducing the accepted design. */
export function verifyProgramPreservesIntent(snapshot: DesignIntentSnapshot, program: AiAssemblyProgram): SemanticPreservationResult {
  const errors: string[] = [];
  const expectedInstances = new Map(snapshot.instances.map(instance => [instance.id, instance]));
  const actualInstances = new Map(program.parts.map(part => [part.instanceId, part]));
  if (!same(expectedInstances.keys(), actualInstances.keys())) errors.push('SEMANTIC_INSTANCE_INVENTORY_MISMATCH');

  for (const [id, expected] of expectedInstances) {
    const actual = actualInstances.get(id);
    if (!actual) { errors.push(`UNAPPROVED_COMPONENT_REMOVAL:${id}`); continue; }
    if (actual.definitionId !== expected.definitionId) errors.push(`COMPONENT_DEFINITION_CHANGED:${id}`);
  }

  const expectedDefinitions = new Map(snapshot.definitions.map(definition => [definition.id, definition]));
  const actualDefinitions = new Map<string, Set<string>>();
  for (const part of program.parts) {
    if (!part.definitionId) { errors.push(`COMPONENT_DEFINITION_MISSING:${part.instanceId}`); continue; }
    const nodeIds = new Set(part.featureTree.nodes.map(node => node.id));
    const prior = actualDefinitions.get(part.definitionId);
    if (prior && !same(prior, nodeIds)) errors.push(`REPEATED_DEFINITION_DIVERGED:${part.definitionId}`);
    else actualDefinitions.set(part.definitionId, nodeIds);
  }
  if (!same(expectedDefinitions.keys(), actualDefinitions.keys())) errors.push('SEMANTIC_DEFINITION_INVENTORY_MISMATCH');
  for (const [id, expected] of expectedDefinitions) {
    const actual = actualDefinitions.get(id);
    if (!actual) continue;
    if (!same(expected.featureNodeIds, actual)) errors.push(`CRITICAL_FEATURE_INVENTORY_MISMATCH:${id}`);
  }

  const expectedMates = snapshot.mates.map(mate => `${mate.id}|${mate.kind}|${mate.a}|${mate.b}|${mate.refA}|${mate.refB}`);
  const actualMates = program.assembly.mates.map(mate => `${mate.id}|${mate.kind}|${mate.a.partId}|${mate.b.partId}|${mate.a.refId}|${mate.b.refId}`);
  if (!same(expectedMates, actualMates)) errors.push('INTERFACE_TOPOLOGY_CHANGED');

  const expectedGroups = snapshot.subassemblies.map(group => `${group.id}|${group.parentId ?? ''}|${group.rigid}|${group.instanceIds.join(',')}`);
  const actualGroups = (program.structure ?? []).map(group => `${group.id}|${group.parentId ?? ''}|${group.rigid}|${sorted(group.instanceIds).join(',')}`);
  if (!same(expectedGroups, actualGroups)) errors.push('ASSEMBLY_HIERARCHY_COLLAPSED');
  if (snapshot.physicalNetworksSha256 !== serverEvidenceSha256(program.physicalNetworks ?? [])) errors.push('PHYSICAL_NETWORK_TOPOLOGY_CHANGED');

  return { passed: errors.length === 0, errors: [...new Set(errors)].sort() };
}
