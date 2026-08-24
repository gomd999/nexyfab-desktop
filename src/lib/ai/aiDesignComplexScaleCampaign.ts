import { createHash } from 'node:crypto';
import {
  createProductStructureGraph,
  PRODUCT_STRUCTURE_MAX_EDGES,
  PRODUCT_STRUCTURE_MAX_NODES,
  validateProductStructureGraph,
  type ProductStructureEdgeV1,
  type ProductStructureNodeV1,
} from './aiDesignProductStructureGraph';
import {
  AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES,
  AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES,
  AI_DESIGN_CROSS_DOMAINS,
  createAiDesignCrossDomainConstraintGraph,
  validateAiDesignCrossDomainConstraintGraph,
  type AiDesignCrossDomainEdge,
  type AiDesignCrossDomainNode,
} from './aiDesignCrossDomainConstraintGraph';
import {
  AI_DESIGN_PARTITION_MAX,
  createAiDesignGraphPartitions,
  validateAiDesignGraphPartition,
  type AiDesignGraphPartitionV1,
} from './aiDesignHierarchicalCandidatePartition';

export const AI_DESIGN_COMPLEX_SCALE_CAMPAIGN_SCHEMA = 'nexyfab.ai-design-complex-scale-campaign.v1' as const;

export interface AiDesignComplexScaleCampaignConfigV1 {
  projectId: string;
  sessionId: string;
  structureNodeCount?: number;
  structureEdgeCount?: number;
  crossDomainNodeCount?: number;
  crossDomainEdgeCount?: number;
  partitionCount?: number;
}

export interface AiDesignComplexScaleCampaignV1 {
  schema: typeof AI_DESIGN_COMPLEX_SCALE_CAMPAIGN_SCHEMA;
  campaignId: string;
  campaignDigest: string;
  config: Required<AiDesignComplexScaleCampaignConfigV1>;
  outcome: 'PASS' | 'FAIL';
  issues: readonly string[];
  measuredDurationMs: number;
  scale: {
    structureNodes: number;
    structureEdges: number;
    crossDomainNodes: number;
    crossDomainEdges: number;
    partitions: number;
    completePartitionCoverage: boolean;
  };
  authority: {
    syntheticOnly: true;
    sourceContentIncluded: false;
    proprietaryGeometryIncluded: false;
    exactCadVerified: false;
    manufacturingReleaseReady: false;
  };
  artifacts: {
    productStructure: ReturnType<typeof createProductStructureGraph>;
    crossDomainGraph: ReturnType<typeof createAiDesignCrossDomainConstraintGraph>;
    partitions: readonly AiDesignGraphPartitionV1[];
  };
}

const HASH = 'a'.repeat(64);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedInteger(value: number, min: number, max: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(code);
  return value;
}

function normalizedConfig(input: AiDesignComplexScaleCampaignConfigV1): Required<AiDesignComplexScaleCampaignConfigV1> {
  if (!ID.test(input.projectId) || !ID.test(input.sessionId)) throw new Error('AI_DESIGN_SCALE_CAMPAIGN_SCOPE_INVALID');
  const structureNodeCount = boundedInteger(input.structureNodeCount ?? PRODUCT_STRUCTURE_MAX_NODES, 2, PRODUCT_STRUCTURE_MAX_NODES, 'AI_DESIGN_SCALE_STRUCTURE_NODES_INVALID');
  const structureEdgeCount = boundedInteger(input.structureEdgeCount ?? PRODUCT_STRUCTURE_MAX_EDGES, structureNodeCount - 1, PRODUCT_STRUCTURE_MAX_EDGES, 'AI_DESIGN_SCALE_STRUCTURE_EDGES_INVALID');
  const crossDomainNodeCount = boundedInteger(input.crossDomainNodeCount ?? AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES, 2, AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES, 'AI_DESIGN_SCALE_CROSS_NODES_INVALID');
  const crossDomainEdgeCount = boundedInteger(input.crossDomainEdgeCount ?? AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES, 0, AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES, 'AI_DESIGN_SCALE_CROSS_EDGES_INVALID');
  const partitionCount = boundedInteger(input.partitionCount ?? AI_DESIGN_PARTITION_MAX, 1, Math.min(AI_DESIGN_PARTITION_MAX, structureNodeCount), 'AI_DESIGN_SCALE_PARTITIONS_INVALID');
  return { ...input, structureNodeCount, structureEdgeCount, crossDomainNodeCount, crossDomainEdgeCount, partitionCount };
}

function structureNodes(count: number): ProductStructureNodeV1[] {
  return Array.from({ length: count }, (_, index) => ({
    nodeId: index === 0 ? 'root-assembly' : `component-${index}`,
    kind: index === 0 ? 'assembly' : 'component',
    label: index === 0 ? 'Synthetic root assembly' : `Synthetic component ${index}`,
    parentId: index === 0 ? null : 'root-assembly',
    sourceIntentNodeIds: ['synthetic-scale-intent'],
    sourceDigest: HASH,
  }));
}

