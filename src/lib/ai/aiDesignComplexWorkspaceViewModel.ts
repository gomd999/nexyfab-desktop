import type { AiDesignWorkspaceRuntimeV1 } from './aiDesignWorkspaceRuntime';
import { createAiDesignWorkspaceV2ViewModel, type AiDesignWorkspaceV2ViewModel } from './aiDesignWorkspaceV2ViewModel';
import {
  validateProductStructureGraph,
  PRODUCT_STRUCTURE_MAX_EDGES,
  PRODUCT_STRUCTURE_MAX_NODES,
  type ProductStructureGraphV1,
  type ProductStructureNodeV1,
} from './aiDesignProductStructureGraph';
import {
  validateAiDesignCrossDomainConstraintGraph,
  AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES,
  AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES,
  type AiDesignCrossDomainConstraintGraphV1,
} from './aiDesignCrossDomainConstraintGraph';
import { validateAiDesignIntentResolutionArtifact, type AiDesignIntentResolutionArtifactV1 } from './aiDesignIntentResolution';
import type { AiDesignMultiCriticBundleV1 } from './aiDesignMultiCriticEvaluation';
import type { AiDesignChangeImpactPlanV1 } from './aiDesignChangeImpact';
import { AI_DESIGN_PARTITION_MAX, validateAiDesignGraphPartition, validateAiDesignHierarchicalCandidateSet, type AiDesignGraphPartitionV1, type AiDesignHierarchicalCandidateArtifactV1 } from './aiDesignHierarchicalCandidatePartition';

export const AI_DESIGN_COMPLEX_WORKSPACE_VIEW_MODEL_SCHEMA = 'nexyfab.ai-design-complex-workspace-view-model.v1' as const;

export interface AiDesignAssemblyGaugeBindingV1 {
  bindingId: string;
  gaugeId: string;
  structureNodeId: string;
  parameterId: string;
  scope: 'component' | 'subtree' | 'interface';
  interfaceId: string | null;
  affectedNodeIds: readonly string[];
}

export interface AiDesignStructureConstraintBindingV1 {
  crossDomainNodeId: string;
  structureNodeIds: readonly string[];
}

export interface AiDesignComplexWorkspaceSidecarsV1 {
  productStructure: ProductStructureGraphV1 | null;
  crossDomainGraph: AiDesignCrossDomainConstraintGraphV1 | null;
  resolutions?: readonly AiDesignIntentResolutionArtifactV1[];
  hierarchicalArtifacts?: readonly AiDesignHierarchicalCandidateArtifactV1[];
  partitions?: readonly AiDesignGraphPartitionV1[];
  criticBundles?: readonly AiDesignMultiCriticBundleV1[];
  changeImpact?: AiDesignChangeImpactPlanV1 | null;
  gaugeBindings?: readonly AiDesignAssemblyGaugeBindingV1[];
  constraintBindings?: readonly AiDesignStructureConstraintBindingV1[];
}

export type AiDesignHeatLevel = 'none' | 'attention' | 'high' | 'critical';

