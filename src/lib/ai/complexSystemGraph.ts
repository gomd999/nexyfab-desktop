import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const safeName = z.string().min(1).max(240).refine(value => !/[\\/]/.test(value) && value !== '.' && value !== '..', 'unsafe artifact name');
const nodeKind = z.enum(['product', 'requirement', 'function', 'subassembly', 'part', 'interface', 'actuator', 'sensor', 'controller', 'hazard', 'risk_reduction', 'safety_function', 'manufacturing_process', 'supplier', 'inspection_datum', 'acceptance', 'tool_access', 'service_envelope', 'maintenance_item', 'consumable']);
const edgeKind = z.enum(['contains', 'allocated_to', 'realized_by', 'fastener', 'weld', 'seal', 'bearing', 'gear_mesh', 'shaft_coupling', 'electrical_connection', 'signal_flow', 'power_flow', 'fluid_flow', 'load_flow', 'motion_flow', 'mitigated_by', 'implemented_by', 'manufactured_by', 'supplied_by', 'inspected_at', 'accepted_by', 'assembled_before', 'requires_tool_access', 'has_service_envelope', 'maintained_by', 'consumes']);
const artifactSchema = z.object({ name: safeName, sha256: sha, authority: z.enum(['customer', 'manufacturer', 'standard', 'nexyfab-calculation', 'nexyfab-measurement', 'reviewer-approved']), mediaType: z.string().min(1).max(160) }).strict();
const sourceBound = { sourceArtifactNames: z.array(safeName).min(1) };
const graphSchema = z.object({
  schema: z.literal('nexyfab.complex-system-graph.v2'),
  systemId: z.string().min(1).max(160),
  revision: z.number().int().min(1),
  family: z.enum(['generic', 'robot', 'gearbox', 'machine_skid', 'welded_enclosure', 'pressure_vessel', 'turbomachinery']),
  units: z.enum(['mm-kg-s', 'm-kg-s']),
  artifacts: z.array(artifactSchema).min(1),
  nodes: z.array(z.object({ id: z.string().min(1).max(160), kind: nodeKind, name: z.string().min(1).max(240), status: z.enum(['confirmed', 'unresolved', 'conflict']), ...sourceBound, attributes: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).default({}) }).strict()).min(1),
  edges: z.array(z.object({ id: z.string().min(1).max(160), kind: edgeKind, from: z.string().min(1), to: z.string().min(1), status: z.enum(['confirmed', 'unresolved', 'conflict']), ...sourceBound }).strict()).min(1),
  evidence: z.array(z.object({ id: z.string().min(1).max(160), kind: z.enum(['calculation', 'simulation', 'inspection', 'physical_test', 'expert_review']), subjectNodeIds: z.array(z.string().min(1)).min(1), supportingEdgeIds: z.array(z.string().min(1)), evidenceArtifactNames: z.array(safeName).min(1), status: z.enum(['passed', 'failed', 'not_run']) }).strict()).min(1),
}).strict();

