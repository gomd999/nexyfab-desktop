import type { RefinementStage } from './multiStageRefinement';

type UnknownRecord = Record<string, unknown>;

export interface RefinementStageValidation {
  passed: boolean;
  errors: string[];
}

const record = (value: unknown): UnknownRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const stableId = (value: unknown): value is string => nonEmpty(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const stringArray = (value: unknown): string[] | null => Array.isArray(value) && value.every(nonEmpty) ? value as string[] : null;
const requirementCategories = new Set(['function', 'interface', 'load', 'motion', 'material', 'process', 'safety']);
const sameStrings = (a: readonly string[], b: readonly string[]) => [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

function duplicateIds(items: UnknownRecord[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (!stableId(item.id)) continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

function priorRequirements(prior: Partial<Record<RefinementStage, unknown>>): Set<string> {
  const intent = record(prior.intent);
  const requirements = Array.isArray(intent?.requirements) ? intent.requirements.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  return new Set(requirements.flatMap(item => stableId(item.id) ? [item.id] : []));
}

function priorComponents(prior: Partial<Record<RefinementStage, unknown>>): UnknownRecord[] {
  const decomposition = record(prior.decomposition);
  return Array.isArray(decomposition?.components) ? decomposition.components.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
}

function validateIntent(output: unknown): string[] {
  const root = record(output);
  if (!root) return ['intent output must be an object.'];
  if (!Array.isArray(root.requirements) || root.requirements.length === 0) return ['intent.requirements must contain at least one structured requirement.'];
  const requirements = root.requirements.map(record);
  if (requirements.some(item => !item)) return ['Every intent requirement must be an object.'];
  const items = requirements as UnknownRecord[];
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    const path = `intent.requirements[${index}]`;
    if (!stableId(item.id)) errors.push(`${path}.id must be a stable identifier.`);
    for (const key of ['text', 'category', 'acceptance', 'sourceRef'] as const) if (!nonEmpty(item[key])) errors.push(`${path}.${key} is required.`);
    if (nonEmpty(item.category) && !requirementCategories.has(item.category)) errors.push(`${path}.category is not supported by ProductDecompositionPlan.`);
    if (nonEmpty(item.acceptance) && item.acceptance.trim().length < 8) errors.push(`${path}.acceptance must be an explicit verifiable condition.`);
  }
  const duplicates = duplicateIds(items);
  if (duplicates.length) errors.push(`Intent requirement ids must be unique: ${duplicates.join(', ')}.`);
  return errors;
}

function validatePartPrograms(output: unknown, prior: Partial<Record<RefinementStage, unknown>>): string[] {
  const root = record(output);
  if (!root) return ['part_programs output must be a ProductDecompositionPlan object.'];
  const intent = record(prior.intent);
  const priorRequirementItems = Array.isArray(intent?.requirements) ? intent.requirements.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const components = priorComponents(prior);
  const interfaceRoot = record(prior.interfaces);
  const interfaces = Array.isArray(interfaceRoot?.interfaces) ? interfaceRoot.interfaces.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  if (!priorRequirementItems.length || !components.length) return ['Validated intent and decomposition checkpoint inventories are required before part programs.'];

  const finalRequirements = Array.isArray(root.requirements) ? root.requirements.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const definitions = Array.isArray(root.definitions) ? root.definitions.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const instances = Array.isArray(root.instances) ? root.instances.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const mates = Array.isArray(root.mates) ? root.mates.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const networks = Array.isArray(root.physicalNetworks) ? root.physicalNetworks.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const errors: string[] = [];

  const finalRequirementById = new Map(finalRequirements.flatMap(item => stableId(item.id) ? [[item.id, item] as const] : []));
  const priorRequirementIds = new Set(priorRequirementItems.flatMap(item => stableId(item.id) ? [item.id] : []));
  for (const requirement of priorRequirementItems) {
    if (!stableId(requirement.id)) continue;
    const final = finalRequirementById.get(requirement.id);
    if (!final) { errors.push(`Accepted requirement ${requirement.id} was removed from part programs.`); continue; }
    for (const key of ['text', 'category', 'acceptance', 'sourceRef'] as const) {
      if (final[key] !== requirement[key]) errors.push(`Accepted requirement ${requirement.id}.${key} changed during part programming.`);
    }
  }
  const extraRequirements = [...finalRequirementById.keys()].filter(id => !priorRequirementIds.has(id));
  if (extraRequirements.length) errors.push(`Part programs introduced requirements outside the accepted intent checkpoint: ${extraRequirements.join(', ')}.`);

  const definitionById = new Map(definitions.flatMap(item => stableId(item.id) ? [[item.id, item] as const] : []));
  const priorComponentIds = new Set(components.flatMap(item => stableId(item.id) ? [item.id] : []));
  const instanceCountByDefinition = new Map<string, number>();
  for (const instance of instances) if (stableId(instance.definitionId)) instanceCountByDefinition.set(instance.definitionId, (instanceCountByDefinition.get(instance.definitionId) ?? 0) + 1);
  for (const component of components) {
    if (!stableId(component.id)) continue;
    const definition = definitionById.get(component.id);
    if (!definition) { errors.push(`Accepted component ${component.id} was merged, removed, or renamed in part programs.`); continue; }
    for (const key of ['name', 'responsibility'] as const) if (definition[key] !== component[key]) errors.push(`Accepted component ${component.id}.${key} changed during part programming.`);
    const expectedRequirements = stringArray(component.requirementIds) ?? [];
    const actualRequirements = stringArray(definition.requirementIds) ?? [];
    if (!sameStrings(expectedRequirements, actualRequirements)) errors.push(`Accepted component ${component.id} requirement allocation changed during part programming.`);
    const expectedQuantity = component.quantity === undefined ? 1 : component.quantity;
    if (instanceCountByDefinition.get(component.id) !== expectedQuantity) errors.push(`Accepted component ${component.id} quantity changed; expected ${expectedQuantity}, received ${instanceCountByDefinition.get(component.id) ?? 0}.`);
  }
  const extraDefinitions = [...definitionById.keys()].filter(id => !priorComponentIds.has(id));
  if (extraDefinitions.length) errors.push(`Part programs introduced components outside the accepted decomposition checkpoint: ${extraDefinitions.join(', ')}.`);

  const definitionByInstance = new Map(instances.flatMap(item => stableId(item.id) && stableId(item.definitionId) ? [[item.id, item.definitionId] as const] : []));
  const matePairs = mates.flatMap(mate => {
    if (mate.suppressed === true) return [];
    const a = record(mate.a), b = record(mate.b);
    const definitionA = stableId(a?.partId) ? definitionByInstance.get(a.partId) : undefined;
    const definitionB = stableId(b?.partId) ? definitionByInstance.get(b.partId) : undefined;
    return definitionA && definitionB ? [[definitionA, definitionB] as const] : [];
  });
  const physicalDefinitionSets = networks.map(network => new Set(
    (Array.isArray(network.ports) ? network.ports : []).map(record).flatMap(port => {
      const owner = stableId(port?.ownerObjectId) ? port.ownerObjectId : null;
      const definition = owner ? definitionByInstance.get(owner) : undefined;
      return definition ? [definition] : [];
    }),
  ));
  for (const item of interfaces) {
    const between = stringArray(item.between);
    if (!stableId(item.id) || !between || between.length !== 2) continue;
    const [a, b] = between;
    const mateBacked = matePairs.some(([left, right]) => (left === a && right === b) || (left === b && right === a));
    const routeBacked = physicalDefinitionSets.some(definitionsInNetwork => definitionsInNetwork.has(a) && definitionsInNetwork.has(b));
    if (!mateBacked && !routeBacked) errors.push(`Accepted interface ${item.id} between ${a} and ${b} has no mate or shared typed physical network in part programs.`);
  }
  return errors;
}

function validateDecomposition(output: unknown, prior: Partial<Record<RefinementStage, unknown>>): string[] {
  const root = record(output);
  if (!root) return ['decomposition output must be an object.'];
  if (!Array.isArray(root.components) || root.components.length === 0) return ['decomposition.components must contain at least one structured component.'];
  const mapped = root.components.map(record);
  if (mapped.some(item => !item)) return ['Every decomposition component must be an object.'];
  const items = mapped as UnknownRecord[];
  const knownRequirements = priorRequirements(prior);
  if (!knownRequirements.size) return ['A validated intent requirement inventory is required before decomposition.'];
  const errors: string[] = [];
  const covered = new Set<string>();
  for (const [index, item] of items.entries()) {
    const path = `decomposition.components[${index}]`;
    if (!stableId(item.id)) errors.push(`${path}.id must be a stable identifier.`);
    for (const key of ['name', 'responsibility'] as const) if (!nonEmpty(item[key])) errors.push(`${path}.${key} is required.`);
    const refs = stringArray(item.requirementIds);
    if (!refs?.length) errors.push(`${path}.requirementIds must trace at least one intent requirement.`);
    else for (const ref of refs) {
      if (!knownRequirements.has(ref)) errors.push(`${path}.requirementIds contains unknown requirement '${ref}'.`);
      else covered.add(ref);
    }
    if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || (item.quantity as number) < 1)) errors.push(`${path}.quantity must be a positive integer when supplied.`);
  }
  const duplicates = duplicateIds(items);
  if (duplicates.length) errors.push(`Component ids must be unique: ${duplicates.join(', ')}.`);
  const missing = [...knownRequirements].filter(id => !covered.has(id));
  if (missing.length) errors.push(`Every intent requirement must be allocated to a component; missing: ${missing.join(', ')}.`);
  return errors;
}

function validateInterfaces(output: unknown, prior: Partial<Record<RefinementStage, unknown>>): string[] {
  const root = record(output);
  if (!root) return ['interfaces output must be an object.'];
  if (!Array.isArray(root.interfaces)) return ['interfaces.interfaces must be an array.'];
  const mapped = root.interfaces.map(record);
  if (mapped.some(item => !item)) return ['Every interface must be an object.'];
  const items = mapped as UnknownRecord[];
  const components = priorComponents(prior);
  const componentIds = new Set(components.flatMap(item => stableId(item.id) ? [item.id] : []));
  if (!componentIds.size) return ['A validated component inventory is required before interfaces.'];
  const knownRequirements = priorRequirements(prior);
  const errors: string[] = [];
  const adjacency = new Map([...componentIds].map(id => [id, new Set<string>()]));
  for (const [index, item] of items.entries()) {
    const path = `interfaces.interfaces[${index}]`;
    if (!stableId(item.id)) errors.push(`${path}.id must be a stable identifier.`);
    if (!nonEmpty(item.kind)) errors.push(`${path}.kind is required.`);
    const between = stringArray(item.between);
    if (!between || between.length !== 2 || between[0] === between[1]) errors.push(`${path}.between must contain two distinct component ids.`);
    else if (between.some(id => !componentIds.has(id))) errors.push(`${path}.between references an unknown component.`);
    else {
      adjacency.get(between[0])?.add(between[1]);
      adjacency.get(between[1])?.add(between[0]);
    }
    const refs = stringArray(item.requirementIds);
    if (!refs?.length) errors.push(`${path}.requirementIds must trace at least one intent requirement.`);
    else for (const ref of refs) if (!knownRequirements.has(ref)) errors.push(`${path}.requirementIds contains unknown requirement '${ref}'.`);
  }
  const duplicates = duplicateIds(items);
  if (duplicates.length) errors.push(`Interface ids must be unique: ${duplicates.join(', ')}.`);
  if (componentIds.size > 1 && items.length === 0) errors.push('A multi-component product must declare its interfaces.');
  if (componentIds.size > 1) {
    const start = componentIds.values().next().value as string;
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length) for (const neighbor of adjacency.get(queue.shift()!) ?? []) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
    const disconnected = [...componentIds].filter(id => !visited.has(id));
    if (disconnected.length) errors.push(`Interface graph is disconnected; unconnected components: ${disconnected.join(', ')}.`);
  }
  return errors;
}

