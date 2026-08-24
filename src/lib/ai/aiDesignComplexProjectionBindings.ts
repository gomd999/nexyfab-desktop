import { serverEvidenceSha256 } from './serverEvidence';
import type { ProductStructureGraphV1 } from './aiDesignProductStructureGraph';
import type { AiDesignCrossDomainConstraintGraphV1 } from './aiDesignCrossDomainConstraintGraph';
import type { AiDesignAssemblyGaugeBindingV1, AiDesignStructureConstraintBindingV1 } from './aiDesignComplexWorkspaceViewModel';

export const AI_DESIGN_GAUGE_BINDINGS_SCHEMA = 'nexyfab.ai-design-gauge-bindings.v1' as const;
export const AI_DESIGN_CONSTRAINT_BINDINGS_SCHEMA = 'nexyfab.ai-design-constraint-bindings.v1' as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BINDINGS = 2_000;

export interface AiDesignGaugeBindingsArtifactV1 {
  schema: typeof AI_DESIGN_GAUGE_BINDINGS_SCHEMA;
  artifactId: string;
  projectId: string;
  sessionId: string;
  productStructureDigest: string;
  bindings: readonly AiDesignAssemblyGaugeBindingV1[];
  createdAt: string;
  exactAuthority: false;
  manufacturingAuthority: false;
  artifactDigest: string;
}

export interface AiDesignConstraintBindingsArtifactV1 {
  schema: typeof AI_DESIGN_CONSTRAINT_BINDINGS_SCHEMA;
  artifactId: string;
  projectId: string;
  sessionId: string;
  productStructureDigest: string;
  crossDomainContentHash: string;
  bindings: readonly AiDesignStructureConstraintBindingV1[];
  createdAt: string;
  exactAuthority: false;
  manufacturingAuthority: false;
  artifactDigest: string;
}

function material<T extends { artifactDigest: string }>(value: T): Omit<T, 'artifactDigest'> {
  const { artifactDigest: _artifactDigest, ...rest } = value;
  return rest;
}

export function validateAiDesignGaugeBindingsArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['gauge_bindings_not_object'];
  const artifact = value as AiDesignGaugeBindingsArtifactV1; const issues: string[] = [];
  if (artifact.schema !== AI_DESIGN_GAUGE_BINDINGS_SCHEMA || !ID.test(artifact.artifactId ?? '') || !ID.test(artifact.projectId ?? '') || !ID.test(artifact.sessionId ?? '') || !HASH.test(artifact.productStructureDigest ?? '')) issues.push('gauge_bindings_scope_invalid');
  if (!Array.isArray(artifact.bindings) || artifact.bindings.length > MAX_BINDINGS || new Set(artifact.bindings.map(item => item.bindingId)).size !== artifact.bindings.length
    || artifact.bindings.some(item => !ID.test(item.bindingId ?? '') || !ID.test(item.gaugeId ?? '') || !ID.test(item.structureNodeId ?? '') || !ID.test(item.parameterId ?? '') || !['component', 'subtree', 'interface'].includes(item.scope) || item.interfaceId !== null && !ID.test(item.interfaceId) || !Array.isArray(item.affectedNodeIds) || item.affectedNodeIds.length > MAX_BINDINGS || item.affectedNodeIds.some((id: string) => !ID.test(id)))) issues.push('gauge_bindings_shape_invalid');
  if (!Number.isFinite(Date.parse(artifact.createdAt)) || artifact.exactAuthority !== false || artifact.manufacturingAuthority !== false || !HASH.test(artifact.artifactDigest ?? '')) issues.push('gauge_bindings_authority_invalid');
  if (issues.length === 0 && artifact.artifactDigest !== serverEvidenceSha256(material(artifact))) issues.push('gauge_bindings_digest_mismatch');
  return [...new Set(issues)];
}

