import { createHash } from 'node:crypto';
import type { ComplexSystemGraphV2 } from './complexSystemGraph';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const artifact = new TextEncoder().encode('reviewed complex-system source evidence');
const artifactHash = createHash('sha256').update(artifact).digest('hex');
const sourceArtifactNames = ['system-source.json'];
const node = (id: string, kind: ComplexSystemGraphV2['nodes'][number]['kind']): ComplexSystemGraphV2['nodes'][number] => ({ id, kind, name: id, status: 'confirmed', sourceArtifactNames, attributes: {} });
const edge = (id: string, kind: ComplexSystemGraphV2['edges'][number]['kind'], from: string, to: string): ComplexSystemGraphV2['edges'][number] => ({ id, kind, from, to, status: 'confirmed', sourceArtifactNames });

export function buildComplexSystemGraphFixture() {
  const nodes: ComplexSystemGraphV2['nodes'] = [node('product', 'product'), node('req', 'requirement'), node('function', 'function'), node('assembly', 'subassembly'), node('part-made', 'part'), node('part-buy', 'part'), node('supplier', 'supplier'), node('process', 'manufacturing_process'), node('datum', 'inspection_datum'), node('acceptance', 'acceptance'), node('hazard', 'hazard'), node('risk-reduction', 'risk_reduction'), node('safety-function', 'safety_function'), node('tool-access', 'tool_access'), node('service-envelope', 'service_envelope'), node('maintenance', 'maintenance_item'), node('consumable', 'consumable')];
  const edges: ComplexSystemGraphV2['edges'] = [
    edge('contains-assembly', 'contains', 'product', 'assembly'), edge('contains-made', 'contains', 'assembly', 'part-made'), edge('contains-buy', 'contains', 'assembly', 'part-buy'),
    edge('allocate', 'allocated_to', 'req', 'function'), edge('realize', 'realized_by', 'function', 'assembly'), edge('joint', 'fastener', 'part-made', 'part-buy'), edge('load', 'load_flow', 'part-buy', 'part-made'),
    edge('make', 'manufactured_by', 'part-made', 'process'), edge('buy', 'supplied_by', 'part-buy', 'supplier'), edge('inspect-made', 'inspected_at', 'part-made', 'datum'), edge('inspect-buy', 'inspected_at', 'part-buy', 'datum'), edge('accept-made', 'accepted_by', 'part-made', 'acceptance'), edge('accept-buy', 'accepted_by', 'part-buy', 'acceptance'),
    edge('mitigate', 'mitigated_by', 'hazard', 'risk-reduction'), edge('implement', 'implemented_by', 'risk-reduction', 'safety-function'), edge('tool', 'requires_tool_access', 'part-made', 'tool-access'), edge('service', 'has_service_envelope', 'assembly', 'service-envelope'), edge('maintain', 'maintained_by', 'assembly', 'maintenance'), edge('consume', 'consumes', 'maintenance', 'consumable'),
  ];
  const graph: ComplexSystemGraphV2 = {
    schema: 'nexyfab.complex-system-graph.v2', systemId: 'gearbox-pilot-01', revision: 1, family: 'gearbox', units: 'mm-kg-s',
    artifacts: [{ name: 'system-source.json', sha256: artifactHash, authority: 'reviewer-approved', mediaType: 'application/json' }], nodes, edges,
    evidence: [{ id: 'system-review', kind: 'expert_review', subjectNodeIds: nodes.map(item => item.id), supportingEdgeIds: edges.map(item => item.id), evidenceArtifactNames: sourceArtifactNames, status: 'passed' }],
  };
  return { graph, graphBytes: encode(graph), artifacts: new Map([['system-source.json', artifact]]) };
}
