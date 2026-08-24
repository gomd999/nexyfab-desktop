import type {
  DesignIntentAuthority,
  DesignIntentCheckpointV1,
  DesignIntentFieldCategory,
} from './designIntentCheckpoint';

// Graph data is deliberately a derived, revision-bound view. It never grants
// authority to an extracted value or silently resolves a conflict.
export const AI_DESIGN_INTENT_GRAPH_SCHEMA = 'nexyfab.ai-design-intent-graph.v1' as const;
export const AI_DESIGN_GRAPH_MAX_NODES = 500;
export const AI_DESIGN_GRAPH_MAX_EDGES = 1_000;

export type AiDesignIntentNodeKind = 'fact' | 'assumption' | 'conflict' | 'missing';
export type AiDesignIntentEdgeKind = 'dependency' | 'constraint' | 'conflict' | 'derives';
export type AiDesignIntentNodeStatus = 'active' | 'invalidated';

export interface AiDesignIntentProvenance {
  sourceIds: string[];
  sourceHashes: string[];
  authority: DesignIntentAuthority;
}

export interface AiDesignIntentNode {
  id: string;
  kind: AiDesignIntentNodeKind;
  key: string;
  value?: unknown;
  category: DesignIntentFieldCategory;
  confidence: number;
  impact: number;
  status: AiDesignIntentNodeStatus;
  provenance: AiDesignIntentProvenance;
  /** A conflict node retains every candidate and is never selected by the graph. */
  alternatives?: Array<{ value: unknown; authority: DesignIntentAuthority; sourceIds: string[]; sourceHashes: string[] }>;
}

export interface AiDesignIntentEdge {
  id: string;
  kind: AiDesignIntentEdgeKind;
  from: string;
  to: string;
  label?: string;
}

export interface AiDesignIntentGraphV1 {
  schema: typeof AI_DESIGN_INTENT_GRAPH_SCHEMA;
  projectId: string;
  revision: number;
  projectContentHash: string;
  checkpointId: string;
  nodes: AiDesignIntentNode[];
  edges: AiDesignIntentEdge[];
}