export interface AiDesignComplexWorkspaceViewModelV1 {
  schema: typeof AI_DESIGN_COMPLEX_WORKSPACE_VIEW_MODEL_SCHEMA;
  base: AiDesignWorkspaceV2ViewModel;
  scale: {
    structureNodes: number;
    structureEdges: number;
    assemblyInterfaces: number;
    crossDomainConstraints: number;
    domains: number;
    graphPartitionCount: number;
    bounded: boolean;
  };
  assemblyTree: readonly {
    nodeId: string;
    label: string;
    kind: ProductStructureNodeV1['kind'];
    parentId: string | null;
    depth: number;
    path: readonly string[];
    childCount: number;
    expandable: boolean;
    selected: boolean;
    heat: AiDesignHeatLevel;
    reasons: readonly string[];
  }[];
  interfaces: readonly {
    interfaceId: string;
    kind: string;
    fromNodeId: string;
    toNodeId: string;
    exactGeometryStatus: string;
    manufacturingStatus: string;
    trustLabel: string;
  }[];
  constraints: {
    activeConflictCount: number;
    unresolvedCount: number;
    resolvedCount: number;
    affectedStructureNodeIds: readonly string[];
    domains: readonly string[];
    resolutionAction: {
      command: 'RESOLVE_INTENT_CONFLICT';
      enabled: boolean;
      requiresExplicitChoice: true;
      automaticResolution: false;
    };
  };
  assemblyGauges: readonly {
    bindingId: string;
    gaugeId: string;
    label: string;
    structureNodeId: string;
    structurePath: readonly string[];
    parameterId: string;
    scope: AiDesignAssemblyGaugeBindingV1['scope'];
    interfaceId: string | null;
    targetValue: number;
    unit: string;
    fineStep: number;
    coarseStep: number;
    affectedNodeCount: number;
    requiresConfirmation: boolean;
    touchTargetMinPx: 44;
  }[];
  changeHeatmap: readonly {
    structureNodeId: string;
    heat: AiDesignHeatLevel;
    affectedArtifactIds: readonly string[];
    pendingReverificationCount: number;
    reasons: readonly string[];
  }[];
  candidateEvaluations: readonly {
    candidateId: string;
    status: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'NOT_RUN';
    conceptReviewReady: boolean;
    failedCritics: readonly string[];
    pendingCritics: readonly string[];
    engineeringVerified: false;
    manufacturingReleaseReady: false;
  }[];
  inspector: {
    desktopTabs: readonly ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation'];
    mobileSheets: readonly ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation', 'recovery'];
    selectedNodeId: string | null;
    stickyActionBar: boolean;
    touchTargetMinPx: 44;
  };
  trust: {
    conceptOnly: true;
    structuralPlanningStatus: 'NOT_RUN' | 'PASS' | 'FAIL';
    crossDomainPlanningStatus: 'NOT_RUN' | 'PASS' | 'INCOMPLETE';
    engineeringVerificationStatus: 'NOT_RUN';
    exactCadVerificationStatus: 'NOT_RUN' | 'STALE' | 'PASS';
    manufacturingReleaseReady: false;
  };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MAX_BINDINGS = 2_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertSidecarScope(state: AiDesignWorkspaceRuntimeV1, sidecars: AiDesignComplexWorkspaceSidecarsV1): void {
  if (sidecars.productStructure) {
    const issues = validateProductStructureGraph(sidecars.productStructure);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_STRUCTURE_INVALID:${issues.join(',')}`);
    if (sidecars.productStructure.projectId !== state.projectId) throw new Error('AI_DESIGN_COMPLEX_STRUCTURE_SCOPE_MISMATCH');
    if (sidecars.productStructure.sessionId !== state.session.sessionId) throw new Error('AI_DESIGN_COMPLEX_STRUCTURE_SESSION_MISMATCH');
  }
  if (sidecars.crossDomainGraph) {
    const issues = validateAiDesignCrossDomainConstraintGraph(sidecars.crossDomainGraph);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_CONSTRAINTS_INVALID:${issues.join(',')}`);
    if (sidecars.crossDomainGraph.projectId !== state.projectId) throw new Error('AI_DESIGN_COMPLEX_CONSTRAINT_SCOPE_MISMATCH');
    if (sidecars.crossDomainGraph.sessionId !== state.session.sessionId) throw new Error('AI_DESIGN_COMPLEX_CONSTRAINT_SESSION_MISMATCH');
  }
  for (const artifact of sidecars.hierarchicalArtifacts ?? []) {
    if (artifact.artifact.projectId !== state.projectId || artifact.artifact.sessionId !== state.session.sessionId) throw new Error('AI_DESIGN_COMPLEX_ARTIFACT_SCOPE_MISMATCH');
  }
  const hierarchyIssues = validateAiDesignHierarchicalCandidateSet(sidecars.hierarchicalArtifacts ?? []);
  if (hierarchyIssues.length) throw new Error(`AI_DESIGN_COMPLEX_HIERARCHY_INVALID:${hierarchyIssues.join(',')}`);
  if (sidecars.productStructure) for (const partition of sidecars.partitions ?? []) {
    const issues = validateAiDesignGraphPartition(partition, sidecars.productStructure);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_PARTITION_INVALID:${issues.join(',')}`);
  }
  for (const resolution of sidecars.resolutions ?? []) {
    const issues = validateAiDesignIntentResolutionArtifact(resolution);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_RESOLUTION_INVALID:${issues.join(',')}`);
    if (resolution.projectId !== state.projectId || resolution.sessionId !== state.session.sessionId) throw new Error('AI_DESIGN_COMPLEX_RESOLUTION_SCOPE_MISMATCH');
  }
  for (const bundle of sidecars.criticBundles ?? []) {
    if (bundle.projectId !== state.projectId || bundle.sessionId !== state.session.sessionId) throw new Error('AI_DESIGN_COMPLEX_CRITIC_SCOPE_MISMATCH');
  }
  if ((sidecars.gaugeBindings?.length ?? 0) > MAX_BINDINGS || (sidecars.constraintBindings?.length ?? 0) > MAX_BINDINGS) throw new Error('AI_DESIGN_COMPLEX_BINDINGS_TOO_LARGE');
}