export type ComplexSystemGraphV2 = z.infer<typeof graphSchema>;
export type ComplexSystemGraphReport = {
  schema: 'nexyfab.complex-system-graph-report.v2';
  status: 'passed' | 'failed' | 'not_run';
  graphReady: boolean;
  systemId: string | null;
  revision: number | null;
  family: ComplexSystemGraphV2['family'] | null;
  graphFileSha256: string;
  graphHash: string | null;
  counts: { artifacts: number; nodes: number; edges: number; evidence: number; confirmedNodes: number; confirmedEdges: number; passedEvidence: number };
  coverage: { artifactByteCoverage: number; nodeSourceCoverage: number; edgeSourceCoverage: number; evidenceSubjectCoverage: number };
  errors: string[];
  unresolved: string[];
  blockers: string[];
  familyContractRequired: true;
  physicalValidationRequired: true;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function verifyComplexSystemGraphBytes(graphBytes: Uint8Array, uploadedArtifacts: ReadonlyMap<string, Uint8Array>): ComplexSystemGraphReport {
  const errors: string[] = [], unresolved: string[] = [];
  let raw: unknown = null;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(graphBytes)); }
  catch { errors.push('graph must be valid UTF-8 JSON'); }
  const parsed = graphSchema.safeParse(raw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `graph.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!parsed.success) return failedReport(graphBytes, errors);
  const graph = parsed.data, artifactByName = new Map<string, typeof graph.artifacts[number]>(), nodeById = new Map<string, typeof graph.nodes[number]>(), edgeById = new Map<string, typeof graph.edges[number]>();
  for (const artifact of graph.artifacts) { if (artifactByName.has(artifact.name)) errors.push(`artifact_duplicate:${artifact.name}`); artifactByName.set(artifact.name, artifact); }
  for (const [name, bytes] of uploadedArtifacts) { const declared = artifactByName.get(name); if (!declared) errors.push(`artifact_undeclared:${name}`); else if (digest(bytes) !== declared.sha256) errors.push(`artifact_hash_mismatch:${name}`); }
  for (const artifact of graph.artifacts) if (!uploadedArtifacts.has(artifact.name)) errors.push(`artifact_missing:${artifact.name}`);
  for (const node of graph.nodes) { if (nodeById.has(node.id)) errors.push(`node_duplicate:${node.id}`); nodeById.set(node.id, node); checkSources(`node:${node.id}`, node.sourceArtifactNames, artifactByName, errors); if (node.status !== 'confirmed') unresolved.push(`node_${node.status}:${node.id}`); }
  for (const edge of graph.edges) { if (edgeById.has(edge.id)) errors.push(`edge_duplicate:${edge.id}`); edgeById.set(edge.id, edge); checkSources(`edge:${edge.id}`, edge.sourceArtifactNames, artifactByName, errors); if (!nodeById.has(edge.from) || !nodeById.has(edge.to) || edge.from === edge.to) errors.push(`edge_endpoint_invalid:${edge.id}`); if (edge.status !== 'confirmed') unresolved.push(`edge_${edge.status}:${edge.id}`); }
  const roots = graph.nodes.filter(node => node.kind === 'product');
  if (roots.length !== 1) errors.push(`product_root_count_invalid:${roots.length}`);
  const root = roots[0];
  if (root) validateContainment(root.id, graph.nodes, graph.edges, nodeById, errors);
  for (const edge of graph.edges) validateEdgeKinds(edge, nodeById, errors);
  validateRequiredRelations(graph, errors);
  const evidencedSubjects = new Set<string>();
  for (const item of graph.evidence) {
    checkSources(`evidence:${item.id}`, item.evidenceArtifactNames, artifactByName, errors);
    for (const id of item.subjectNodeIds) { evidencedSubjects.add(id); if (!nodeById.has(id)) errors.push(`evidence_node_missing:${item.id}:${id}`); }
    for (const id of item.supportingEdgeIds) { evidencedSubjects.add(id); if (!edgeById.has(id)) errors.push(`evidence_edge_missing:${item.id}:${id}`); }
    if (item.status === 'failed') errors.push(`evidence_failed:${item.id}`);
    if (item.status === 'not_run') unresolved.push(`evidence_not_run:${item.id}`);
  }
  const referencedArtifacts = new Set([...graph.nodes.flatMap(node => node.sourceArtifactNames), ...graph.edges.flatMap(edge => edge.sourceArtifactNames), ...graph.evidence.flatMap(item => item.evidenceArtifactNames)]);
  for (const artifact of graph.artifacts) if (!referencedArtifacts.has(artifact.name)) errors.push(`artifact_unreferenced:${artifact.name}`);
  const technicalSubjects = [...graph.nodes.map(node => node.id), ...graph.edges.map(edge => edge.id)];
  for (const id of technicalSubjects) if (!evidencedSubjects.has(id)) unresolved.push(`evidence_subject_uncovered:${id}`);
  const uniqueErrors = [...new Set(errors)], uniqueUnresolved = [...new Set(unresolved)];
  const status = uniqueErrors.length ? 'failed' : uniqueUnresolved.length ? 'not_run' : 'passed';
  const reportCore = { systemId: graph.systemId, revision: graph.revision, family: graph.family, graphFileSha256: digest(graphBytes), counts: { artifacts: graph.artifacts.length, nodes: graph.nodes.length, edges: graph.edges.length, evidence: graph.evidence.length, confirmedNodes: graph.nodes.filter(node => node.status === 'confirmed').length, confirmedEdges: graph.edges.filter(edge => edge.status === 'confirmed').length, passedEvidence: graph.evidence.filter(item => item.status === 'passed').length }, coverage: { artifactByteCoverage: ratio(graph.artifacts.filter(item => uploadedArtifacts.has(item.name) && digest(uploadedArtifacts.get(item.name)!) === item.sha256).length, graph.artifacts.length), nodeSourceCoverage: ratio(graph.nodes.filter(node => node.sourceArtifactNames.every(name => artifactByName.has(name))).length, graph.nodes.length), edgeSourceCoverage: ratio(graph.edges.filter(edge => edge.sourceArtifactNames.every(name => artifactByName.has(name))).length, graph.edges.length), evidenceSubjectCoverage: ratio(technicalSubjects.filter(id => evidencedSubjects.has(id)).length, technicalSubjects.length) } };
  const graphHash = digest(new TextEncoder().encode(canonical({ systemId: graph.systemId, revision: graph.revision, family: graph.family, units: graph.units, artifacts: graph.artifacts, nodes: graph.nodes, edges: graph.edges, evidence: graph.evidence })));
  return { schema: 'nexyfab.complex-system-graph-report.v2', status, graphReady: status === 'passed', ...reportCore, graphHash, errors: uniqueErrors, unresolved: uniqueUnresolved, blockers: status === 'passed' ? ['product_family_contract_required', 'physical_validation_required', 'final_expert_review_required'] : ['complex_system_graph_incomplete', 'product_family_contract_required', 'physical_validation_required', 'final_expert_review_required'], familyContractRequired: true, physicalValidationRequired: true, releaseReady: false, sideEffects: noSideEffects() };
}

function validateContainment(rootId: string, nodes: ComplexSystemGraphV2['nodes'], edges: ComplexSystemGraphV2['edges'], nodeById: Map<string, ComplexSystemGraphV2['nodes'][number]>, errors: string[]) {
  const contains = edges.filter(edge => edge.kind === 'contains'), incoming = new Map<string, number>(), children = new Map<string, string[]>();
  for (const edge of contains) { incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1); const list = children.get(edge.from) ?? []; list.push(edge.to); children.set(edge.from, list); }
  for (const node of nodes.filter(item => ['subassembly', 'part', 'interface', 'actuator', 'sensor', 'controller'].includes(item.kind))) if (incoming.get(node.id) !== 1) errors.push(`containment_parent_count_invalid:${node.id}:${incoming.get(node.id) ?? 0}`);
  const visiting = new Set<string>(), visited = new Set<string>();
  const walk = (id: string) => { if (visiting.has(id)) { errors.push(`containment_cycle:${id}`); return; } if (visited.has(id)) return; visiting.add(id); for (const child of children.get(id) ?? []) walk(child); visiting.delete(id); visited.add(id); };
  walk(rootId);
  for (const node of nodes.filter(item => ['subassembly', 'part', 'interface', 'actuator', 'sensor', 'controller'].includes(item.kind))) if (!visited.has(node.id)) errors.push(`containment_unreachable:${node.id}`);
  for (const edge of contains) { const from = nodeById.get(edge.from)?.kind, to = nodeById.get(edge.to)?.kind; if (!['product', 'subassembly'].includes(from ?? '') || !['subassembly', 'part', 'interface', 'actuator', 'sensor', 'controller'].includes(to ?? '')) errors.push(`containment_kind_invalid:${edge.id}`); }
}

function validateEdgeKinds(edge: ComplexSystemGraphV2['edges'][number], nodes: Map<string, ComplexSystemGraphV2['nodes'][number]>, errors: string[]) {
  const from = nodes.get(edge.from)?.kind, to = nodes.get(edge.to)?.kind;
  const technical = ['subassembly', 'part', 'interface', 'actuator', 'sensor', 'controller'];
  const valid = edge.kind === 'contains'
    || (edge.kind === 'allocated_to' && from === 'requirement' && ['function', 'safety_function'].includes(to ?? ''))
    || (edge.kind === 'realized_by' && from === 'function' && technical.includes(to ?? ''))
    || (['fastener', 'weld', 'seal', 'bearing', 'gear_mesh', 'shaft_coupling', 'electrical_connection', 'signal_flow', 'power_flow', 'fluid_flow', 'load_flow', 'motion_flow'].includes(edge.kind) && technical.includes(from ?? '') && technical.includes(to ?? ''))
    || (edge.kind === 'mitigated_by' && from === 'hazard' && to === 'risk_reduction')
    || (edge.kind === 'implemented_by' && from === 'risk_reduction' && to === 'safety_function')
    || (edge.kind === 'manufactured_by' && from === 'part' && to === 'manufacturing_process')
    || (edge.kind === 'supplied_by' && from === 'part' && to === 'supplier')
    || (edge.kind === 'inspected_at' && from === 'part' && to === 'inspection_datum')
    || (edge.kind === 'accepted_by' && ['part', 'inspection_datum'].includes(from ?? '') && to === 'acceptance')
    || (edge.kind === 'assembled_before' && technical.includes(from ?? '') && technical.includes(to ?? ''))
    || (edge.kind === 'requires_tool_access' && technical.includes(from ?? '') && to === 'tool_access')
    || (edge.kind === 'has_service_envelope' && technical.includes(from ?? '') && to === 'service_envelope')
    || (edge.kind === 'maintained_by' && technical.includes(from ?? '') && to === 'maintenance_item')
    || (edge.kind === 'consumes' && from === 'maintenance_item' && to === 'consumable');
  if (!valid) errors.push(`edge_kind_invalid:${edge.id}:${from ?? 'missing'}:${edge.kind}:${to ?? 'missing'}`);
}

function validateRequiredRelations(graph: ComplexSystemGraphV2, errors: string[]) {
  const outgoing = (id: string, kinds: string[]) => graph.edges.filter(edge => edge.from === id && kinds.includes(edge.kind));
  for (const node of graph.nodes) {
    if (node.kind === 'requirement' && outgoing(node.id, ['allocated_to']).length < 1) errors.push(`requirement_unallocated:${node.id}`);
    if (node.kind === 'function' && outgoing(node.id, ['realized_by']).length < 1) errors.push(`function_unrealized:${node.id}`);
    if (node.kind === 'hazard' && outgoing(node.id, ['mitigated_by']).length < 1) errors.push(`hazard_unmitigated:${node.id}`);
    if (node.kind === 'risk_reduction' && outgoing(node.id, ['implemented_by']).length < 1) errors.push(`risk_reduction_unimplemented:${node.id}`);
    if (node.kind === 'part') {
      const sourceCount = outgoing(node.id, ['manufactured_by', 'supplied_by']).length;
      if (sourceCount !== 1) errors.push(`part_source_count_invalid:${node.id}:${sourceCount}`);
      if (outgoing(node.id, ['inspected_at']).length < 1 || outgoing(node.id, ['accepted_by']).length < 1) errors.push(`part_inspection_acceptance_missing:${node.id}`);
    }
    if (node.kind === 'maintenance_item' && outgoing(node.id, ['consumes']).length < 1) errors.push(`maintenance_consumable_missing:${node.id}`);
  }
}

function checkSources(owner: string, names: readonly string[], artifacts: ReadonlyMap<string, unknown>, errors: string[]) { for (const name of names) if (!artifacts.has(name)) errors.push(`source_artifact_missing:${owner}:${name}`); }
function failedReport(bytes: Uint8Array, errors: string[]): ComplexSystemGraphReport { return { schema: 'nexyfab.complex-system-graph-report.v2', status: 'failed', graphReady: false, systemId: null, revision: null, family: null, graphFileSha256: digest(bytes), graphHash: null, counts: { artifacts: 0, nodes: 0, edges: 0, evidence: 0, confirmedNodes: 0, confirmedEdges: 0, passedEvidence: 0 }, coverage: { artifactByteCoverage: 0, nodeSourceCoverage: 0, edgeSourceCoverage: 0, evidenceSubjectCoverage: 0 }, errors: [...new Set(errors)], unresolved: [], blockers: ['complex_system_graph_incomplete', 'product_family_contract_required', 'physical_validation_required', 'final_expert_review_required'], familyContractRequired: true, physicalValidationRequired: true, releaseReady: false, sideEffects: noSideEffects() }; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function ratio(a: number, b: number) { return b ? a / b : 0; }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
