import { createHash } from 'node:crypto';

/** Cross-domain intent relationships; this is a planning graph, never proof of verification. */
export const AI_DESIGN_CROSS_DOMAIN_GRAPH_SCHEMA = 'nexyfab.ai-design-cross-domain-constraint-graph.v1' as const;
export const AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES = 2_000;
export const AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES = 5_000;
export const AI_DESIGN_CROSS_DOMAINS = ['mechanical', 'electrical', 'fluid', 'control', 'thermal', 'software', 'safety'] as const;
export type AiDesignCrossDomain = (typeof AI_DESIGN_CROSS_DOMAINS)[number];
export type AiDesignCrossDomainNodeKind = 'intent' | 'parameter' | 'interface' | 'constraint' | 'conflict';
export type AiDesignCrossDomainEdgeKind = 'depends_on' | 'constrains' | 'interface_link' | 'conflicts_with' | 'invalidates';
export interface AiDesignCrossDomainNode {
  id: string; kind: AiDesignCrossDomainNodeKind; domain: AiDesignCrossDomain; key: string; value?: unknown;
  sourceIds: string[]; sourceHashes: string[]; confidence: number; status: 'active' | 'invalidated';
  alternatives?: Array<{ domain: AiDesignCrossDomain; value: unknown; sourceIds: string[]; sourceHashes: string[] }>;
}
export interface AiDesignCrossDomainEdge { id: string; kind: AiDesignCrossDomainEdgeKind; from: string; to: string; interfaceKey?: string; }
export interface AiDesignCrossDomainConstraintGraphV1 {
  schema: typeof AI_DESIGN_CROSS_DOMAIN_GRAPH_SCHEMA; projectId: string; sessionId: string; graphRevision: number;
  sourceContentHash: string; contentHash: string;
  nodes: AiDesignCrossDomainNode[]; edges: AiDesignCrossDomainEdge[];
}
export interface AiDesignCrossDomainGraphInput {
  projectId: string; sessionId: string; graphRevision: number; sourceContentHash: string;
  nodes: Array<Omit<AiDesignCrossDomainNode, 'status'> & { status?: 'active' | 'invalidated' }>;
  edges?: Array<Omit<AiDesignCrossDomainEdge, 'id'> & { id?: string }>;
}
const SHA256 = /^[a-f0-9]{64}$/; const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
function hash(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); }
function stable(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`; }
function boundedValue(value: unknown, depth = 0): boolean { if (depth > 8) return false; if (value === null || typeof value === 'boolean') return true; if (typeof value === 'number') return Number.isFinite(value); if (typeof value === 'string') return value.length <= 4_000; if (Array.isArray(value)) return value.length <= 100 && value.every(item => boundedValue(item, depth + 1)); if (value && typeof value === 'object') { const entries = Object.entries(value as Record<string, unknown>); return entries.length <= 100 && entries.every(([key, item]) => key.length <= 200 && boundedValue(item, depth + 1)); } return false; }
function edgeId(edge: Omit<AiDesignCrossDomainEdge, 'id'>): string { return `cross-edge:${edge.kind}:${edge.from}:${edge.to}:${hash(stable(edge))}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function material(value: Omit<AiDesignCrossDomainConstraintGraphV1, 'contentHash'> | AiDesignCrossDomainConstraintGraphV1): unknown { const { contentHash: _contentHash, ...rest } = value as AiDesignCrossDomainConstraintGraphV1; return rest; }
function seal(value: Omit<AiDesignCrossDomainConstraintGraphV1, 'contentHash'>): AiDesignCrossDomainConstraintGraphV1 { return { ...value, contentHash: hash(stable(value)) }; }

/** Creates a bounded graph and retains competing values as a conflict node. */
export function createAiDesignCrossDomainConstraintGraph(input: AiDesignCrossDomainGraphInput): AiDesignCrossDomainConstraintGraphV1 {
  if (input.nodes.length > AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES || (input.edges?.length ?? 0) > AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES) throw new Error('cross_domain_graph_bounds_exceeded');
  const nodes: AiDesignCrossDomainNode[] = input.nodes.map(node => ({ ...clone(node), status: node.status ?? 'active', sourceIds: [...new Set(node.sourceIds)].sort(), sourceHashes: [...new Set(node.sourceHashes)].sort() }));
  const byKey = new Map<string, AiDesignCrossDomainNode[]>(); for (const node of nodes) { const list = byKey.get(node.key) ?? []; list.push(node); byKey.set(node.key, list); }
  const conflicts: AiDesignCrossDomainNode[] = [];
  for (const [key, candidates] of byKey) { const values = [...new Set(candidates.map(item => stable(item.value)))]; const domains = new Set(candidates.map(item => item.domain)); if (values.length > 1 && domains.size > 1) conflicts.push({ id: `cross-conflict:${hash(`${key}:${values.sort().join('|')}`).slice(0, 48)}`, kind: 'conflict', domain: candidates[0]!.domain, key: candidates[0]!.key, sourceIds: [...new Set(candidates.flatMap(item => item.sourceIds))].sort(), sourceHashes: [...new Set(candidates.flatMap(item => item.sourceHashes))].sort(), confidence: 0, status: 'active', alternatives: candidates.map(item => ({ domain: item.domain, value: clone(item.value), sourceIds: [...item.sourceIds], sourceHashes: [...item.sourceHashes] })) }); }
  if (nodes.length + conflicts.length > AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES) throw new Error('cross_domain_graph_bounds_exceeded');
  const allNodes = [...nodes, ...conflicts]; const ids = new Set(allNodes.map(node => node.id)); const edges: AiDesignCrossDomainEdge[] = []; const seen = new Set<string>();
  const addEdge = (edge: Omit<AiDesignCrossDomainEdge, 'id'> & { id?: string }) => { if (edges.length >= AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES) throw new Error('cross_domain_graph_bounds_exceeded'); if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw new Error('cross_domain_edge_endpoint_invalid'); const id = edge.id ?? edgeId(edge); if (seen.has(id)) return; seen.add(id); edges.push({ ...edge, id }); };
  for (const conflict of conflicts) for (const candidate of byKey.get(conflict.key) ?? []) addEdge({ kind: 'conflicts_with', from: candidate.id, to: conflict.id });
  for (const edge of input.edges ?? []) addEdge(edge);
  const graph = seal({ schema: AI_DESIGN_CROSS_DOMAIN_GRAPH_SCHEMA, projectId: input.projectId, sessionId: input.sessionId, graphRevision: input.graphRevision, sourceContentHash: input.sourceContentHash, nodes: allNodes, edges });
  const issues = validateAiDesignCrossDomainConstraintGraph(graph); if (issues.length) throw new Error(`cross_domain_graph_invalid:${issues.join(',')}`);
  return freeze(graph);
}
export function invalidateAiDesignCrossDomainGraph(graph: AiDesignCrossDomainConstraintGraphV1, nodeIds: string[]): AiDesignCrossDomainConstraintGraphV1 {
  const invalid = new Set(nodeIds); let changed = true; while (changed) { changed = false; for (const edge of graph.edges) if (['depends_on', 'constrains', 'interface_link', 'invalidates'].includes(edge.kind) && invalid.has(edge.from) && !invalid.has(edge.to)) { invalid.add(edge.to); changed = true; } }
  return freeze(seal({ ...clone(graph), graphRevision: graph.graphRevision + 1, nodes: graph.nodes.map(node => invalid.has(node.id) ? { ...node, status: 'invalidated' } : node) }));
}
export function validateAiDesignCrossDomainConstraintGraph(value: unknown): string[] {
  const issues: string[] = []; if (!value || typeof value !== 'object' || (value as { schema?: unknown }).schema !== AI_DESIGN_CROSS_DOMAIN_GRAPH_SCHEMA) return ['cross_domain_graph_schema_invalid']; const graph = value as AiDesignCrossDomainConstraintGraphV1;
  if (!ID.test(graph.projectId ?? '') || !ID.test(graph.sessionId ?? '') || !Number.isSafeInteger(graph.graphRevision) || graph.graphRevision < 0 || !SHA256.test(graph.sourceContentHash ?? '') || !SHA256.test(graph.contentHash ?? '')) issues.push('cross_domain_graph_binding_invalid');
  if (!Array.isArray(graph.nodes) || graph.nodes.length > AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES) issues.push('cross_domain_node_bound_invalid'); if (!Array.isArray(graph.edges) || graph.edges.length > AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES) issues.push('cross_domain_edge_bound_invalid');
  const ids = new Set<string>(); for (const node of graph.nodes ?? []) { if (!ID.test(node?.id ?? '') || ids.has(node.id) || !AI_DESIGN_CROSS_DOMAINS.includes(node.domain) || !['intent', 'parameter', 'interface', 'constraint', 'conflict'].includes(node.kind) || typeof node.key !== 'string' || !node.key.trim() || node.key.length > 240 || (node.value !== undefined && !boundedValue(node.value)) || !Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1 || !['active', 'invalidated'].includes(node.status) || !Array.isArray(node.sourceIds) || node.sourceIds.length > 1_000 || node.sourceIds.some(item => !ID.test(item)) || !Array.isArray(node.sourceHashes) || node.sourceHashes.length > 1_000 || node.sourceHashes.some(item => !SHA256.test(item))) issues.push(`cross_domain_node_invalid:${String(node?.id ?? 'unknown')}`); if (node.kind === 'conflict' && (!Array.isArray(node.alternatives) || node.alternatives.length < 2 || node.alternatives.some(item => !AI_DESIGN_CROSS_DOMAINS.includes(item.domain) || !boundedValue(item.value) || item.sourceIds.some(id => !ID.test(id)) || item.sourceHashes.some(hash => !SHA256.test(hash))))) issues.push(`cross_domain_conflict_invalid:${String(node?.id ?? 'unknown')}`); ids.add(node?.id ?? ''); }
  const edgeIds = new Set<string>(); for (const edge of graph.edges ?? []) { if (!ID.test(edge?.id ?? '') || edgeIds.has(edge.id) || !['depends_on', 'constrains', 'interface_link', 'conflicts_with', 'invalidates'].includes(edge.kind) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || (edge.kind === 'interface_link' && (!edge.interfaceKey || edge.interfaceKey.length > 240))) issues.push(`cross_domain_edge_invalid:${String(edge?.id ?? 'unknown')}`); edgeIds.add(edge?.id ?? ''); }
  if (issues.length === 0 && graph.contentHash !== hash(stable(material(graph)))) issues.push('cross_domain_graph_content_hash_mismatch');
  return [...new Set(issues)];
}