function treeMetadata(nodes: readonly ProductStructureNodeV1[]): Map<string, { depth: number; path: string[] }> {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const output = new Map<string, { depth: number; path: string[] }>();
  for (const node of nodes) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cursor: ProductStructureNodeV1 | undefined = node;
    while (cursor) {
      if (seen.has(cursor.nodeId)) break;
      seen.add(cursor.nodeId);
      path.unshift(cursor.label);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    output.set(node.nodeId, { depth: Math.max(0, path.length - 1), path });
  }
  return output;
}

function heatRank(level: AiDesignHeatLevel): number {
  return { none: 0, attention: 1, high: 2, critical: 3 }[level];
}

function maxHeat(left: AiDesignHeatLevel, right: AiDesignHeatLevel): AiDesignHeatLevel {
  return heatRank(left) >= heatRank(right) ? left : right;
}

/** Builds the responsive assembly/constraint/impact workspace without claiming CAD authority. */
export function createAiDesignComplexWorkspaceViewModel(
  state: AiDesignWorkspaceRuntimeV1,
  sidecars: AiDesignComplexWorkspaceSidecarsV1,
  options: { viewportWidth?: number; selectedNodeId?: string | null } = {},
): AiDesignComplexWorkspaceViewModelV1 {
  assertSidecarScope(state, sidecars);
  const base = createAiDesignWorkspaceV2ViewModel(state, { viewportWidth: options.viewportWidth });
  const structure = sidecars.productStructure;
  const crossDomain = sidecars.crossDomainGraph;
  const nodes = structure?.nodes ?? [];
  const nodeIds = new Set(nodes.map(node => node.nodeId));
  const metadata = treeMetadata(nodes);
  const children = new Map<string, number>();
  for (const node of nodes) if (node.parentId) children.set(node.parentId, (children.get(node.parentId) ?? 0) + 1);

  const activeConflictIds = new Set((crossDomain?.nodes ?? []).filter(node => node.kind === 'conflict' && node.status === 'active').map(node => node.id));
  const resolvedIds = new Set((sidecars.resolutions ?? []).filter(item => item.projectId === state.projectId).map(item => item.targetNodeId));
  const unresolvedConflictIds = new Set([...activeConflictIds].filter(id => !resolvedIds.has(id)));
  const affectedByConstraint = new Set<string>();
  for (const binding of sidecars.constraintBindings ?? []) {
    if (!ID.test(binding.crossDomainNodeId) || binding.structureNodeIds.length > MAX_BINDINGS || binding.structureNodeIds.some(id => !nodeIds.has(id))) throw new Error('AI_DESIGN_COMPLEX_CONSTRAINT_BINDING_INVALID');
    if (unresolvedConflictIds.has(binding.crossDomainNodeId)) for (const id of binding.structureNodeIds) affectedByConstraint.add(id);
  }

  const partitionById = new Map((sidecars.partitions ?? []).map(item => [item.partitionId, item]));
  const artifactNodes = new Map<string, Set<string>>();
  for (const hierarchy of sidecars.hierarchicalArtifacts ?? []) {
    const values = artifactNodes.get(hierarchy.artifact.artifactId) ?? new Set<string>();
    for (const partitionId of hierarchy.graphPartitionIds) for (const nodeId of partitionById.get(partitionId)?.nodeIds ?? []) values.add(nodeId);
    artifactNodes.set(hierarchy.artifact.artifactId, values);
  }
  const affectedArtifacts = new Set(sidecars.changeImpact?.affectedArtifactIds ?? []);
  const nodeArtifacts = new Map<string, string[]>();
  for (const artifactId of affectedArtifacts) for (const nodeId of artifactNodes.get(artifactId) ?? []) {
    const values = nodeArtifacts.get(nodeId) ?? [];
    values.push(artifactId);
    nodeArtifacts.set(nodeId, values);
  }
  const pendingByArtifact = new Map<string, number>();
  for (const item of sidecars.changeImpact?.reverificationPlan ?? []) pendingByArtifact.set(item.artifactId, (pendingByArtifact.get(item.artifactId) ?? 0) + 1);
  const heatRows = nodes.map(node => {
    const artifacts = unique(nodeArtifacts.get(node.nodeId) ?? []);
    const pendingReverificationCount = artifacts.reduce((sum, artifactId) => sum + (pendingByArtifact.get(artifactId) ?? 0), 0);
    const reasons: string[] = [];
    let heat: AiDesignHeatLevel = 'none';
    if (affectedByConstraint.has(node.nodeId)) { heat = maxHeat(heat, 'critical'); reasons.push('unresolved_cross_domain_conflict'); }
    if (artifacts.length) { heat = maxHeat(heat, pendingReverificationCount ? 'high' : 'critical'); reasons.push(pendingReverificationCount ? 'artifact_change_requires_reverification' : 'affected_artifact_has_no_reverification_step'); }
    return { structureNodeId: node.nodeId, heat, affectedArtifactIds: artifacts, pendingReverificationCount, reasons: unique(reasons) };
  });
  const heatByNode = new Map(heatRows.map(row => [row.structureNodeId, row]));

  const gaugeById = new Map(base.gauges.map(gauge => [gauge.gaugeId, gauge]));
  const assemblyGauges = (sidecars.gaugeBindings ?? []).map(binding => {
    const gauge = gaugeById.get(binding.gaugeId);
    const node = metadata.get(binding.structureNodeId);
    if (!ID.test(binding.bindingId) || !gauge || !node || !ID.test(binding.parameterId)
      || binding.affectedNodeIds.length > MAX_BINDINGS || binding.affectedNodeIds.some(id => !nodeIds.has(id))
      || (binding.interfaceId !== null && !structure?.interfaces.some(item => item.interfaceId === binding.interfaceId))) {
      throw new Error('AI_DESIGN_COMPLEX_GAUGE_BINDING_INVALID');
    }
    return {
      bindingId: binding.bindingId, gaugeId: binding.gaugeId, label: gauge.label,
      structureNodeId: binding.structureNodeId, structurePath: node.path, parameterId: binding.parameterId,
      scope: binding.scope, interfaceId: binding.interfaceId, targetValue: gauge.targetValue, unit: gauge.unit,
      fineStep: gauge.fineStep, coarseStep: gauge.coarseStep, affectedNodeCount: new Set(binding.affectedNodeIds).size,
      requiresConfirmation: gauge.requiresConfirmation || binding.scope !== 'component', touchTargetMinPx: 44 as const,
    };
  });

  const bundleByCandidate = new Map((sidecars.criticBundles ?? []).map(bundle => [bundle.candidateId, bundle]));
  const candidateEvaluations = (state.candidates?.candidates ?? []).map(candidate => {
    const bundle = bundleByCandidate.get(candidate.candidateId);
    return {
      candidateId: candidate.candidateId,
      status: bundle?.status ?? 'NOT_RUN' as const,
      conceptReviewReady: bundle?.conceptReviewReady ?? false,
      failedCritics: bundle?.failedCritics ?? [],
      pendingCritics: bundle?.pendingCritics ?? [],
      engineeringVerified: false as const,
      manufacturingReleaseReady: false as const,
    };
  });
  const structureStatus = !structure ? 'NOT_RUN' : validateProductStructureGraph(structure).length ? 'FAIL' : 'PASS';
  const crossDomainUnresolved = unresolvedConflictIds.size;
  const crossDomainStatus = !crossDomain ? 'NOT_RUN' : crossDomainUnresolved ? 'INCOMPLETE' : 'PASS';

  return {
    schema: AI_DESIGN_COMPLEX_WORKSPACE_VIEW_MODEL_SCHEMA,
    base,
    scale: {
      structureNodes: nodes.length,
      structureEdges: structure?.edges.length ?? 0,
      assemblyInterfaces: structure?.interfaces.length ?? 0,
      crossDomainConstraints: (crossDomain?.nodes ?? []).filter(node => node.kind === 'constraint').length,
      domains: new Set((crossDomain?.nodes ?? []).map(node => node.domain)).size,
      graphPartitionCount: sidecars.partitions?.length ?? 0,
      bounded: nodes.length >= PRODUCT_STRUCTURE_MAX_NODES || (structure?.edges.length ?? 0) >= PRODUCT_STRUCTURE_MAX_EDGES
        || (crossDomain?.nodes.length ?? 0) >= AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES
        || (crossDomain?.edges.length ?? 0) >= AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES
        || (sidecars.partitions?.length ?? 0) >= AI_DESIGN_PARTITION_MAX,
    },
    assemblyTree: nodes.map(node => ({
      nodeId: node.nodeId, label: node.label, kind: node.kind, parentId: node.parentId,
      depth: metadata.get(node.nodeId)?.depth ?? 0, path: metadata.get(node.nodeId)?.path ?? [node.label],
      childCount: children.get(node.nodeId) ?? 0, expandable: (children.get(node.nodeId) ?? 0) > 0,
      selected: options.selectedNodeId === node.nodeId, heat: heatByNode.get(node.nodeId)?.heat ?? 'none',
      reasons: heatByNode.get(node.nodeId)?.reasons ?? [],
    })),
    interfaces: (structure?.interfaces ?? []).map(item => ({
      interfaceId: item.interfaceId, kind: item.kind, fromNodeId: item.from.nodeId, toNodeId: item.to.nodeId,
      exactGeometryStatus: item.exactGeometryStatus, manufacturingStatus: item.manufacturingStatus,
      trustLabel: item.exactGeometryStatus === 'verified' && item.manufacturingStatus === 'verified'
        ? 'Precision evidence attached' : 'Concept interface; Precision CAD verification pending',
    })),
    constraints: {
      activeConflictCount: activeConflictIds.size,
      unresolvedCount: unresolvedConflictIds.size,
      resolvedCount: [...activeConflictIds].filter(id => resolvedIds.has(id)).length,
      affectedStructureNodeIds: [...affectedByConstraint].sort(),
      domains: unique((crossDomain?.nodes ?? []).map(node => node.domain)),
      resolutionAction: { command: 'RESOLVE_INTENT_CONFLICT', enabled: unresolvedConflictIds.size > 0, requiresExplicitChoice: true, automaticResolution: false },
    },
    assemblyGauges,
    changeHeatmap: heatRows,
    candidateEvaluations,
    inspector: {
      desktopTabs: ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation'],
      mobileSheets: ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation', 'recovery'],
      selectedNodeId: options.selectedNodeId && nodeIds.has(options.selectedNodeId) ? options.selectedNodeId : null,
      stickyActionBar: base.layout.mode === 'mobile' && (base.primaryAction !== null || assemblyGauges.length > 0),
      touchTargetMinPx: 44,
    },
    trust: {
      conceptOnly: true,
      structuralPlanningStatus: structureStatus,
      crossDomainPlanningStatus: crossDomainStatus,
      engineeringVerificationStatus: 'NOT_RUN',
      exactCadVerificationStatus: base.trust.precisionVerification,
      manufacturingReleaseReady: false,
    },
  };
}