export function validateRefinementStageOutput(
  stage: RefinementStage,
  output: unknown,
  priorOutputs: Partial<Record<RefinementStage, unknown>>,
): RefinementStageValidation {
  const errors = stage === 'intent'
    ? validateIntent(output)
    : stage === 'decomposition'
      ? validateDecomposition(output, priorOutputs)
      : stage === 'interfaces'
        ? validateInterfaces(output, priorOutputs)
        : validatePartPrograms(output, priorOutputs);
  return { passed: errors.length === 0, errors };
}

export function refinementStageOutputInstruction(stage: RefinementStage): string {
  if (stage === 'intent') return 'output must be {requirements:[{id,text,category,acceptance,sourceRef}]}; every requirement needs a stable unique id and verifiable acceptance condition.';
  if (stage === 'decomposition') return 'output must be {components:[{id,name,responsibility,quantity?,requirementIds:[]}]}; allocate every prior requirement without merging distinct components.';
  if (stage === 'interfaces') return 'output must be {interfaces:[{id,between:[componentIdA,componentIdB],kind,requirementIds:[]}]}; the component graph must be connected and all references must resolve.';
  return 'output must be a complete ProductDecompositionPlan v1 in mm with requirements, definitions, instances, mates, subassemblies, physicalNetworks, observations, assumptions, and unresolved. Preserve every accepted requirement and component id, responsibility, allocation, quantity, and interface exactly; do not merge, rename, drop, or add inventory at this stage. Use physicalNetworks=[] only when the request has no fluid, air, power, data, sensor, cable, wiring, or drain path; PT100/RTD and service-path products require typed ports and measured route geometry.';
}