export interface CreateAiDesignIntentGraphOptions {
  /** Optional explicit relationships from a domain parser; IDs must exist. */
  edges?: Array<{ kind: AiDesignIntentEdgeKind; from: string; to: string; label?: string }>;
  /** Keys with greater downstream consequence are surfaced earlier by questions. */
  highImpactKeys?: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const KINDS: AiDesignIntentNodeKind[] = ['fact', 'assumption', 'conflict', 'missing'];
const EDGE_KINDS: AiDesignIntentEdgeKind[] = ['dependency', 'constraint', 'conflict', 'derives'];
function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function nodeId(kind: string, key: string, suffix = ''): string { return `intent:${kind}:${key}:${stableHash(`${kind}:${key}:${suffix}`)}`; }
function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function impactFor(key: string, highImpact: Set<string>): number { return highImpact.has(key) ? 1 : /material|overall|dimension|tolerance|load|safety|manufactur/i.test(key) ? 0.8 : 0.5; }
function authorityConfidence(authority: DesignIntentAuthority): number { return authority === 'user_confirmed' ? 1 : authority === 'imported_authority' ? 0.8 : 0.35; }

/** Build a bounded graph from the already validated checkpoint contract. */
export function createAiDesignIntentGraph(checkpoint: DesignIntentCheckpointV1, options: CreateAiDesignIntentGraphOptions = {}): AiDesignIntentGraphV1 {
  const highImpact = new Set(options.highImpactKeys ?? []);
  const nodes: AiDesignIntentNode[] = [];
  const byKey = new Map<string, AiDesignIntentNode[]>();
  const add = (node: AiDesignIntentNode) => { if (nodes.length >= AI_DESIGN_GRAPH_MAX_NODES) return; nodes.push(node); const list = byKey.get(node.key) ?? []; list.push(node); byKey.set(node.key, list); };
  const facts = [...checkpoint.userConfirmedFacts, ...checkpoint.importedAuthority, ...checkpoint.aiAssumptions];
  for (const fact of facts) {
    const kind: AiDesignIntentNodeKind = fact.authority === 'ai_assumption' ? 'assumption' : 'fact';
    add({ id: nodeId(kind, fact.key, JSON.stringify(fact.value)), kind, key: fact.key, value: fact.value, category: fact.category, confidence: authorityConfidence(fact.authority), impact: impactFor(fact.key, highImpact), status: 'active', provenance: { sourceIds: unique(fact.sourceIds), sourceHashes: unique(fact.sourceHashes), authority: fact.authority } });
  }
  for (const conflict of checkpoint.conflicts) {
    const conflictNode: AiDesignIntentNode = { id: nodeId('conflict', conflict.key), kind: 'conflict', key: conflict.key, category: conflict.category, confidence: 0, impact: impactFor(conflict.key, highImpact), status: 'active', provenance: { sourceIds: unique(conflict.values.flatMap(value => value.sourceIds)), sourceHashes: unique(conflict.values.flatMap(value => value.sourceHashes)), authority: 'ai_assumption' }, alternatives: conflict.values.map(value => ({ ...value, sourceIds: unique(value.sourceIds), sourceHashes: unique(value.sourceHashes) })) };
    add(conflictNode);
  }
  for (const missing of checkpoint.missingFields) add({ id: nodeId('missing', missing.key), kind: 'missing', key: missing.key, category: missing.category, confidence: 0, impact: impactFor(missing.key, highImpact), status: 'active', provenance: { sourceIds: [], sourceHashes: [], authority: 'ai_assumption' } });
  const edges: AiDesignIntentEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (kind: AiDesignIntentEdgeKind, from: string, to: string, label?: string) => { if (edges.length >= AI_DESIGN_GRAPH_MAX_EDGES || from === to || !nodes.some(node => node.id === from) || !nodes.some(node => node.id === to)) return; const id = `${kind}:${from}:${to}`; if (edgeKeys.has(id)) return; edgeKeys.add(id); edges.push({ id, kind, from, to, ...(label ? { label } : {}) }); };
  for (const conflict of checkpoint.conflicts) {
    const conflictNode = byKey.get(conflict.key)?.find(node => node.kind === 'conflict');
    if (!conflictNode) continue;
    for (const candidate of byKey.get(conflict.key) ?? []) if (candidate.kind === 'fact' || candidate.kind === 'assumption') addEdge('conflict', candidate.id, conflictNode.id, 'candidate');
  }
  for (const edge of options.edges ?? []) addEdge(edge.kind, edge.from, edge.to, edge.label);
  return { schema: AI_DESIGN_INTENT_GRAPH_SCHEMA, projectId: checkpoint.projectId, revision: checkpoint.revision, projectContentHash: checkpoint.projectContentHash, checkpointId: checkpoint.checkpointId, nodes, edges };
}

/** Deterministically invalidate a node and all downstream dependent/derived nodes. */
export function invalidateAiDesignIntentGraph(graph: AiDesignIntentGraphV1, nodeIds: string[]): AiDesignIntentGraphV1 {
  const invalid = new Set(nodeIds); const changed = new Set(nodeIds); let progress = true;
  while (progress) { progress = false; for (const edge of graph.edges) if ((edge.kind === 'dependency' || edge.kind === 'constraint' || edge.kind === 'derives') && invalid.has(edge.from) && !invalid.has(edge.to)) { invalid.add(edge.to); changed.add(edge.to); progress = true; } }
  if (!changed.size) return structuredClone(graph);
  return { ...graph, nodes: graph.nodes.map(node => invalid.has(node.id) ? { ...node, status: 'invalidated' } : { ...node }), edges: graph.edges.map(edge => ({ ...edge })) };
}

export function validateAiDesignIntentGraph(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object' || (value as { schema?: unknown }).schema !== AI_DESIGN_INTENT_GRAPH_SCHEMA) return ['invalid_intent_graph_schema'];
  const graph = value as AiDesignIntentGraphV1;
  if (!SAFE_ID.test(graph.projectId ?? '') || !Number.isSafeInteger(graph.revision) || graph.revision < 0 || !SHA256.test(graph.projectContentHash ?? '') || !SAFE_ID.test(graph.checkpointId ?? '')) issues.push('project_binding_invalid');
  if (!Array.isArray(graph.nodes) || graph.nodes.length > AI_DESIGN_GRAPH_MAX_NODES) issues.push('node_count_out_of_bounds');
  if (!Array.isArray(graph.edges) || graph.edges.length > AI_DESIGN_GRAPH_MAX_EDGES) issues.push('edge_count_out_of_bounds');
  const ids = new Set<string>(); for (const node of graph.nodes ?? []) { if (!node || !SAFE_ID.test(node.id) || ids.has(node.id) || !KINDS.includes(node.kind) || typeof node.key !== 'string' || !Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1 || !Number.isFinite(node.impact) || node.impact < 0 || node.impact > 1 || !['active', 'invalidated'].includes(node.status) || !node.provenance || !Array.isArray(node.provenance.sourceIds) || !Array.isArray(node.provenance.sourceHashes)) issues.push(`node_invalid:${String(node?.id ?? 'unknown')}`); ids.add(node?.id ?? ''); }
  const edgeIds = new Set<string>(); for (const edge of graph.edges ?? []) { if (!edge || !SAFE_ID.test(edge.id) || edgeIds.has(edge.id) || !EDGE_KINDS.includes(edge.kind) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) issues.push(`edge_invalid:${String(edge?.id ?? 'unknown')}`); edgeIds.add(edge?.id ?? ''); }
  return [...new Set(issues)];
}
