export interface StepProductIdentity {
  partNumber: string;
  name: string;
  description: string;
}

export interface StepOccurrenceIdentity {
  id: string;
  name: string;
  description: string;
  product: StepProductIdentity;
}

export interface StepSemanticIdentity {
  schema: 'nexyfab.step-semantic-identity.v1';
  treeSignature: string;
  root: StepProductIdentity;
  occurrences: StepOccurrenceIdentity[];
}

interface StepEntity {
  id: string;
  type: string;
  args: string[];
  start: number;
  end: number;
}

interface StepGraphOccurrence {
  entity: StepEntity;
  childDefinitionId: string;
  children: StepGraphOccurrence[];
}

interface StepGraph {
  entities: StepEntity[];
  products: Map<string, StepEntity>;
  productByDefinition: Map<string, StepEntity>;
  rootDefinitionId: string;
  rootProduct: StepEntity;
  occurrences: StepGraphOccurrence[];
  treeSignature: string;
}

export class StepSemanticIdentityError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'StepSemanticIdentityError';
  }
}

function parseEntities(stepText: string): StepEntity[] {
  const entities: StepEntity[] = [];
  const searchable = maskStepComments(stepText);
  const startPattern = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(searchable)) !== null) {
    let cursor = startPattern.lastIndex;
    let depth = 1;
    let quoted = false;
    while (cursor < searchable.length && depth > 0) {
      const character = searchable[cursor];
      if (quoted) {
        if (character === "'" && searchable[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (character === "'") quoted = false;
      } else if (character === "'") {
        quoted = true;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      cursor += 1;
    }
    if (depth !== 0) break;
    let end = cursor;
    while (end < searchable.length && /\s/.test(searchable[end] ?? '')) end += 1;
    if (searchable[end] !== ';') continue;
    const argsText = stepText.slice(startPattern.lastIndex, cursor - 1);
    entities.push({
      id: match[1],
      type: match[2],
      args: splitTopLevelArgs(argsText),
      start: match.index,
      end: end + 1,
    });
    startPattern.lastIndex = end + 1;
  }
  return entities;
}

function maskStepComments(stepText: string): string {
  const masked = [...stepText];
  let quoted = false;
  for (let index = 0; index < stepText.length; index += 1) {
    const character = stepText[index];
    if (quoted) {
      if (character === "'" && stepText[index + 1] === "'") index += 1;
      else if (character === "'") quoted = false;
      continue;
    }
    if (character === "'") {
      quoted = true;
      continue;
    }
    if (character !== '/' || stepText[index + 1] !== '*') continue;
    masked[index] = ' ';
    masked[index + 1] = ' ';
    index += 2;
    while (index < stepText.length) {
      if (stepText[index] === '*' && stepText[index + 1] === '/') {
        masked[index] = ' ';
        masked[index + 1] = ' ';
        index += 1;
        break;
      }
      if (stepText[index] !== '\n' && stepText[index] !== '\r') masked[index] = ' ';
      index += 1;
    }
  }
  return masked.join('');
}

export function stepContainsSemanticIdentity(stepText: string): boolean {
  return /\bPRODUCT\s*\(/.test(maskStepComments(stepText));
}

function splitTopLevelArgs(value: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quoted = false;
      }
      continue;
    }
    if (character === "'") quoted = true;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
}

function referenceId(value: string | undefined): string | null {
  const match = /^#(\d+)$/.exec(value?.trim() ?? '');
  return match?.[1] ?? null;
}

function parseStepString(value: string | undefined): string | null {
  const token = value?.trim() ?? '';
  if (token.length < 2 || token[0] !== "'" || token.at(-1) !== "'") return null;
  let result = '';
  for (let index = 1; index < token.length - 1; index += 1) {
    const character = token[index];
    if (character === "'" && token[index + 1] === "'") {
      result += "'";
      index += 1;
    } else if (character === "'") {
      return null;
    } else {
      result += character;
    }
  }
  return result;
}

function stepString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function productIdentity(entity: StepEntity): StepProductIdentity | null {
  const partNumber = parseStepString(entity.args[0]);
  const name = parseStepString(entity.args[1]);
  const description = parseStepString(entity.args[2]);
  return partNumber === null || name === null || description === null
    ? null
    : { partNumber, name, description };
}

function occurrenceIdentity(
  occurrence: StepGraphOccurrence,
  productByDefinition: Map<string, StepEntity>,
): StepOccurrenceIdentity | null {
  const id = parseStepString(occurrence.entity.args[0]);
  const name = parseStepString(occurrence.entity.args[1]);
  const description = parseStepString(occurrence.entity.args[2]);
  const product = productIdentity(productByDefinition.get(occurrence.childDefinitionId)!);
  return id === null || name === null || description === null || product === null
    ? null
    : { id, name, description, product };
}

function buildStepGraph(stepText: string): StepGraph | null {
  const entities = parseEntities(stepText);
  const products = new Map(entities.filter(entity => entity.type === 'PRODUCT').map(entity => [entity.id, entity]));
  const formations = new Map<string, string>();
  const definitions = new Map<string, string>();
  for (const entity of entities) {
    if (entity.type.startsWith('PRODUCT_DEFINITION_FORMATION')) {
      const productId = referenceId(entity.args[2]);
      if (productId) formations.set(entity.id, productId);
    } else if (entity.type === 'PRODUCT_DEFINITION') {
      const formationId = referenceId(entity.args[2]);
      if (formationId) definitions.set(entity.id, formationId);
    }
  }
  const productByDefinition = new Map<string, StepEntity>();
  for (const [definitionId, formationId] of definitions) {
    const productId = formations.get(formationId);
    const product = productId ? products.get(productId) : null;
    if (product) productByDefinition.set(definitionId, product);
  }
  const rawOccurrences = entities
    .filter(entity => entity.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE')
    .map(entity => ({
      entity,
      parentDefinitionId: referenceId(entity.args[3]),
      childDefinitionId: referenceId(entity.args[4]),
    }));
  if (rawOccurrences.some(item => !item.parentDefinitionId || !item.childDefinitionId)) return null;
  if (rawOccurrences.length === 0) {
    if (productByDefinition.size !== 1) return null;
    const [[rootDefinitionId, rootProduct]] = productByDefinition;
    return {
      entities,
      products,
      productByDefinition,
      rootDefinitionId,
      rootProduct,
      occurrences: [],
      treeSignature: '()',
    };
  }
  const parentIds = new Set(rawOccurrences.map(item => item.parentDefinitionId!));
  const childIds = new Set(rawOccurrences.map(item => item.childDefinitionId!));
  const roots = [...parentIds].filter(id => !childIds.has(id));
  if (roots.length !== 1) return null;
  const rootDefinitionId = roots[0];
  const rootProduct = productByDefinition.get(rootDefinitionId);
  if (!rootProduct) return null;
  const childrenByParent = new Map<string, typeof rawOccurrences>();
  for (const item of rawOccurrences) {
    if (!productByDefinition.has(item.childDefinitionId!)) return null;
    const children = childrenByParent.get(item.parentDefinitionId!) ?? [];
    children.push(item);
    childrenByParent.set(item.parentDefinitionId!, children);
  }
  const visited = new Set<StepEntity>();
  const visit = (definitionId: string, stack: Set<string>): { nodes: StepGraphOccurrence[]; signature: string } | null => {
    if (stack.has(definitionId)) return null;
    const nextStack = new Set(stack).add(definitionId);
    const nodes: StepGraphOccurrence[] = [];
    const childSignatures: string[] = [];
    for (const item of childrenByParent.get(definitionId) ?? []) {
      if (visited.has(item.entity)) return null;
      visited.add(item.entity);
      const nested = visit(item.childDefinitionId!, nextStack);
      if (!nested) return null;
      nodes.push({ entity: item.entity, childDefinitionId: item.childDefinitionId!, children: nested.nodes });
      childSignatures.push(nested.signature);
    }
    return { nodes, signature: `(${childSignatures.join('')})` };
  };
  const traversed = visit(rootDefinitionId, new Set());
  if (!traversed || visited.size !== rawOccurrences.length) return null;
  return {
    entities,
    products,
    productByDefinition,
    rootDefinitionId,
    rootProduct,
    occurrences: traversed.nodes,
    treeSignature: traversed.signature,
  };
}

function flattenOccurrences(nodes: StepGraphOccurrence[]): StepGraphOccurrence[] {
  return nodes.flatMap(node => [node, ...flattenOccurrences(node.children)]);
}

export function captureStepSemanticIdentity(stepText: string): StepSemanticIdentity | null {
  if (!stepText.includes('ISO-10303-21')) return null;
  const graph = buildStepGraph(stepText);
  if (!graph) return null;
  const root = productIdentity(graph.rootProduct);
  if (!root) return null;
  const occurrences = flattenOccurrences(graph.occurrences)
    .map(occurrence => occurrenceIdentity(occurrence, graph.productByDefinition));
  if (occurrences.some(identity => identity === null)) return null;
  return {
    schema: 'nexyfab.step-semantic-identity.v1',
    treeSignature: graph.treeSignature,
    root,
    occurrences: occurrences as StepOccurrenceIdentity[],
  };
}

function renderEntity(entity: StepEntity, args: string[]): string {
  return `#${entity.id} = ${entity.type}(${args.join(',')});`;
}

function productArgs(entity: StepEntity, identity: StepProductIdentity): string[] {
  if (entity.args.length < 4) throw new StepSemanticIdentityError('STEP_SEMANTIC_PRODUCT_ARGS_INVALID');
  return [stepString(identity.partNumber), stepString(identity.name), stepString(identity.description), ...entity.args.slice(3)];
}

export function rebindStepSemanticIdentity(stepText: string, identity: StepSemanticIdentity): string {
  if (identity.schema !== 'nexyfab.step-semantic-identity.v1') {
    throw new StepSemanticIdentityError('STEP_SEMANTIC_IDENTITY_SCHEMA_INVALID');
  }
  const graph = buildStepGraph(stepText);
  if (!graph || graph.treeSignature !== identity.treeSignature) {
    throw new StepSemanticIdentityError('STEP_SEMANTIC_TREE_MISMATCH');
  }
  const targetOccurrences = flattenOccurrences(graph.occurrences);
  if (targetOccurrences.length !== identity.occurrences.length) {
    throw new StepSemanticIdentityError('STEP_SEMANTIC_OCCURRENCE_COUNT_MISMATCH');
  }
  const replacements = new Map<StepEntity, string>();
  replacements.set(graph.rootProduct, renderEntity(graph.rootProduct, productArgs(graph.rootProduct, identity.root)));
  targetOccurrences.forEach((target, index) => {
    const source = identity.occurrences[index];
    if (!source || target.entity.args.length < 6) {
      throw new StepSemanticIdentityError('STEP_SEMANTIC_OCCURRENCE_ARGS_INVALID');
    }
    replacements.set(target.entity, renderEntity(target.entity, [
      stepString(source.id),
      stepString(source.name),
      stepString(source.description),
      ...target.entity.args.slice(3),
    ]));
    const product = graph.productByDefinition.get(target.childDefinitionId);
    if (!product) throw new StepSemanticIdentityError('STEP_SEMANTIC_CHILD_PRODUCT_MISSING');
    replacements.set(product, renderEntity(product, productArgs(product, source.product)));
  });
  let rebound = stepText;
  const ordered = [...replacements.entries()].sort(([left], [right]) => right.start - left.start);
  for (const [entity, replacement] of ordered) {
    rebound = `${rebound.slice(0, entity.start)}${replacement}${rebound.slice(entity.end)}`;
  }
  const verified = captureStepSemanticIdentity(rebound);
  if (JSON.stringify(verified) !== JSON.stringify(identity)) {
    throw new StepSemanticIdentityError('STEP_SEMANTIC_REBIND_VERIFICATION_FAILED');
  }
  return rebound;
}
