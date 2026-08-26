import { createHash } from 'node:crypto';

export const AI_DESIGN_PRODUCT_STRUCTURE_GRAPH_SCHEMA = 'nexyfab.ai-design-product-structure-graph.v1' as const;
export const AI_DESIGN_ASSEMBLY_INTERFACE_SCHEMA = 'nexyfab.ai-design-assembly-interface-contract.v1' as const;
export const PRODUCT_STRUCTURE_MAX_NODES = 5_000;
export const PRODUCT_STRUCTURE_MAX_EDGES = 10_000;
export type ProductStructureNodeKind = 'assembly' | 'subassembly' | 'component' | 'interface';
export type ProductStructureEdgeKind = 'contains' | 'connects' | 'references';
export type AssemblyInterfaceKind = 'mechanical' | 'electrical' | 'fluid' | 'spatial' | 'data';
export type AuthorityCheckStatus = 'verified' | 'failed' | 'unknown' | 'not_run';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;
const NODE_KINDS: readonly ProductStructureNodeKind[] = ['assembly', 'subassembly', 'component', 'interface'];
const EDGE_KINDS: readonly ProductStructureEdgeKind[] = ['contains', 'connects', 'references'];

export interface ProductStructureNodeV1 {
  nodeId: string;
  kind: ProductStructureNodeKind;
  label: string;
  parentId: string | null;
  sourceIntentNodeIds: readonly string[];
  sourceDigest?: string;
}
export interface ProductStructureEdgeV1 { edgeId: string; kind: ProductStructureEdgeKind; from: string; to: string; boundary?: boolean; }

