import { validateTree, type FeatureTree } from '@/lib/cad/featureTree';
import { validateAssembly, IDENTITY_QUAT, type PartInstance } from '@/lib/assembly/assemblyState';
import type { Mate } from '@/lib/assembly/mate';
import type { AiAssemblyProgram, AiPartMetadata } from './aiAssemblyProgram';

export type ProductRequirement = {
  id: string;
  text: string;
  category: 'function' | 'interface' | 'load' | 'motion' | 'material' | 'process' | 'safety';
  source: 'user' | 'manual' | 'derived';
  /** Stable provenance such as user:prompt, manual:MAN-ASM-001 or a reviewed artifact hash. */
  sourceRef?: string;
  acceptance?: string;
};

export type ComponentDefinition = {
  id: string;
  name: string;
  responsibility: string;
  makeOrBuy: 'make' | 'buy';
  featureTree: FeatureTree;
  metadata: Omit<AiPartMetadata, 'quantity'>;
  requirementIds: string[];
  parameterEvidence: GeometryParameterEvidence[];
};

export type GeometryParameterEvidence = {
  /** Stable numeric leaf path such as featureTree.nodes.body.payload.depth. */
  path: string;
  value: number;
  unit: 'mm' | 'deg' | 'ratio' | 'count';
  tolerance?: number;
  status: 'confirmed' | 'derived' | 'catalog';
  sourceRef: string;
  derivation?: string;
  inputSourceRefs?: string[];
  locked: boolean;
};

export type ComponentInstance = {
  id: string;
  definitionId: string;
  name?: string;
  positionMm: [number, number, number];
  orientation?: { x: number; y: number; z: number; w: number };
  fixed?: boolean;
};

export type ProductSubassembly = {
  id: string;
  name: string;
  instanceIds: string[];
  rigid: boolean;
  parentId?: string;
};

export type ProductDecompositionPlan = {
  version: 1;
  units: 'mm';
  productName: string;
  requirements: ProductRequirement[];
  definitions: ComponentDefinition[];
  instances: ComponentInstance[];
  mates: Mate[];
  subassemblies: ProductSubassembly[];
  observations: string[];
  assumptions: string[];
  unresolved: string[];
};

export type ProductDecompositionIssue = { path: string; message: string };

export function validateProductDecomposition(plan: ProductDecompositionPlan): ProductDecompositionIssue[] {
  const issues: ProductDecompositionIssue[] = [];
  if (plan.version !== 1) issues.push({ path: 'version', message: 'version must be 1' });
  if (plan.units !== 'mm') issues.push({ path: 'units', message: 'units must be mm' });
  if (!plan.productName.trim()) issues.push({ path: 'productName', message: 'product name is required' });

  const requirementIds = uniqueIds(plan.requirements, 'requirements', issues);
  const definitionIds = uniqueIds(plan.definitions, 'definitions', issues);
  const instanceIds = uniqueIds(plan.instances, 'instances', issues);
  const subassemblyIds = uniqueIds(plan.subassemblies, 'subassemblies', issues);

  plan.definitions.forEach((definition, index) => {
    if (!definition.name.trim()) issues.push({ path: `definitions[${index}].name`, message: 'name is required' });
    if (!definition.responsibility.trim()) issues.push({ path: `definitions[${index}].responsibility`, message: 'functional responsibility is required' });
    if (definition.makeOrBuy === 'make' && definition.featureTree.nodes.length === 0) {
      issues.push({ path: `definitions[${index}].featureTree`, message: 'manufactured component must have an independent non-empty feature tree' });
    }
    for (const id of definition.requirementIds) {
      if (!requirementIds.has(id)) issues.push({ path: `definitions[${index}].requirementIds`, message: `unknown requirement ${id}` });
    }
    try { validateTree(definition.featureTree); } catch (error) {
      issues.push({ path: `definitions[${index}].featureTree`, message: error instanceof Error ? error.message : 'invalid feature tree' });
    }
  });

  plan.instances.forEach((instance, index) => {
    if (!definitionIds.has(instance.definitionId)) issues.push({ path: `instances[${index}].definitionId`, message: `unknown definition ${instance.definitionId}` });
    if (instance.positionMm.length !== 3 || instance.positionMm.some(value => !Number.isFinite(value))) {
      issues.push({ path: `instances[${index}].positionMm`, message: 'position must contain three finite mm values' });
    }
  });
  if (plan.instances.length > 0 && !plan.instances.some(instance => instance.fixed)) {
    issues.push({ path: 'instances', message: 'at least one root instance must be fixed' });
  }

  const memberships = new Map<string, string>();
  plan.subassemblies.forEach((subassembly, index) => {
    if (subassembly.parentId && !subassemblyIds.has(subassembly.parentId)) issues.push({ path: `subassemblies[${index}].parentId`, message: `unknown parent ${subassembly.parentId}` });
    if (subassembly.parentId === subassembly.id) issues.push({ path: `subassemblies[${index}].parentId`, message: 'subassembly cannot parent itself' });
    for (const instanceId of subassembly.instanceIds) {
      if (!instanceIds.has(instanceId)) issues.push({ path: `subassemblies[${index}].instanceIds`, message: `unknown instance ${instanceId}` });
      const prior = memberships.get(instanceId);
      if (prior) issues.push({ path: `subassemblies[${index}].instanceIds`, message: `${instanceId} already belongs to ${prior}` });
      memberships.set(instanceId, subassembly.id);
    }
  });
  if (hasHierarchyCycle(plan.subassemblies)) issues.push({ path: 'subassemblies', message: 'subassembly hierarchy contains a cycle' });

  try {
    validateAssembly({ parts: plan.instances.map(toPartInstance), mates: plan.mates });
  } catch (error) {
    issues.push({ path: 'mates', message: error instanceof Error ? error.message : 'invalid mate graph' });
  }
  for (const definition of plan.definitions) {
    if (!plan.instances.some(instance => instance.definitionId === definition.id)) issues.push({ path: 'definitions', message: `unused component definition ${definition.id}` });
  }
  return issues;
}