function structureEdges(nodes: readonly ProductStructureNodeV1[], count: number): ProductStructureEdgeV1[] {
  const edges: ProductStructureEdgeV1[] = nodes.slice(1).map((node, index) => ({ edgeId: `contains-${index + 1}`, kind: 'contains', from: 'root-assembly', to: node.nodeId }));
  const componentCount = nodes.length - 1;
  for (let index = 0; edges.length < count; index += 1) {
    const fromIndex = 1 + (index % componentCount);
    let toIndex = componentCount === 1 ? 0 : 1 + ((index + 997) % componentCount);
    if (toIndex === fromIndex) toIndex = 1 + (toIndex % componentCount);
    edges.push({ edgeId: `reference-${index}`, kind: 'references', from: nodes[fromIndex]!.nodeId, to: nodes[toIndex]!.nodeId });
  }
  return edges;
}

function crossNodes(count: number): Array<Omit<AiDesignCrossDomainNode, 'status'>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `constraint-${index}`, kind: 'constraint', domain: AI_DESIGN_CROSS_DOMAINS[index % AI_DESIGN_CROSS_DOMAINS.length]!,
    key: `synthetic.constraint.${index}`, value: { ordinal: index }, sourceIds: ['synthetic-scale-intent'], sourceHashes: [HASH], confidence: 1,
  }));
}

function crossEdges(count: number, nodeCount: number): AiDesignCrossDomainEdge[] {
  return Array.from({ length: count }, (_, index) => {
    const fromIndex = index % nodeCount;
    let toIndex = (index + 313) % nodeCount;
    if (toIndex === fromIndex) toIndex = (toIndex + 1) % nodeCount;
    return { id: `depends-${index}`, kind: 'depends_on', from: `constraint-${fromIndex}`, to: `constraint-${toIndex}` };
  });
}

/** Executes a synthetic, copyright-safe maximum-scale campaign without claiming CAD authority. */
export function runAiDesignComplexScaleCampaign(
  input: AiDesignComplexScaleCampaignConfigV1,
  dependencies: { nowMs?: () => number } = {},
): AiDesignComplexScaleCampaignV1 {
  const config = normalizedConfig(input);
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const startedAt = nowMs();
  const nodes = structureNodes(config.structureNodeCount);
  const productStructure = createProductStructureGraph({
    projectId: config.projectId, sessionId: config.sessionId, revision: 'synthetic-scale-v1', rootNodeId: 'root-assembly',
    nodes, edges: structureEdges(nodes, config.structureEdgeCount), interfaces: [],
  });
  const crossDomainGraph = createAiDesignCrossDomainConstraintGraph({
    projectId: config.projectId, sessionId: config.sessionId, graphRevision: 1, sourceContentHash: HASH,
    nodes: crossNodes(config.crossDomainNodeCount), edges: crossEdges(config.crossDomainEdgeCount, config.crossDomainNodeCount),
  });
  const definitions = Array.from({ length: config.partitionCount }, (_, index) => {
    const start = Math.floor(index * nodes.length / config.partitionCount);
    const end = Math.floor((index + 1) * nodes.length / config.partitionCount);
    return { partitionId: `partition-${index}`, artifactId: 'synthetic-scale-artifact', nodeIds: nodes.slice(start, end).map(node => node.nodeId) };
  });
  const partitionResult = createAiDesignGraphPartitions(productStructure, definitions);
  const issues = [
    ...validateProductStructureGraph(productStructure).map(issue => `structure:${issue}`),
    ...validateAiDesignCrossDomainConstraintGraph(crossDomainGraph).map(issue => `cross_domain:${issue}`),
    ...partitionResult.issues.map(issue => `partition:${issue}`),
    ...partitionResult.partitions.flatMap(partition => validateAiDesignGraphPartition(partition, productStructure).map(issue => `partition:${partition.partitionId}:${issue}`)),
  ];
  const digestMaterial = JSON.stringify({ config, product: productStructure.graphDigest, cross: crossDomainGraph.contentHash, partitions: partitionResult.partitions.map(item => item.partitionDigest), coverage: partitionResult.coverage, issues });
  const campaignDigest = sha256(digestMaterial);
  const campaign: AiDesignComplexScaleCampaignV1 = {
    schema: AI_DESIGN_COMPLEX_SCALE_CAMPAIGN_SCHEMA,
    campaignId: `scale:${campaignDigest.slice(0, 48)}`,
    campaignDigest,
    config,
    outcome: issues.length === 0 && partitionResult.coverage === 'complete' ? 'PASS' : 'FAIL',
    issues,
    measuredDurationMs: Math.max(0, nowMs() - startedAt),
    scale: {
      structureNodes: productStructure.nodes.length, structureEdges: productStructure.edges.length,
      crossDomainNodes: crossDomainGraph.nodes.length, crossDomainEdges: crossDomainGraph.edges.length,
      partitions: partitionResult.partitions.length, completePartitionCoverage: partitionResult.coverage === 'complete',
    },
    authority: { syntheticOnly: true, sourceContentIncluded: false, proprietaryGeometryIncluded: false, exactCadVerified: false, manufacturingReleaseReady: false },
    artifacts: { productStructure, crossDomainGraph, partitions: partitionResult.partitions },
  };
  return Object.freeze(campaign);
}
