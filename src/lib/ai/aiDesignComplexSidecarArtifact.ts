import {
  validateProductStructureGraph,
  type ProductStructureGraphV1,
} from './aiDesignProductStructureGraph';
import {
  validateAiDesignCrossDomainConstraintGraph,
  type AiDesignCrossDomainConstraintGraphV1,
} from './aiDesignCrossDomainConstraintGraph';
import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_SCHEMA = 'nexyfab.ai-design-product-structure-sidecar.v1' as const;
export const AI_DESIGN_CROSS_DOMAIN_SIDECAR_SCHEMA = 'nexyfab.ai-design-cross-domain-sidecar.v1' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;

interface AiDesignSidecarArtifactBase {
  artifactId: string;
  projectId: string;
  sessionId: string;
  source: 'user_confirmed_concept' | 'server_generated_concept';
  createdAt: string;
  trustedServerEnvelope: true;
  exactAuthority: false;
  manufacturingAuthority: false;
  artifactDigest: string;
}

export interface AiDesignProductStructureSidecarArtifactV1 extends AiDesignSidecarArtifactBase {
  schema: typeof AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_SCHEMA;
  graphDigest: string;
  graph: ProductStructureGraphV1;
}

export interface AiDesignCrossDomainSidecarArtifactV1 extends AiDesignSidecarArtifactBase {
  schema: typeof AI_DESIGN_CROSS_DOMAIN_SIDECAR_SCHEMA;
  graphContentHash: string;
  graph: AiDesignCrossDomainConstraintGraphV1;
}

function material<T extends { artifactDigest: string }>(value: T): Omit<T, 'artifactDigest'> {
  const { artifactDigest: _artifactDigest, ...rest } = value;
  return rest;
}

function timestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function commonIssues(value: AiDesignSidecarArtifactBase): string[] {
  const issues: string[] = [];
  if (!ID.test(value.artifactId ?? '') || !ID.test(value.projectId ?? '') || !ID.test(value.sessionId ?? '')) issues.push('sidecar_binding_invalid');
  if (!['user_confirmed_concept', 'server_generated_concept'].includes(value.source) || !timestamp(value.createdAt)) issues.push('sidecar_provenance_invalid');
  if (value.trustedServerEnvelope !== true || value.exactAuthority !== false || value.manufacturingAuthority !== false) issues.push('sidecar_authority_invalid');
  if (!SHA256.test(value.artifactDigest ?? '')) issues.push('sidecar_digest_invalid');
  return issues;
}

export function createAiDesignProductStructureSidecarArtifact(
  graph: ProductStructureGraphV1,
  options: { artifactId: string; source: AiDesignSidecarArtifactBase['source']; createdAt?: string },
): AiDesignProductStructureSidecarArtifactV1 {
  const graphIssues = validateProductStructureGraph(graph);
  if (graphIssues.length) throw new Error(`AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_INVALID:${graphIssues.join(',')}`);
  if (graph.interfaces.some(item => item.exactGeometryStatus !== 'not_run' || item.manufacturingStatus !== 'not_run')) throw new Error('AI_DESIGN_PRODUCT_STRUCTURE_CLIENT_AUTHORITY_FORBIDDEN');
  const base = {
    schema: AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_SCHEMA,
    artifactId: options.artifactId,
    projectId: graph.projectId,
    sessionId: graph.sessionId,
    source: options.source,
    createdAt: options.createdAt ?? new Date().toISOString(),
    trustedServerEnvelope: true as const,
    exactAuthority: false as const,
    manufacturingAuthority: false as const,
    graphDigest: graph.graphDigest,
    graph: structuredClone(graph),
  };
  const artifact = { ...base, artifactDigest: serverEvidenceSha256(base) };
  const issues = validateAiDesignProductStructureSidecarArtifact(artifact);
  if (issues.length) throw new Error(`AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_INVALID:${issues.join(',')}`);
  return Object.freeze(artifact);
}

export function validateAiDesignProductStructureSidecarArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['product_structure_sidecar_not_object'];
  const artifact = value as AiDesignProductStructureSidecarArtifactV1;
  const issues = commonIssues(artifact);
  if (artifact.schema !== AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_SCHEMA || !SHA256.test(artifact.graphDigest ?? '')) issues.push('product_structure_sidecar_schema_invalid');
  const graphIssues = validateProductStructureGraph(artifact.graph);
  if (graphIssues.length || artifact.graph?.projectId !== artifact.projectId || artifact.graph?.sessionId !== artifact.sessionId || artifact.graph?.graphDigest !== artifact.graphDigest) issues.push('product_structure_sidecar_graph_invalid');
  if (artifact.graph?.interfaces?.some(item => item.exactGeometryStatus !== 'not_run' || item.manufacturingStatus !== 'not_run')) issues.push('product_structure_sidecar_authority_invalid');
  if (issues.length === 0 && artifact.artifactDigest !== serverEvidenceSha256(material(artifact))) issues.push('product_structure_sidecar_digest_mismatch');
  return [...new Set(issues)];
}

export function createAiDesignCrossDomainSidecarArtifact(
  graph: AiDesignCrossDomainConstraintGraphV1,
  options: { artifactId: string; source: AiDesignSidecarArtifactBase['source']; createdAt?: string },
): AiDesignCrossDomainSidecarArtifactV1 {
  const graphIssues = validateAiDesignCrossDomainConstraintGraph(graph);
  if (graphIssues.length) throw new Error(`AI_DESIGN_CROSS_DOMAIN_SIDECAR_INVALID:${graphIssues.join(',')}`);
  const base = {
    schema: AI_DESIGN_CROSS_DOMAIN_SIDECAR_SCHEMA,
    artifactId: options.artifactId,
    projectId: graph.projectId,
    sessionId: graph.sessionId,
    source: options.source,
    createdAt: options.createdAt ?? new Date().toISOString(),
    trustedServerEnvelope: true as const,
    exactAuthority: false as const,
    manufacturingAuthority: false as const,
    graphContentHash: graph.contentHash,
    graph: structuredClone(graph),
  };
  const artifact = { ...base, artifactDigest: serverEvidenceSha256(base) };
  const issues = validateAiDesignCrossDomainSidecarArtifact(artifact);
  if (issues.length) throw new Error(`AI_DESIGN_CROSS_DOMAIN_SIDECAR_INVALID:${issues.join(',')}`);
  return Object.freeze(artifact);
}

export function validateAiDesignCrossDomainSidecarArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['cross_domain_sidecar_not_object'];
  const artifact = value as AiDesignCrossDomainSidecarArtifactV1;
  const issues = commonIssues(artifact);
  if (artifact.schema !== AI_DESIGN_CROSS_DOMAIN_SIDECAR_SCHEMA || !SHA256.test(artifact.graphContentHash ?? '')) issues.push('cross_domain_sidecar_schema_invalid');
  const graphIssues = validateAiDesignCrossDomainConstraintGraph(artifact.graph);
  if (graphIssues.length || artifact.graph?.projectId !== artifact.projectId || artifact.graph?.sessionId !== artifact.sessionId || artifact.graph?.contentHash !== artifact.graphContentHash) issues.push('cross_domain_sidecar_graph_invalid');
  if (issues.length === 0 && artifact.artifactDigest !== serverEvidenceSha256(material(artifact))) issues.push('cross_domain_sidecar_digest_mismatch');
  return [...new Set(issues)];
}
