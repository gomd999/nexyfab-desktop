import 'server-only';

import { createAiDesignCandidateArtifact, type AiDesignCandidateArtifactV1 } from './aiDesignCandidateArtifact';
import { evaluateAiDesignComplexCandidateSet } from './aiDesignComplexEvaluationService';
import { createAiDesignComplexWorkspaceViewModel } from './aiDesignComplexWorkspaceViewModel';
import {
  createAiDesignCrossDomainConstraintGraph,
  validateAiDesignCrossDomainConstraintGraph,
  type AiDesignCrossDomain,
} from './aiDesignCrossDomainConstraintGraph';
import {
  createAiDesignGraphPartitions,
  createAiDesignHierarchicalCandidateArtifact,
  validateAiDesignHierarchicalCandidateSet,
} from './aiDesignHierarchicalCandidatePartition';
import { createAssemblyInterfaceContract, createProductStructureGraph, validateProductStructureGraph, type AssemblyInterfaceKind } from './aiDesignProductStructureGraph';
import { InMemoryAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';
import { createAiDesignWorkspaceRuntime } from './aiDesignWorkspaceRuntime';
import { createDesignCandidateComparison } from './designCandidateComparison';
import { serverEvidenceSha256 } from './serverEvidence';
import { createGaugeUxViewModel } from './aiDesignComparisonGaugeUx';
import { InMemoryAiDesignComplexWorkspaceStore } from './aiDesignComplexWorkspaceStore';
import { executeAiDesignComplexWorkspaceCommand, loadAiDesignComplexWorkspaceReadModel } from './aiDesignComplexWorkspaceService';

export const AI_DESIGN_COMPLEX_SCENARIO_REPORT_SCHEMA = 'nexyfab.ai-design-complex-scenario-report.v1' as const;

export type AiDesignComplexScenarioId = 'machine-assembly' | 'mold-tooling' | 'electromechanical-enclosure';

interface ScenarioDefinition {
  scenarioId: AiDesignComplexScenarioId;
  title: string;
  nodes: readonly { id: string; kind: 'subassembly' | 'component'; label: string; parentId?: string }[];
  interfaces: readonly { id: string; kind: AssemblyInterfaceKind; from: string; to: string }[];
  constraints: readonly { id: string; domain: AiDesignCrossDomain; key: string; value: string | number }[];
  candidates: readonly { id: string; title: string; summary: string; parameterKeys: string[]; featureKeys: string[] }[];
  gaugeNodeId: string;
}

export interface AiDesignComplexScenarioReportV1 {
  schema: typeof AI_DESIGN_COMPLEX_SCENARIO_REPORT_SCHEMA;
  scenarioId: AiDesignComplexScenarioId;
  title: string;
  status: 'PASS' | 'FAIL';
  structure: { nodes: number; edges: number; interfaces: number; issues: readonly string[] };
  constraints: { domains: number; constraints: number; issues: readonly string[] };
  partitions: { count: number; coverage: 'complete' | 'partial'; issues: readonly string[] };
  critics: { bundles: number; conceptReviewReady: number; failed: number };
  ux: { desktopTreeRows: number; mobileSheets: number; assemblyGauges: number; minimumTouchTargetPx: 44 };
  commandPath: { status: 'PASS' | 'FAIL'; complexRevision: number; precisionRequestCreated: boolean };
  precisionCadRequired: true;
  exactCadVerificationStatus: 'NOT_RUN';
  manufacturingReleaseReady: false;
  issues: readonly string[];
}

const DEFINITIONS: readonly ScenarioDefinition[] = [
  {
    scenarioId: 'machine-assembly', title: 'Servo machining cell', gaugeNodeId: 'guard',
    nodes: [
      { id: 'frame', kind: 'subassembly', label: 'Machine frame' },
      { id: 'motion', kind: 'subassembly', label: 'Motion system' },
      { id: 'spindle', kind: 'component', label: 'Spindle', parentId: 'motion' },
      { id: 'coolant', kind: 'subassembly', label: 'Coolant skid' },
      { id: 'controller', kind: 'component', label: 'Motion controller' },
      { id: 'guard', kind: 'component', label: 'Safety guard' },
    ],
    interfaces: [
      { id: 'motion-frame', kind: 'mechanical', from: 'motion', to: 'frame' },
      { id: 'spindle-controller', kind: 'data', from: 'controller', to: 'spindle' },
      { id: 'coolant-spindle', kind: 'fluid', from: 'coolant', to: 'spindle' },
      { id: 'guard-motion', kind: 'spatial', from: 'guard', to: 'motion' },
    ],
    constraints: [
      { id: 'load', domain: 'mechanical', key: 'frame-load', value: 12_000 },
      { id: 'power', domain: 'electrical', key: 'spindle-power', value: 18.5 },
      { id: 'flow', domain: 'fluid', key: 'coolant-flow', value: 24 },
      { id: 'interlock', domain: 'safety', key: 'guard-interlock', value: 'dual-channel' },
      { id: 'motion-control', domain: 'control', key: 'axis-loop', value: 'closed-loop' },
    ],
    candidates: [
      { id: 'compact-cell', title: 'Compact cell', summary: 'Short footprint with integrated coolant routing.', parameterKeys: ['footprint', 'guard-clearance'], featureKeys: ['welded-frame', 'integrated-skid'] },
      { id: 'service-cell', title: 'Service-first cell', summary: 'Wide maintenance aisle with modular subsystems.', parameterKeys: ['service-aisle', 'module-spacing'], featureKeys: ['bolted-frame', 'removable-skid'] },
    ],
  },
  {
    scenarioId: 'mold-tooling', title: 'Multi-cavity injection mold', gaugeNodeId: 'cooling',
    nodes: [
      { id: 'fixed-half', kind: 'subassembly', label: 'Fixed half' },
      { id: 'moving-half', kind: 'subassembly', label: 'Moving half' },
      { id: 'core-cavity', kind: 'component', label: 'Core and cavity' },
      { id: 'cooling', kind: 'subassembly', label: 'Cooling circuit' },
      { id: 'ejector', kind: 'subassembly', label: 'Ejector system', parentId: 'moving-half' },
      { id: 'manifold', kind: 'component', label: 'Hot runner manifold', parentId: 'fixed-half' },
    ],
    interfaces: [
      { id: 'parting-line', kind: 'mechanical', from: 'fixed-half', to: 'moving-half' },
      { id: 'cooling-core', kind: 'fluid', from: 'cooling', to: 'core-cavity' },
      { id: 'ejector-cavity', kind: 'spatial', from: 'ejector', to: 'core-cavity' },
      { id: 'manifold-cavity', kind: 'mechanical', from: 'manifold', to: 'core-cavity' },
    ],
    constraints: [
      { id: 'clamp', domain: 'mechanical', key: 'clamp-force', value: 3_500 },
      { id: 'melt', domain: 'thermal', key: 'melt-temperature', value: 240 },
      { id: 'cooling-flow', domain: 'fluid', key: 'cooling-flow', value: 18 },
      { id: 'eject-sequence', domain: 'control', key: 'ejection-sequence', value: 'open-then-eject' },
      { id: 'heater-power', domain: 'electrical', key: 'manifold-power', value: 8.4 },
    ],
    candidates: [
      { id: 'cycle-time-tool', title: 'Cycle-time tool', summary: 'Dense conformal cooling concept.', parameterKeys: ['channel-offset', 'flow-rate'], featureKeys: ['conformal-cooling', 'balanced-runner'] },
      { id: 'service-tool', title: 'Serviceable tool', summary: 'Replaceable inserts and straight-drilled circuits.', parameterKeys: ['insert-clearance', 'plug-spacing'], featureKeys: ['replaceable-inserts', 'drilled-cooling'] },
    ],
  },
  {
    scenarioId: 'electromechanical-enclosure', title: 'Outdoor motion-control enclosure', gaugeNodeId: 'fan',
    nodes: [
      { id: 'cabinet', kind: 'subassembly', label: 'Sealed cabinet' },
      { id: 'power', kind: 'subassembly', label: 'Power section', parentId: 'cabinet' },
      { id: 'controller', kind: 'component', label: 'Motion controller', parentId: 'cabinet' },
      { id: 'fan', kind: 'component', label: 'Filtered fan', parentId: 'cabinet' },
      { id: 'harness', kind: 'subassembly', label: 'Cable harness', parentId: 'cabinet' },
      { id: 'door', kind: 'component', label: 'Interlocked door', parentId: 'cabinet' },
    ],
    interfaces: [
      { id: 'power-controller', kind: 'electrical', from: 'power', to: 'controller' },
      { id: 'controller-harness', kind: 'data', from: 'controller', to: 'harness' },
      { id: 'fan-cabinet', kind: 'spatial', from: 'fan', to: 'cabinet' },
      { id: 'door-power', kind: 'electrical', from: 'door', to: 'power' },
    ],
    constraints: [
      { id: 'ingress', domain: 'mechanical', key: 'ingress-target', value: 'IP54-concept' },
      { id: 'bus', domain: 'electrical', key: 'dc-bus', value: 48 },
      { id: 'heat', domain: 'thermal', key: 'heat-load', value: 620 },
      { id: 'fan-control', domain: 'control', key: 'fan-control', value: 'temperature-loop' },
      { id: 'firmware', domain: 'software', key: 'fault-logging', value: 'latched' },
      { id: 'door-safety', domain: 'safety', key: 'door-interlock', value: 'dual-channel' },
    ],
    candidates: [
      { id: 'sealed-enclosure', title: 'Sealed passive enclosure', summary: 'Large passive heat sink and sealed cable entries.', parameterKeys: ['heat-sink-area', 'gland-spacing'], featureKeys: ['passive-heat-sink', 'sealed-glands'] },
      { id: 'filtered-enclosure', title: 'Filtered active enclosure', summary: 'Serviceable filters and controlled airflow.', parameterKeys: ['fan-flow', 'filter-area'], featureKeys: ['filtered-fan', 'service-door'] },
    ],
  },
] as const;

function candidateArtifact(definition: ScenarioDefinition, projectId: string, sessionId: string, candidate: ScenarioDefinition['candidates'][number]): AiDesignCandidateArtifactV1 {
  return createAiDesignCandidateArtifact({
    trustedServer: true, artifactId: `artifact:${definition.scenarioId}:${candidate.id}`, candidateId: candidate.id,
    projectId, sessionId, baseRevision: 'revision-1', artifactRevision: 1, status: 'published', createdAt: '2026-08-24T09:00:00.000Z',
    contentDigest: serverEvidenceSha256({ scenario: definition.scenarioId, candidate: candidate.id, content: 'concept' }),
    designDigest: serverEvidenceSha256(candidate),
    dependencies: { intentNodeIds: ['intent-purpose', 'intent-envelope'], parameterIds: candidate.parameterKeys, gaugeIds: ['primary-gauge'], featureIds: candidate.featureKeys },
    evidence: [{ evidenceId: `concept:${candidate.id}`, kind: 'ai-concept', status: 'not_run' }],
    server: { generatorId: 'ai-design-complex-scenario-v1', modelId: 'scenario-deterministic', runtimeId: 'scenario-runtime', workerBuildDigest: serverEvidenceSha256({ worker: 'complex-scenario-v1' }), generationRunId: `run:${definition.scenarioId}` },
    supersedes: null,
  });
}

export function listAiDesignComplexScenarioDefinitions(): readonly Pick<ScenarioDefinition, 'scenarioId' | 'title'>[] {
  return DEFINITIONS.map(({ scenarioId, title }) => ({ scenarioId, title }));
}

export async function runAiDesignComplexProductScenario(
  scenarioId: AiDesignComplexScenarioId,
  signingSecret: string,
): Promise<AiDesignComplexScenarioReportV1> {
  const definition = DEFINITIONS.find(item => item.scenarioId === scenarioId);
  if (!definition) throw new Error('AI_DESIGN_COMPLEX_SCENARIO_NOT_FOUND');
  const projectId = `scenario-project:${scenarioId}`, sessionId = `scenario-session:${scenarioId}`, rootId = `root:${scenarioId}`;
  const sourceHash = serverEvidenceSha256({ scenarioId, source: 'reviewed-synthetic-fixture' });
  const nodes = [
    { nodeId: rootId, kind: 'assembly' as const, label: definition.title, parentId: null, sourceIntentNodeIds: ['intent-purpose'] },
    ...definition.nodes.map(node => ({ nodeId: node.id, kind: node.kind, label: node.label, parentId: node.parentId ?? rootId, sourceIntentNodeIds: ['intent-purpose', 'intent-envelope'] })),
  ];
  const structure = createProductStructureGraph({
    projectId, sessionId, revision: 'revision-1', rootNodeId: rootId, nodes,
    edges: definition.nodes.map(node => ({ edgeId: `contains:${node.id}`, kind: 'contains' as const, from: node.parentId ?? rootId, to: node.id })),
    interfaces: definition.interfaces.map(item => createAssemblyInterfaceContract({
      interfaceId: item.id, graphRevision: 'revision-1', kind: item.kind,
      from: { nodeId: item.from, portId: `port:${item.id}:from`, role: 'provider' },
      to: { nodeId: item.to, portId: `port:${item.id}:to`, role: 'consumer' },
      exactGeometryStatus: 'not_run', manufacturingStatus: 'not_run',
    })),
  });
  const constraints = createAiDesignCrossDomainConstraintGraph({
    projectId, sessionId, graphRevision: 1, sourceContentHash: sourceHash,
    nodes: definition.constraints.map(item => ({ id: `constraint:${item.id}`, kind: 'constraint' as const, domain: item.domain, key: item.key, value: item.value, sourceIds: ['reviewed-fixture'], sourceHashes: [sourceHash], confidence: 1 })),
  });
  const artifacts = definition.candidates.map(candidate => candidateArtifact(definition, projectId, sessionId, candidate));
  const partitionResult = createAiDesignGraphPartitions(structure, nodes.map(node => ({ partitionId: `partition:${node.nodeId}`, artifactId: artifacts[0]!.artifactId, nodeIds: [node.nodeId] })));
  const hierarchy = createAiDesignHierarchicalCandidateArtifact({ artifact: artifacts[0]!, level: 'assembly', parentArtifactId: null, childArtifactIds: [], graphPartitionIds: partitionResult.partitions.map(item => item.partitionId), graphCoverage: partitionResult.coverage });
  const sink = new InMemoryAiDesignServerRuntimeArtifacts();
  const bundles = await evaluateAiDesignComplexCandidateSet({
    projectId, sessionId, runId: `run:${scenarioId}`, checkpointDigest: sourceHash,
    candidates: definition.candidates.map((candidate, index) => ({ artifact: artifacts[index]!, title: candidate.title, summary: candidate.summary })),
    productStructure: structure, crossDomainGraph: constraints,
  }, { sink, signingSecret, now: () => new Date('2026-08-24T09:00:00.000Z') });
  const runtimeResult = createAiDesignWorkspaceRuntime({
    projectId, revisionToken: 'revision-1', sessionId,
    inputs: [{ projectId, revision: 0, sourceId: 'reviewed-fixture', sourceHash, projectContentHash: sourceHash, kind: 'text', mimeType: 'text/plain', sizeBytes: 256, authority: 'user_confirmed', provenance: { rights: 'user_owned', origin: 'reviewed synthetic fixture' }, fields: [{ key: 'purpose', value: definition.title, category: 'requirement' }] }],
    now: '2026-08-24T09:00:00.000Z',
  });
  if (!runtimeResult.ok) throw new Error(runtimeResult.issues.join(','));
  const comparison = createDesignCandidateComparison('revision-1', definition.candidates.map((candidate, index) => ({
    candidateId: candidate.id, revision: artifacts[index]!.manifestDigest, baseRevision: 'revision-1', title: candidate.title, summary: candidate.summary,
    metrics: [], evidence: [{ evidenceId: `concept:${candidate.id}`, label: 'Concept critic bundle', status: 'not_run' }], featureIds: candidate.featureKeys,
  })));
  const gauge = createGaugeUxViewModel({
    schema: 'nexyfab.gauge-view-model.v1', gaugeId: 'primary-gauge', type: 'length',
    selection: { version: 1, projectRevision: 'revision-1', assemblyPath: [rootId, definition.gaugeNodeId], partInstanceId: definition.gaugeNodeId, topology: [], sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' },
    binding: { kind: 'feature_parameter', partId: definition.gaugeNodeId, featureId: definition.gaugeNodeId, parameter: 'primary-parameter', unit: 'mm' },
    currentValue: 90, targetValue: 100, delta: 10, unit: 'mm', snapIncrement: 1, range: { min: 10, max: 500 },
    axisFrame: { axis: [1, 0, 0], coordinateFrame: 'world' }, visible: true, primary: true,
    requiresConfirmation: true, confirmationReasons: ['assembly_scope_requires_confirmation'],
    invalidatedVerification: { geometry: 'invalidated', topology: 'invalidated', manufacturing: 'invalidated' },
    baseRevision: 'revision-1', intentId: `intent:gauge:${scenarioId}`,
  }, { fineStep: 1, coarseStep: 10, mobile: true, topologyWillInvalidate: true });
  const runtime = {
    ...runtimeResult.state,
    workflow: { ...runtimeResult.state.workflow, status: 'CANDIDATE_REVIEW' as const },
    candidates: comparison,
    gauges: [gauge],
  };
  const gaugeNodeId = definition.gaugeNodeId;
  const gaugeParent = structure.nodes.find(item => item.nodeId === gaugeNodeId)?.parentId;
  const vm = createAiDesignComplexWorkspaceViewModel(runtime, {
    productStructure: structure, crossDomainGraph: constraints, partitions: partitionResult.partitions,
    hierarchicalArtifacts: [hierarchy], criticBundles: bundles,
    gaugeBindings: [{ bindingId: `gauge-binding:${scenarioId}`, gaugeId: 'primary-gauge', structureNodeId: gaugeNodeId, parameterId: 'primary-parameter', scope: 'subtree', interfaceId: null, affectedNodeIds: [gaugeNodeId, ...(gaugeParent ? [gaugeParent] : [])] }],
  }, { viewportWidth: 390, selectedNodeId: gaugeNodeId });
  const structureIssues = validateProductStructureGraph(structure);
  const constraintIssues = validateAiDesignCrossDomainConstraintGraph(constraints);
  const hierarchyIssues = validateAiDesignHierarchicalCandidateSet([hierarchy]);
  const issues = [...structureIssues, ...constraintIssues, ...partitionResult.issues, ...hierarchyIssues];
  if (bundles.some(item => !item.conceptReviewReady)) issues.push('concept_critic_not_ready');
  if (vm.assemblyTree.length !== structure.nodes.length || vm.assemblyGauges.length !== 1) issues.push('complex_workspace_projection_incomplete');
  const commandStore = new InMemoryAiDesignComplexWorkspaceStore();
  const commandArtifacts = new InMemoryAiDesignServerRuntimeArtifacts();
  for (const artifact of artifacts) await commandArtifacts.putCandidateArtifactImmutable(artifact);
  const commandDependencies = { loadRuntime: async () => structuredClone(runtime), store: commandStore, artifacts: commandArtifacts, signingSecret, now: () => new Date('2026-08-24T09:00:00.000Z') };
  const command = (type: string, commandId: string, expectedComplexRevision: number, payload: unknown) => ({
    schema: 'nexyfab.ai-design-workspace-command.v3' as const, commandId, projectId, sessionId,
    expectedRuntimeRevision: runtime.runtimeRevision, expectedComplexRevision, issuedAt: '2026-08-24T09:00:00.000Z', type, payload,
  });
  const attachedStructure = await executeAiDesignComplexWorkspaceCommand('scenario-owner', command('ATTACH_PRODUCT_STRUCTURE', `command:${scenarioId}:structure`, 0, { productStructure: structure }) as never, commandDependencies);
  const attachedConstraints = attachedStructure.ok
    ? await executeAiDesignComplexWorkspaceCommand('scenario-owner', command('ATTACH_CROSS_DOMAIN_GRAPH', `command:${scenarioId}:constraints`, 1, { crossDomainGraph: constraints }) as never, commandDependencies)
    : attachedStructure;
  const commandCritics = attachedConstraints.ok
    ? await executeAiDesignComplexWorkspaceCommand('scenario-owner', command('RUN_COMPLEX_CRITICS', `command:${scenarioId}:critics`, 2, { candidateIds: definition.candidates.map(item => item.id) }) as never, commandDependencies)
    : attachedConstraints;
  const precisionRequest = commandCritics.ok
    ? await executeAiDesignComplexWorkspaceCommand('scenario-owner', command('REQUEST_PRECISION_VERIFICATION', `command:${scenarioId}:precision`, 3, { structureNodeIds: [gaugeNodeId], interfaceIds: [structure.interfaces[0]!.interfaceId], partitionIds: [], gaugeIds: [] }) as never, commandDependencies)
    : commandCritics;
  const commandPathStatus = precisionRequest.ok ? 'PASS' as const : 'FAIL' as const;
  if (!precisionRequest.ok) issues.push(`v4_command_path:${precisionRequest.code}`);
  if (precisionRequest.ok) {
    const readModel = await loadAiDesignComplexWorkspaceReadModel('scenario-owner', projectId, sessionId, { loadRuntime: commandDependencies.loadRuntime, store: commandStore, artifacts: commandArtifacts, viewportWidth: 390, selectedNodeId: gaugeNodeId });
    if (readModel.precision.status !== 'NOT_RUN' || readModel.precision.manufacturingReleaseReady !== false) issues.push('v4_command_path_authority_violation');
  }
  return {
    schema: AI_DESIGN_COMPLEX_SCENARIO_REPORT_SCHEMA,
    scenarioId, title: definition.title, status: issues.length ? 'FAIL' : 'PASS',
    structure: { nodes: structure.nodes.length, edges: structure.edges.length, interfaces: structure.interfaces.length, issues: structureIssues },
    constraints: { domains: new Set(constraints.nodes.map(item => item.domain)).size, constraints: constraints.nodes.filter(item => item.kind === 'constraint').length, issues: constraintIssues },
    partitions: { count: partitionResult.partitions.length, coverage: partitionResult.coverage, issues: partitionResult.issues },
    critics: { bundles: bundles.length, conceptReviewReady: bundles.filter(item => item.conceptReviewReady).length, failed: bundles.filter(item => item.status === 'FAIL').length },
    ux: { desktopTreeRows: vm.assemblyTree.length, mobileSheets: vm.inspector.mobileSheets.length, assemblyGauges: vm.assemblyGauges.length, minimumTouchTargetPx: 44 },
    commandPath: { status: commandPathStatus, complexRevision: precisionRequest.ok ? precisionRequest.aggregate.complexRevision : precisionRequest.aggregate?.complexRevision ?? 0, precisionRequestCreated: precisionRequest.ok && precisionRequest.aggregate.precisionRequests.length === 1 },
    precisionCadRequired: true, exactCadVerificationStatus: 'NOT_RUN', manufacturingReleaseReady: false,
    issues,
  };
}
