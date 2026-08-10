import { validateProductDecomposition, type ProductDecompositionPlan } from './productDecomposition';
import { parseProductDecompositionPlan } from './productDecompositionSchema';

export type ProductPlanAccuracyGateId =
  | 'structure'
  | 'requirements'
  | 'traceability'
  | 'authoritative-inputs'
  | 'parameter-provenance'
  | 'editable-definitions'
  | 'assembly-connectivity'
  | 'hierarchy'
  | 'transforms';

export interface ProductPlanAccuracyGate {
  id: ProductPlanAccuracyGateId;
  status: 'pass' | 'refine' | 'input_required';
  reasons: string[];
}

export interface ProductDecompositionAccuracyAssessment {
  schema: 'nexyfab.product-decomposition-accuracy.v1';
  readyForGeometry: boolean;
  requiresAuthoritativeInput: boolean;
  gates: ProductPlanAccuracyGate[];
  metrics: {
    requirements: number;
    tracedRequirements: number;
    definitions: number;
    instances: number;
    activeMates: number;
    connectedInstances: number;
    hierarchyMemberships: number;
    numericParameters: number;
    tracedParameters: number;
    lockedParameters: number;
  };
}

const criticalAcceptance = new Set(['interface', 'load', 'motion', 'safety']);
const add = (gates: ProductPlanAccuracyGate[], id: ProductPlanAccuracyGateId, status: ProductPlanAccuracyGate['status'], reasons: string[]) =>
  gates.push({ id, status: reasons.length ? status : 'pass', reasons });

/** Runtime shape guard for untrusted model JSON. It intentionally validates only
 * the envelope; the structural and engineering validators provide detailed errors. */
export function isProductDecompositionPlan(value: unknown): value is ProductDecompositionPlan {
  return parseProductDecompositionPlan(value).ok;
}

/** Independent server-side gate. Model-reported confidence/completeness never
 * substitutes for requirement traceability, authoritative facts or mate connectivity. */
