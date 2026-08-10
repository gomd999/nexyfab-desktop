/**
 * Canonical AI → CAD assembly envelope.
 *
 * This intentionally reuses the production FeatureTree and AssemblyState
 * instead of introducing an AI-only geometry model. Both simple and expert
 * experiences therefore open the same editable parts, mates and metadata.
 */
import { validateTree, type FeatureTree } from '@/lib/cad/featureTree';
import { validateAssembly } from '@/lib/assembly/assemblyState';
import type { NestedAssemblyState } from '@/lib/assembly/subAssembly';
import { generationArtifactHash } from './generationRunState';

export type AiPartMetadata = {
  partNumber: string;
  revision: string;
  material?: string;
  process?: string;
  quantity: number;
  source: 'confirmed' | 'assumed' | 'catalog';
  catalogId?: string;
  catalogRevision?: string;
  artifactSha256?: string;
};

export type AiAssemblyPart = {
  instanceId: string;
  /** Shared component definition for repeated instances and consolidated BOM. */
  definitionId?: string;
  featureTree: FeatureTree;
  metadata: AiPartMetadata;
};

export type AiAssemblyProgram = {
  version: 1;
  units: 'mm';
  classification: 'concept_only' | 'review_required';
  name: string;
  assembly: NestedAssemblyState;
  parts: AiAssemblyPart[];
  structure?: Array<{ id: string; name: string; instanceIds: string[]; rigid: boolean; parentId?: string }>;
  unresolved: string[];
};

export type AiAssemblyIssue = { path: string; message: string };

export function validateAiAssemblyProgram(program: AiAssemblyProgram): AiAssemblyIssue[] {
  const issues: AiAssemblyIssue[] = [];
  if (program.version !== 1) issues.push({ path: 'version', message: 'version must be 1' });
  if (program.units !== 'mm') issues.push({ path: 'units', message: 'units must be mm' });
  if (!program.name.trim()) issues.push({ path: 'name', message: 'name is required' });
  if (program.classification === 'review_required' && program.unresolved.length > 0) {
    issues.push({ path: 'classification', message: 'unresolved inputs require concept_only' });
  }

  try {
    validateAssembly(program.assembly);
  } catch (error) {
    issues.push({ path: 'assembly', message: error instanceof Error ? error.message : 'invalid assembly' });
  }

  const instanceIds = new Set(program.assembly.parts.map(part => part.id));
  const assemblyById = new Map(program.assembly.parts.map(part => [part.id, part]));
  const declared = new Set<string>();
  const partNumbers = new Map<string, string | undefined>();
  const definitionSignatures = new Map<string, string>();
  program.parts.forEach((part, index) => {
    const path = `parts[${index}]`;
    if (!instanceIds.has(part.instanceId)) {
      issues.push({ path: `${path}.instanceId`, message: 'must reference an assembly part instance' });
    }
    if (declared.has(part.instanceId)) {
      issues.push({ path: `${path}.instanceId`, message: 'each instance may have only one part definition' });
    }
    declared.add(part.instanceId);
    const assemblyPart = assemblyById.get(part.instanceId);
    const legacyTemplateMatch = part.definitionId && assemblyPart && part.definitionId.endsWith(`:${assemblyPart.partTemplateId}`);
    if (part.definitionId && assemblyPart && assemblyPart.partTemplateId !== part.definitionId && !legacyTemplateMatch) {
      issues.push({ path: `${path}.definitionId`, message: `definition ${part.definitionId} does not match assembly template ${assemblyPart.partTemplateId}` });
    }
    if (!part.metadata.partNumber.trim()) {
      issues.push({ path: `${path}.metadata.partNumber`, message: 'part number is required' });
    } else if (partNumbers.has(part.metadata.partNumber) && partNumbers.get(part.metadata.partNumber) !== part.definitionId) {
      issues.push({ path: `${path}.metadata.partNumber`, message: 'part number may repeat only for the same component definition' });
    }
    partNumbers.set(part.metadata.partNumber, part.definitionId);
    if (program.classification === 'review_required' && part.metadata.source === 'assumed') {
      issues.push({ path: `${path}.metadata.source`, message: 'assumed component metadata requires concept_only classification' });
    }
    if (!Number.isInteger(part.metadata.quantity) || part.metadata.quantity < 1) {
      issues.push({ path: `${path}.metadata.quantity`, message: 'quantity must be a positive integer' });
    }
    try {
      validateTree(part.featureTree);
    } catch (error) {
      issues.push({ path: `${path}.featureTree`, message: error instanceof Error ? error.message : 'invalid feature tree' });
    }
    if (part.definitionId) {
      const signature = generationArtifactHash({ featureTree: part.featureTree, partNumber: part.metadata.partNumber, material: part.metadata.material, process: part.metadata.process });
      const prior = definitionSignatures.get(part.definitionId);
      if (prior && prior !== signature) issues.push({ path, message: `repeated definition ${part.definitionId} has divergent geometry or manufacturing metadata` });
      definitionSignatures.set(part.definitionId, signature);
    }
  });

  for (const instanceId of instanceIds) {
    if (!declared.has(instanceId)) {
      issues.push({ path: 'parts', message: `missing feature tree for assembly instance ${instanceId}` });
    }
  }

  const structureIds = new Set<string>();
  const structureById = new Map<string, NonNullable<AiAssemblyProgram['structure']>[number]>();
  const structuredInstances = new Set<string>();
  for (const [index, group] of (program.structure ?? []).entries()) {
    const path = `structure[${index}]`;
    if (!group.id.trim()) issues.push({ path: `${path}.id`, message: 'subassembly id is required' });
    if (structureIds.has(group.id)) issues.push({ path: `${path}.id`, message: `duplicate subassembly id ${group.id}` });
    structureIds.add(group.id);
    structureById.set(group.id, group);
    if (group.parentId === group.id) issues.push({ path: `${path}.parentId`, message: 'subassembly cannot parent itself' });
    for (const instanceId of group.instanceIds) {
      if (!instanceIds.has(instanceId)) {
        issues.push({ path: `${path}.instanceIds`, message: `unknown assembly instance ${instanceId}` });
      }
      if (structuredInstances.has(instanceId)) {
        issues.push({ path: `${path}.instanceIds`, message: `assembly instance ${instanceId} belongs to multiple subassemblies` });
      }
      structuredInstances.add(instanceId);
    }
  }
  for (const [index, group] of (program.structure ?? []).entries()) {
    if (group.parentId && !structureById.has(group.parentId)) {
      issues.push({ path: `structure[${index}].parentId`, message: `unknown parent subassembly ${group.parentId}` });
    }
    const visited = new Set<string>();
    let cursor: typeof group | undefined = group;
    while (cursor?.parentId) {
      if (visited.has(cursor.id)) {
        issues.push({ path: `structure[${index}].parentId`, message: `subassembly hierarchy contains a cycle at ${cursor.id}` });
        break;
      }
      visited.add(cursor.id);
      cursor = structureById.get(cursor.parentId);
    }
  }
  return issues;
}