export interface AssemblyInterfaceEndpointV1 { nodeId: string; portId: string; role: 'provider' | 'consumer'; }
export interface AssemblyInterfaceContractV1 {
  schema: typeof AI_DESIGN_ASSEMBLY_INTERFACE_SCHEMA;
  interfaceId: string;
  graphRevision: string;
  kind: AssemblyInterfaceKind;
  from: AssemblyInterfaceEndpointV1;
  to: AssemblyInterfaceEndpointV1;
  contractDigest: string;
  exactGeometryStatus: AuthorityCheckStatus;
  manufacturingStatus: AuthorityCheckStatus;
}
export interface ProductStructureGraphV1 {
  schema: typeof AI_DESIGN_PRODUCT_STRUCTURE_GRAPH_SCHEMA;
  projectId: string;
  sessionId: string;
  revision: string;
  rootNodeId: string;
  nodes: readonly ProductStructureNodeV1[];
  edges: readonly ProductStructureEdgeV1[];
  interfaces: readonly AssemblyInterfaceContractV1[];
  graphDigest: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('product_graph_non_finite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).filter(k => record[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`; }
  throw new Error('product_graph_non_canonical');
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function graphMaterial(graph: Omit<ProductStructureGraphV1, 'graphDigest'> | ProductStructureGraphV1): unknown { const { graphDigest: _digest, ...rest } = graph as ProductStructureGraphV1; return rest; }
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function uniq(values: readonly string[]): string[] { return [...new Set(values)].sort(); }

export function createAssemblyInterfaceContract(input: Omit<AssemblyInterfaceContractV1, 'schema' | 'contractDigest'>): AssemblyInterfaceContractV1 {
  if (input.from.nodeId === input.to.nodeId) throw new Error('interface_cross_part_endpoints_required');
  if (input.exactGeometryStatus !== 'not_run' || input.manufacturingStatus !== 'not_run') throw new Error('interface_precision_authority_forbidden');
  const contract = { schema: AI_DESIGN_ASSEMBLY_INTERFACE_SCHEMA, ...input, contractDigest: '' } as AssemblyInterfaceContractV1;
  contract.contractDigest = digest({ schema: contract.schema, ...Object.fromEntries(Object.entries(contract).filter(([key]) => key !== 'contractDigest')) });
  return freeze(structuredClone(contract));
}

export function createProductStructureGraph(input: Omit<ProductStructureGraphV1, 'schema' | 'graphDigest'>): ProductStructureGraphV1 {
  if (input.nodes.length > PRODUCT_STRUCTURE_MAX_NODES || input.edges.length > PRODUCT_STRUCTURE_MAX_EDGES || input.interfaces.length > PRODUCT_STRUCTURE_MAX_EDGES) throw new Error('product_graph_bounds_exceeded');
  const graph = { schema: AI_DESIGN_PRODUCT_STRUCTURE_GRAPH_SCHEMA, ...input, graphDigest: '' } as ProductStructureGraphV1;
  graph.graphDigest = digest(graphMaterial(graph));
  return freeze(structuredClone(graph));
}

function hasParentCycle(graph: ProductStructureGraphV1): boolean {
  const parents = new Map(graph.nodes.map(node => [node.nodeId, node.parentId]));
  for (const node of graph.nodes) { const seen = new Set<string>(); let cursor: string | null = node.nodeId; while (cursor) { if (seen.has(cursor)) return true; seen.add(cursor); cursor = parents.get(cursor) ?? null; } }
  return false;
}

export function validateAssemblyInterfaceContract(value: unknown, nodeIds?: ReadonlySet<string>): string[] {
  if (!value || typeof value !== 'object') return ['interface_not_object'];
  const contract = value as Partial<AssemblyInterfaceContractV1>; const issues: string[] = [];
  if (contract.schema !== AI_DESIGN_ASSEMBLY_INTERFACE_SCHEMA || !id(contract.interfaceId) || !id(contract.graphRevision) || !['mechanical', 'electrical', 'fluid', 'spatial', 'data'].includes(contract.kind ?? '')) issues.push('interface_identity_invalid');
  for (const endpoint of [contract.from, contract.to]) if (!endpoint || !id(endpoint.nodeId) || !id(endpoint.portId) || !['provider', 'consumer'].includes(endpoint.role ?? '') || (nodeIds && !nodeIds.has(endpoint.nodeId))) issues.push('interface_endpoint_invalid');
  if (!HASH.test(contract.contractDigest ?? '')) issues.push('interface_digest_invalid');
  if (contract.from?.nodeId === contract.to?.nodeId) issues.push('interface_cross_part_endpoints_required');
  if (contract.exactGeometryStatus !== 'not_run' || contract.manufacturingStatus !== 'not_run') issues.push('interface_precision_authority_forbidden');
  if (issues.length === 0) { const expected = digest({ schema: contract.schema, ...Object.fromEntries(Object.entries(contract).filter(([key]) => key !== 'contractDigest')) }); if (expected !== contract.contractDigest) issues.push('interface_digest_mismatch'); }
  return [...new Set(issues)];
}

export function validateProductStructureGraph(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['product_graph_not_object'];
  const graph = value as Partial<ProductStructureGraphV1>; const issues: string[] = [];
  if (graph.schema !== AI_DESIGN_PRODUCT_STRUCTURE_GRAPH_SCHEMA || !id(graph.projectId) || !id(graph.sessionId) || !id(graph.revision) || !id(graph.rootNodeId)) issues.push('product_graph_identity_invalid');
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > PRODUCT_STRUCTURE_MAX_NODES) issues.push('product_graph_node_bounds');
  if (!Array.isArray(graph.edges) || graph.edges.length > PRODUCT_STRUCTURE_MAX_EDGES) issues.push('product_graph_edge_bounds');
  const nodes = graph.nodes ?? []; const ids = new Set<string>();
  for (const node of nodes) { if (!node || !id(node.nodeId) || ids.has(node.nodeId) || !NODE_KINDS.includes(node.kind as ProductStructureNodeKind) || typeof node.label !== 'string' || !node.label.trim() || node.label.length > 512 || (node.parentId !== null && !id(node.parentId)) || !Array.isArray(node.sourceIntentNodeIds) || node.sourceIntentNodeIds.length > 1_000 || node.sourceIntentNodeIds.some(item => !id(item)) || (node.sourceDigest !== undefined && !HASH.test(node.sourceDigest))) issues.push(`node_invalid:${String(node?.nodeId ?? 'unknown')}`); ids.add(node?.nodeId ?? ''); }
  if (!ids.has(graph.rootNodeId ?? '') || nodes.find(node => node.nodeId === graph.rootNodeId)?.parentId !== null) issues.push('root_invalid');
  const rootCount = nodes.filter(node => node.parentId === null).length;
  if (rootCount !== 1) issues.push(`product_graph_root_count_invalid:${rootCount}`);
  const nodeById = new Map(nodes.map(node => [node.nodeId, node]));
  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) issues.push(`orphan_node:${node.nodeId}`);
    const parentKind = node.parentId ? nodeById.get(node.parentId)?.kind : null;
    if (parentKind && !['assembly', 'subassembly'].includes(parentKind)) issues.push(`parent_kind_invalid:${node.nodeId}`);
    if (node.nodeId === graph.rootNodeId && node.kind !== 'assembly') issues.push('root_kind_invalid');
  }
  const edges = graph.edges ?? []; const edgeIds = new Set<string>();
  for (const edge of edges) { if (!edge || !id(edge.edgeId) || edgeIds.has(edge.edgeId) || !EDGE_KINDS.includes(edge.kind as ProductStructureEdgeKind) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) issues.push(`edge_invalid:${String(edge?.edgeId ?? 'unknown')}`); edgeIds.add(edge?.edgeId ?? ''); }
  const contains = edges.filter(edge => edge.kind === 'contains');
  for (const node of nodes.filter(item => item.nodeId !== graph.rootNodeId)) {
    const parentEdges = contains.filter(edge => edge.to === node.nodeId);
    if (parentEdges.length !== 1 || parentEdges[0]?.from !== node.parentId) issues.push(`containment_parent_mismatch:${node.nodeId}`);
  }
  for (const edge of contains) if (nodeById.get(edge.to)?.parentId !== edge.from) issues.push(`containment_edge_mismatch:${edge.edgeId}`);
  if (hasParentCycle(graph as ProductStructureGraphV1)) issues.push('parent_cycle');
  const interfaces = graph.interfaces ?? []; if (!Array.isArray(interfaces) || interfaces.length > PRODUCT_STRUCTURE_MAX_EDGES) issues.push('interface_bounds'); else {
    const interfaceIds = new Set<string>();
    for (const item of interfaces) {
      issues.push(...validateAssemblyInterfaceContract(item, ids));
      if (interfaceIds.has(item.interfaceId)) issues.push(`interface_duplicate:${item.interfaceId}`);
      interfaceIds.add(item.interfaceId);
      if (item.graphRevision !== graph.revision) issues.push(`interface_revision_mismatch:${item.interfaceId}`);
      const fromKind = nodeById.get(item.from.nodeId)?.kind, toKind = nodeById.get(item.to.nodeId)?.kind;
      if (!fromKind || !toKind || fromKind === 'interface' || toKind === 'interface') issues.push(`interface_endpoint_kind_invalid:${item.interfaceId}`);
    }
  }
  if (issues.length === 0 && graph.graphDigest !== digest(graphMaterial(graph as ProductStructureGraphV1))) issues.push('product_graph_digest_mismatch');
  return [...new Set(issues)];
}

export function productStructureGraphDigest(graph: ProductStructureGraphV1): string { return graph.graphDigest; }