export function assessProductDecompositionAccuracy(plan: ProductDecompositionPlan, trustedEvidenceRefs?: ReadonlySet<string>): ProductDecompositionAccuracyAssessment {
  const gates: ProductPlanAccuracyGate[] = [];
  const structural = validateProductDecomposition(plan).map(issue => `${issue.path}: ${issue.message}`);
  add(gates, 'structure', 'refine', structural);

  const requirementReasons: string[] = [];
  if (!plan.requirements.length) requirementReasons.push('At least one explicit product requirement is required.');
  for (const requirement of plan.requirements) {
    if (!requirement.text.trim()) requirementReasons.push(`Requirement ${requirement.id || '(missing id)'} has no text.`);
    if (criticalAcceptance.has(requirement.category) && !requirement.acceptance?.trim()) {
      requirementReasons.push(`Critical requirement ${requirement.id} needs a measurable acceptance criterion.`);
    }
    if (!requirement.sourceRef?.trim()) requirementReasons.push(`Requirement ${requirement.id} needs a traceable sourceRef.`);
    else if (trustedEvidenceRefs && !trustedEvidenceRefs.has(requirement.sourceRef)) requirementReasons.push(`Requirement ${requirement.id} uses untrusted sourceRef ${requirement.sourceRef}.`);
  }
  add(gates, 'requirements', 'input_required', requirementReasons);

  const traced = new Set(plan.definitions.flatMap(definition => definition.requirementIds));
  const traceReasons = plan.requirements.filter(requirement => !traced.has(requirement.id))
    .map(requirement => `Requirement ${requirement.id} is not allocated to any editable component definition.`);
  add(gates, 'traceability', 'refine', traceReasons);

  const authorityReasons = [
    ...plan.assumptions.filter(value => value.trim()).map(value => `Unconfirmed assumption: ${value}`),
    ...plan.unresolved.filter(value => value.trim()).map(value => `Unresolved input: ${value}`),
  ];
  for (const definition of plan.definitions) {
    if (definition.metadata.source === 'assumed') authorityReasons.push(`${definition.id}: assumed metadata must be confirmed.`);
    if (definition.makeOrBuy === 'make' && !definition.metadata.material?.trim()) authorityReasons.push(`${definition.id}: manufacturing material is required.`);
    if (definition.makeOrBuy === 'make' && !definition.metadata.process?.trim()) authorityReasons.push(`${definition.id}: manufacturing process is required.`);
    if (definition.makeOrBuy === 'buy' && (definition.metadata.source !== 'catalog' || !definition.metadata.catalogId?.trim() || !definition.metadata.catalogRevision?.trim() || !/^[a-f0-9]{64}$/i.test(definition.metadata.artifactSha256 ?? ''))) authorityReasons.push(`${definition.id}: bought component requires catalog id, revision and immutable artifact SHA-256.`);
  }
  add(gates, 'authoritative-inputs', 'input_required', authorityReasons);

  const acceptedSources = new Set(plan.requirements.map(requirement => requirement.sourceRef).filter((value): value is string => Boolean(value)));
  const numericLeaves = plan.definitions.flatMap(definition => geometryNumericParameters(definition.featureTree).map(item => ({ definition, ...item })));
  let tracedParameters = 0;
  let lockedParameters = 0;
  const parameterReasons: string[] = [];
  for (const definition of plan.definitions) {
    const byPath = new Map<string, typeof definition.parameterEvidence[number]>();
    for (const evidence of definition.parameterEvidence) {
      if (byPath.has(evidence.path)) parameterReasons.push(`${definition.id}: duplicate parameter evidence for ${evidence.path}.`);
      byPath.set(evidence.path, evidence);
      if (!acceptedSources.has(evidence.sourceRef)) parameterReasons.push(`${definition.id}:${evidence.path}: sourceRef is not bound to a product requirement.`);
      if (trustedEvidenceRefs && !trustedEvidenceRefs.has(evidence.sourceRef)) parameterReasons.push(`${definition.id}:${evidence.path}: sourceRef ${evidence.sourceRef} is not trusted.`);
      if (!Number.isFinite(evidence.tolerance) || (evidence.tolerance ?? -1) < 0) parameterReasons.push(`${definition.id}:${evidence.path}: an explicit non-negative tolerance is required.`);
      if (evidence.status === 'derived' && (!evidence.derivation?.trim() || !(evidence.inputSourceRefs?.length))) parameterReasons.push(`${definition.id}:${evidence.path}: derived value requires a derivation and inputSourceRefs.`);
      if (evidence.status === 'catalog' && definition.metadata.source !== 'catalog') parameterReasons.push(`${definition.id}:${evidence.path}: catalog evidence requires admitted catalog metadata.`);
      if (evidence.locked) lockedParameters++;
    }
    for (const leaf of geometryNumericParameters(definition.featureTree)) {
      const evidence = byPath.get(leaf.path);
      if (!evidence) { parameterReasons.push(`${definition.id}:${leaf.path}: numeric geometry value ${leaf.value} has no parameter evidence.`); continue; }
      if (evidence.value !== leaf.value) parameterReasons.push(`${definition.id}:${leaf.path}: evidence value ${evidence.value} does not match geometry value ${leaf.value}.`);
      if (evidence.unit !== inferredUnit(leaf.path)) parameterReasons.push(`${definition.id}:${leaf.path}: unit must be ${inferredUnit(leaf.path)}.`);
      tracedParameters++;
    }
  }
  add(gates, 'parameter-provenance', 'input_required', parameterReasons);

  const definitionReasons = plan.definitions.flatMap(definition => definition.featureTree?.nodes?.length
    ? [] : [`${definition.id}: an editable non-empty FeatureTree or admitted catalog geometry is required.`]);
  add(gates, 'editable-definitions', 'refine', definitionReasons);

  const activeMates = plan.mates.filter(mate => mate.suppressed !== true);
  const adjacency = new Map(plan.instances.map(instance => [instance.id, new Set<string>()]));
  for (const mate of activeMates) {
    adjacency.get(mate.a.partId)?.add(mate.b.partId);
    adjacency.get(mate.b.partId)?.add(mate.a.partId);
  }
  const queue = plan.instances.filter(instance => instance.fixed).map(instance => instance.id);
  const connected = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    for (const neighbor of adjacency.get(id) ?? []) if (!connected.has(neighbor)) { connected.add(neighbor); queue.push(neighbor); }
  }
  const disconnected = plan.instances.filter(instance => !connected.has(instance.id));
  const connectionReasons = plan.instances.length <= 1 ? [] : disconnected.map(instance => `${instance.id}: no active mate path reaches a fixed root.`);
  add(gates, 'assembly-connectivity', 'refine', connectionReasons);

  const hierarchyMemberships = new Set(plan.subassemblies.flatMap(item => item.instanceIds));
  const hierarchyReasons = plan.instances.length >= 10 && plan.subassemblies.length === 0
    ? ['A complex assembly with 10 or more occurrences requires an explicit functional subassembly hierarchy.'] : [];
  add(gates, 'hierarchy', 'refine', hierarchyReasons);

  const transformReasons: string[] = [];
  for (const instance of plan.instances) {
    const q = instance.orientation;
    if (!q) continue;
    const values = [q.x, q.y, q.z, q.w];
    const norm = Math.hypot(...values);
    if (!values.every(Number.isFinite) || Math.abs(norm - 1) > 1e-6) transformReasons.push(`${instance.id}: orientation must be a finite unit quaternion.`);
  }
  add(gates, 'transforms', 'refine', transformReasons);

  const readyForGeometry = gates.every(gate => gate.status === 'pass');
  return {
    schema: 'nexyfab.product-decomposition-accuracy.v1',
    readyForGeometry,
    requiresAuthoritativeInput: gates.some(gate => gate.status === 'input_required'),
    gates,
    metrics: {
      requirements: plan.requirements.length,
      tracedRequirements: plan.requirements.filter(requirement => traced.has(requirement.id)).length,
      definitions: plan.definitions.length,
      instances: plan.instances.length,
      activeMates: activeMates.length,
      connectedInstances: connected.size,
      hierarchyMemberships: hierarchyMemberships.size,
      numericParameters: numericLeaves.length,
      tracedParameters,
      lockedParameters,
    },
  };
}