export function compileProductDecomposition(plan: ProductDecompositionPlan):
  | { ok: true; program: AiAssemblyProgram }
  | { ok: false; issues: ProductDecompositionIssue[] } {
  const issues = validateProductDecomposition(plan);
  if (issues.length) return { ok: false, issues };
  const definitions = new Map(plan.definitions.map(definition => [definition.id, definition]));
  const quantityByDefinition = new Map<string, number>();
  for (const instance of plan.instances) quantityByDefinition.set(instance.definitionId, (quantityByDefinition.get(instance.definitionId) ?? 0) + 1);
  return {
    ok: true,
    program: {
      version: 1,
      units: 'mm',
      classification: plan.unresolved.length || plan.assumptions.length || plan.definitions.some(definition => definition.metadata.source === 'assumed') ? 'concept_only' : 'review_required',
      name: plan.productName,
      assembly: { parts: plan.instances.map(toPartInstance), mates: plan.mates },
      parts: plan.instances.map(instance => {
        const definition = definitions.get(instance.definitionId)!;
        return {
          instanceId: instance.id,
          definitionId: definition.id,
          featureTree: definition.featureTree,
          metadata: { ...definition.metadata, quantity: quantityByDefinition.get(definition.id) ?? 1 },
        };
      }),
      structure: plan.subassemblies.map(subassembly => ({ ...subassembly, instanceIds: [...subassembly.instanceIds] })),
      unresolved: [...plan.unresolved],
    },
  };
}

function toPartInstance(instance: ComponentInstance): PartInstance {
  return {
    id: instance.id,
    name: instance.name ?? instance.definitionId,
    partTemplateId: instance.definitionId,
    position: { x: instance.positionMm[0], y: instance.positionMm[1], z: instance.positionMm[2] },
    orientation: instance.orientation ?? IDENTITY_QUAT,
    fixed: instance.fixed ?? false,
  };
}

function uniqueIds(items: ReadonlyArray<{ id: string }>, path: string, issues: ProductDecompositionIssue[]): Set<string> {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (!item.id.trim()) issues.push({ path: `${path}[${index}].id`, message: 'id is required' });
    else if (ids.has(item.id)) issues.push({ path: `${path}[${index}].id`, message: `duplicate id ${item.id}` });
    ids.add(item.id);
  });
  return ids;
}

function hasHierarchyCycle(subassemblies: ProductSubassembly[]): boolean {
  const parent = new Map(subassemblies.map(subassembly => [subassembly.id, subassembly.parentId]));
  for (const start of parent.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parent.get(current);
    }
  }
  return false;
}