export function createAiDesignGaugeBindingsArtifact(input: {
  artifactId: string; graph: ProductStructureGraphV1; bindings: readonly AiDesignAssemblyGaugeBindingV1[]; allowedGaugeIds: ReadonlySet<string>; createdAt: string;
}): AiDesignGaugeBindingsArtifactV1 {
  const nodes = new Set(input.graph.nodes.map(item => item.nodeId)); const interfaces = new Set(input.graph.interfaces.map(item => item.interfaceId));
  if (input.bindings.some(item => !input.allowedGaugeIds.has(item.gaugeId) || !nodes.has(item.structureNodeId) || item.affectedNodeIds.some(id => !nodes.has(id)) || item.interfaceId !== null && !interfaces.has(item.interfaceId))) throw new Error('AI_DESIGN_GAUGE_BINDING_SCOPE_INVALID');
  const base = { schema: AI_DESIGN_GAUGE_BINDINGS_SCHEMA, artifactId: input.artifactId, projectId: input.graph.projectId, sessionId: input.graph.sessionId, productStructureDigest: input.graph.graphDigest, bindings: structuredClone(input.bindings), createdAt: input.createdAt, exactAuthority: false as const, manufacturingAuthority: false as const };
  const artifact = Object.freeze({ ...base, artifactDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignGaugeBindingsArtifact(artifact); if (issues.length) throw new Error(`AI_DESIGN_GAUGE_BINDINGS_INVALID:${issues.join(',')}`);
  return artifact;
}

export function validateAiDesignConstraintBindingsArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['constraint_bindings_not_object'];
  const artifact = value as AiDesignConstraintBindingsArtifactV1; const issues: string[] = [];
  if (artifact.schema !== AI_DESIGN_CONSTRAINT_BINDINGS_SCHEMA || !ID.test(artifact.artifactId ?? '') || !ID.test(artifact.projectId ?? '') || !ID.test(artifact.sessionId ?? '') || !HASH.test(artifact.productStructureDigest ?? '') || !HASH.test(artifact.crossDomainContentHash ?? '')) issues.push('constraint_bindings_scope_invalid');
  if (!Array.isArray(artifact.bindings) || artifact.bindings.length > MAX_BINDINGS || new Set(artifact.bindings.map(item => item.crossDomainNodeId)).size !== artifact.bindings.length
    || artifact.bindings.some(item => !ID.test(item.crossDomainNodeId ?? '') || !Array.isArray(item.structureNodeIds) || item.structureNodeIds.length > MAX_BINDINGS || item.structureNodeIds.some((id: string) => !ID.test(id)))) issues.push('constraint_bindings_shape_invalid');
  if (!Number.isFinite(Date.parse(artifact.createdAt)) || artifact.exactAuthority !== false || artifact.manufacturingAuthority !== false || !HASH.test(artifact.artifactDigest ?? '')) issues.push('constraint_bindings_authority_invalid');
  if (issues.length === 0 && artifact.artifactDigest !== serverEvidenceSha256(material(artifact))) issues.push('constraint_bindings_digest_mismatch');
  return [...new Set(issues)];
}

export function createAiDesignConstraintBindingsArtifact(input: {
  artifactId: string; productStructure: ProductStructureGraphV1; crossDomainGraph: AiDesignCrossDomainConstraintGraphV1; bindings: readonly AiDesignStructureConstraintBindingV1[]; createdAt: string;
}): AiDesignConstraintBindingsArtifactV1 {
  const nodes = new Set(input.productStructure.nodes.map(item => item.nodeId)); const constraints = new Set(input.crossDomainGraph.nodes.map(item => item.id));
  if (input.bindings.some(item => !constraints.has(item.crossDomainNodeId) || item.structureNodeIds.some(id => !nodes.has(id)))) throw new Error('AI_DESIGN_CONSTRAINT_BINDING_SCOPE_INVALID');
  const base = { schema: AI_DESIGN_CONSTRAINT_BINDINGS_SCHEMA, artifactId: input.artifactId, projectId: input.productStructure.projectId, sessionId: input.productStructure.sessionId, productStructureDigest: input.productStructure.graphDigest, crossDomainContentHash: input.crossDomainGraph.contentHash, bindings: structuredClone(input.bindings), createdAt: input.createdAt, exactAuthority: false as const, manufacturingAuthority: false as const };
  const artifact = Object.freeze({ ...base, artifactDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignConstraintBindingsArtifact(artifact); if (issues.length) throw new Error(`AI_DESIGN_CONSTRAINT_BINDINGS_INVALID:${issues.join(',')}`);
  return artifact;
}