export const productPlanAccuracyReasons = (assessment: ProductDecompositionAccuracyAssessment): string[] =>
  assessment.gates.filter(gate => gate.status !== 'pass').flatMap(gate => gate.reasons.map(reason => `${gate.id}: ${reason}`));

/** Enumerates the stable paths which must carry independent evidence. This is
 * also used by manual-review UI to build a complete parameter evidence sheet. */
export function geometryNumericParameters(tree: ProductDecompositionPlan['definitions'][number]['featureTree']): Array<{ path: string; value: number }> {
  const leaves: Array<{ path: string; value: number }> = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') { leaves.push({ path, value }); return; }
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value as Record<string, unknown>)) visit(item, `${path}.${key}`);
  };
  for (const node of tree.nodes) visit(node.payload, `featureTree.nodes.${node.id}.payload`);
  return leaves;
}

function inferredUnit(path: string): 'mm' | 'deg' | 'ratio' | 'count' {
  const key = path.split(/[.\[]/).filter(Boolean).at(-1)?.toLowerCase() ?? '';
  if (/(count|segments|teeth|copies|index)$/.test(key)) return 'count';
  if (/(angle|degrees|deg)$/.test(key)) return 'deg';
  if (/(ratio|scale)$/.test(key)) return 'ratio';
  return 'mm';
}
