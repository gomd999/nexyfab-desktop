import {
  evaluateAllVariables,
  evaluateExpression,
  extractDependencies,
  parseExpression,
  type ParametricVariable,
} from '@/lib/sketch/sketchExpressions';

export const BIM_REGISTRY_SCHEMA = 'nexyfab.bim-information-registry.v1' as const;

export type BimStage = 'common' | 'design' | 'construction' | 'maintenance';
export type BimValueType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'object' | 'array';
export type BimClassificationScheme = 'WBS' | 'OBS';
export type BimValueSource = 'user' | 'ai' | 'imported' | 'derived';

export interface BimSourceReference {
  id: string;
  path: string;
  revision: string;
  sheet?: string;
  access: 'read_only';
}

export interface BimUnitDefinition {
  code: string;
  symbol: string;
  dimension: 'none' | 'length' | 'area' | 'volume' | 'mass' | 'count' | 'time' | 'ratio' | 'custom';
}

export interface BimClassificationEntry {
  scheme: BimClassificationScheme;
  code: string;
  name: string;
  level: number;
  parentCode?: string;
  sourceRef: string;
}

export interface BimFormulaDefinition {
  /** Safe arithmetic expression. Excel cell references and functions are intentionally unsupported. */
  expression: string;
  /** Explicit allow-list. It must exactly match the identifiers referenced by expression. */
  variables: string[];
  tolerance?: number;
}

export interface BimPropertyDefinition {
  pset: string;
  key: string;
  name: string;
  type: Exclude<BimValueType, 'object' | 'array'>;
  unit: string;
  requiredAt: BimStage[];
  formula?: BimFormulaDefinition;
  description?: string;
  sourceRef: string;
}

export interface BepRequirementDefinition {
  key: string;
  type: BimValueType;
  requiredAt: BimStage[];
  sourceRef: string;
}

export interface BimInformationRegistry {
  schema: typeof BIM_REGISTRY_SCHEMA;
  registryId: string;
  version: string;
  sourceReferences: BimSourceReference[];
  units: BimUnitDefinition[];
  classifications: BimClassificationEntry[];
  properties: BimPropertyDefinition[];
  bepRequirements: BepRequirementDefinition[];
}

export interface BimPropertyValue {
  pset: string;
  key: string;
  value: unknown;
  unit: string;
  source: BimValueSource;
  sourceRef: string;
}

export interface BimInformationInstance {
  registryId: string;
  registryVersion: string;
  stage: BimStage;
  classifications: Array<{ scheme: BimClassificationScheme; code: string }>;
  properties: BimPropertyValue[];
  bep: Record<string, unknown>;
}

export type BimValidationIssueCode =
  | 'SCHEMA_MISMATCH'
  | 'REGISTRY_ID_INVALID'
  | 'REGISTRY_VERSION_INVALID'
  | 'SOURCE_REFERENCE_INVALID'
  | 'SOURCE_REFERENCE_UNKNOWN'
  | 'UNIT_DUPLICATE'
  | 'UNIT_UNKNOWN'
  | 'CLASSIFICATION_DUPLICATE'
  | 'CLASSIFICATION_PARENT_INVALID'
  | 'CLASSIFICATION_UNKNOWN'
  | 'PROPERTY_DUPLICATE'
  | 'PROPERTY_KEY_INVALID'
  | 'PROPERTY_UNKNOWN'
  | 'PROPERTY_REQUIRED'
  | 'PROPERTY_TYPE_INVALID'
  | 'PROPERTY_UNIT_INVALID'
  | 'PROPERTY_PROVENANCE_INVALID'
  | 'FORMULA_EXCEL_ERROR'
  | 'FORMULA_INVALID'
  | 'FORMULA_VARIABLE_MISMATCH'
  | 'FORMULA_DEPENDENCY_UNKNOWN'
  | 'FORMULA_CYCLE'
  | 'FORMULA_RESULT_INVALID'
  | 'FORMULA_RESULT_MISMATCH'
  | 'BEP_REQUIREMENT_DUPLICATE'
  | 'BEP_REQUIREMENT_UNKNOWN'
  | 'BEP_REQUIRED'
  | 'BEP_TYPE_INVALID';

export interface BimValidationIssue {
  code: BimValidationIssueCode;
  path: string;
  message: string;
  sourceRef?: string;
}

export interface BimValidationReport {
  status: 'valid' | 'invalid';
  issues: BimValidationIssue[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXCEL_ERROR = /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/i;
const NUMERIC_TYPES = new Set<BimValueType>(['number', 'integer']);

function issue(
  issues: BimValidationIssue[],
  code: BimValidationIssueCode,
  path: string,
  message: string,
  sourceRef?: string,
): void {
  issues.push({ code, path, message, ...(sourceRef ? { sourceRef } : {}) });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedUnique(left);
  const b = sortedUnique(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasValueType(value: unknown, type: BimValueType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(Date.parse(value));
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
  }
}

function propertyId(property: Pick<BimPropertyDefinition, 'pset' | 'key'>): string {
  return `${property.pset}.${property.key}`;
}

function classificationId(entry: Pick<BimClassificationEntry, 'scheme' | 'code'>): string {
  return `${entry.scheme}:${entry.code}`;
}

function validateFormulaDefinitions(registry: BimInformationRegistry, issues: BimValidationIssue[]): void {
  const propertiesByPset = new Map<string, Map<string, BimPropertyDefinition>>();
  for (const property of registry.properties) {
    const pset = propertiesByPset.get(property.pset) ?? new Map<string, BimPropertyDefinition>();
    pset.set(property.key, property);
    propertiesByPset.set(property.pset, pset);
  }

  for (const [index, property] of registry.properties.entries()) {
    if (!property.formula) continue;
    const path = `properties[${index}].formula`;
    if (EXCEL_ERROR.test(property.formula.expression)) {
      issue(issues, 'FORMULA_EXCEL_ERROR', path, 'Excel error tokens cannot be registered as executable formulas.', property.sourceRef);
      continue;
    }
    if (!NUMERIC_TYPES.has(property.type)) {
      issue(issues, 'FORMULA_INVALID', path, 'Only number and integer properties may have executable formulas.', property.sourceRef);
      continue;
    }
    try {
      const ast = parseExpression(property.formula.expression);
      const dependencies = extractDependencies(ast);
      if (!sameStringSet(dependencies, property.formula.variables)) {
        issue(issues, 'FORMULA_VARIABLE_MISMATCH', `${path}.variables`, 'Declared variables must exactly match expression identifiers.', property.sourceRef);
      }
      const pset = propertiesByPset.get(property.pset);
      for (const dependency of dependencies) {
        if (dependency === property.key || !pset?.has(dependency)) {
          issue(issues, 'FORMULA_DEPENDENCY_UNKNOWN', path, `Formula dependency ${dependency} is missing or self-referential in ${property.pset}.`, property.sourceRef);
        } else if (!NUMERIC_TYPES.has(pset.get(dependency)!.type)) {
          issue(issues, 'FORMULA_DEPENDENCY_UNKNOWN', path, `Formula dependency ${dependency} is not numeric.`, property.sourceRef);
        }
      }
    } catch (error) {
      issue(issues, 'FORMULA_INVALID', path, error instanceof Error ? error.message : String(error), property.sourceRef);
    }
  }

  for (const [psetName, definitions] of propertiesByPset) {
    const variables: Record<string, ParametricVariable> = {};
    for (const definition of definitions.values()) {
      if (!NUMERIC_TYPES.has(definition.type)) continue;
      variables[definition.key] = {
        id: definition.key,
        value: 1,
        ...(definition.formula ? { expression: definition.formula.expression } : {}),
      };
    }
    for (const result of evaluateAllVariables({ variables })) {
      if (!result.ok && /cycl|circular/i.test(result.error ?? '')) {
        issue(issues, 'FORMULA_CYCLE', `properties.${psetName}.${result.variableId}`, result.error ?? 'Formula dependency cycle.');
      }
    }
  }
}

export function validateBimInformationRegistry(registry: BimInformationRegistry): BimValidationReport {
  const issues: BimValidationIssue[] = [];
  if (registry.schema !== BIM_REGISTRY_SCHEMA) issue(issues, 'SCHEMA_MISMATCH', 'schema', `Expected ${BIM_REGISTRY_SCHEMA}.`);
  if (!registry.registryId.trim()) issue(issues, 'REGISTRY_ID_INVALID', 'registryId', 'Registry ID is required.');
  if (!registry.version.trim()) issue(issues, 'REGISTRY_VERSION_INVALID', 'version', 'Registry version is required.');

  const sourceIds = new Set<string>();
  for (const [index, source] of registry.sourceReferences.entries()) {
    const path = `sourceReferences[${index}]`;
    if (!source.id.trim() || !source.path.trim() || !source.revision.trim() || source.access !== 'read_only' || sourceIds.has(source.id)) {
      issue(issues, 'SOURCE_REFERENCE_INVALID', path, 'Source reference needs a unique ID, path, revision, and read_only access.');
    }
    sourceIds.add(source.id);
  }

  const unitCodes = new Set<string>();
  for (const [index, unit] of registry.units.entries()) {
    if (!unit.code.trim() || unitCodes.has(unit.code)) issue(issues, 'UNIT_DUPLICATE', `units[${index}].code`, `Unit code ${unit.code || '(empty)'} is empty or duplicated.`);
    unitCodes.add(unit.code);
  }
  if (!unitCodes.has('none')) issue(issues, 'UNIT_UNKNOWN', 'units', 'The canonical none unit must be registered.');

  const classifications = new Map<string, BimClassificationEntry>();
  for (const [index, entry] of registry.classifications.entries()) {
    const id = classificationId(entry);
    if (!entry.code.trim() || !entry.name.trim() || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 7 || classifications.has(id)) {
      issue(issues, 'CLASSIFICATION_DUPLICATE', `classifications[${index}]`, `Classification ${id} is malformed or duplicated.`, entry.sourceRef);
    }
    if (!sourceIds.has(entry.sourceRef)) issue(issues, 'SOURCE_REFERENCE_UNKNOWN', `classifications[${index}].sourceRef`, `Unknown source ${entry.sourceRef}.`);
    classifications.set(id, entry);
  }
  for (const [index, entry] of registry.classifications.entries()) {
    if (!entry.parentCode) continue;
    const parent = classifications.get(`${entry.scheme}:${entry.parentCode}`);
    if (!parent || parent.level >= entry.level) {
      issue(issues, 'CLASSIFICATION_PARENT_INVALID', `classifications[${index}].parentCode`, `Parent ${entry.parentCode} must exist in ${entry.scheme} at a lower level.`, entry.sourceRef);
    }
  }

  const propertyIds = new Set<string>();
  for (const [index, property] of registry.properties.entries()) {
    const id = propertyId(property);
    if (!property.pset.trim() || !IDENTIFIER.test(property.key)) issue(issues, 'PROPERTY_KEY_INVALID', `properties[${index}]`, `Property ${id} needs a Pset and an expression-safe key.`, property.sourceRef);
    if (propertyIds.has(id)) issue(issues, 'PROPERTY_DUPLICATE', `properties[${index}]`, `Property ${id} is duplicated.`, property.sourceRef);
    if (!unitCodes.has(property.unit)) issue(issues, 'UNIT_UNKNOWN', `properties[${index}].unit`, `Unit ${property.unit} is not registered.`, property.sourceRef);
    if (!sourceIds.has(property.sourceRef)) issue(issues, 'SOURCE_REFERENCE_UNKNOWN', `properties[${index}].sourceRef`, `Unknown source ${property.sourceRef}.`);
    propertyIds.add(id);
  }

  const bepKeys = new Set<string>();
  for (const [index, requirement] of registry.bepRequirements.entries()) {
    if (!IDENTIFIER.test(requirement.key) || bepKeys.has(requirement.key)) issue(issues, 'BEP_REQUIREMENT_DUPLICATE', `bepRequirements[${index}].key`, `BEP key ${requirement.key} is invalid or duplicated.`, requirement.sourceRef);
    if (!sourceIds.has(requirement.sourceRef)) issue(issues, 'SOURCE_REFERENCE_UNKNOWN', `bepRequirements[${index}].sourceRef`, `Unknown source ${requirement.sourceRef}.`);
    bepKeys.add(requirement.key);
  }

  validateFormulaDefinitions(registry, issues);
  return { status: issues.length === 0 ? 'valid' : 'invalid', issues };
}

function evaluateInstanceFormula(
  definition: BimPropertyDefinition,
  values: Map<string, BimPropertyValue>,
): { ok: true; value: number } | { ok: false; error: string } {
  try {
    const variables: Record<string, ParametricVariable> = {};
    for (const dependency of definition.formula!.variables) {
      const candidate = values.get(dependency)?.value;
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return { ok: false, error: `Missing finite numeric dependency ${dependency}.` };
      variables[dependency] = { id: dependency, value: candidate };
    }
    const value = evaluateExpression(parseExpression(definition.formula!.expression), { variables });
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'Formula result is not finite.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function validateBimInformationInstance(
  registry: BimInformationRegistry,
  instance: BimInformationInstance,
): BimValidationReport {
  const registryReport = validateBimInformationRegistry(registry);
  if (registryReport.status === 'invalid') return registryReport;
  const issues: BimValidationIssue[] = [];
  if (instance.registryId !== registry.registryId) issue(issues, 'REGISTRY_ID_INVALID', 'registryId', `Expected ${registry.registryId}.`);
  if (instance.registryVersion !== registry.version) issue(issues, 'REGISTRY_VERSION_INVALID', 'registryVersion', `Expected exact registry version ${registry.version}.`);

  const knownClassifications = new Set(registry.classifications.map(classificationId));
  const seenClassifications = new Set<string>();
  for (const [index, classification] of instance.classifications.entries()) {
    const id = classificationId(classification);
    if (!knownClassifications.has(id)) issue(issues, 'CLASSIFICATION_UNKNOWN', `classifications[${index}]`, `Classification ${id} is not in registry ${registry.version}.`);
    if (seenClassifications.has(id)) issue(issues, 'CLASSIFICATION_DUPLICATE', `classifications[${index}]`, `Classification ${id} is duplicated.`);
    seenClassifications.add(id);
  }

  const definitions = new Map(registry.properties.map(property => [propertyId(property), property]));
  const valuesByPset = new Map<string, Map<string, BimPropertyValue>>();
  const seenProperties = new Set<string>();
  for (const [index, property] of instance.properties.entries()) {
    const id = propertyId(property);
    const definition = definitions.get(id);
    if (!definition) {
      issue(issues, 'PROPERTY_UNKNOWN', `properties[${index}]`, `Property ${id} is not in registry ${registry.version}.`, property.sourceRef);
      continue;
    }
    if (seenProperties.has(id)) issue(issues, 'PROPERTY_DUPLICATE', `properties[${index}]`, `Property ${id} is duplicated.`, property.sourceRef);
    if (!hasValueType(property.value, definition.type)) issue(issues, 'PROPERTY_TYPE_INVALID', `properties[${index}].value`, `Property ${id} must be ${definition.type}.`, property.sourceRef);
    if (property.unit !== definition.unit) issue(issues, 'PROPERTY_UNIT_INVALID', `properties[${index}].unit`, `Property ${id} requires unit ${definition.unit}.`, property.sourceRef);
    if (!property.sourceRef.trim()) issue(issues, 'PROPERTY_PROVENANCE_INVALID', `properties[${index}].sourceRef`, `Property ${id} requires provenance.`);
    const pset = valuesByPset.get(property.pset) ?? new Map<string, BimPropertyValue>();
    pset.set(property.key, property);
    valuesByPset.set(property.pset, pset);
    seenProperties.add(id);
  }

  for (const definition of registry.properties) {
    const id = propertyId(definition);
    const value = valuesByPset.get(definition.pset)?.get(definition.key);
    if (definition.requiredAt.includes(instance.stage) && !value) {
      issue(issues, 'PROPERTY_REQUIRED', `properties.${id}`, `Required ${instance.stage} property ${id} is missing.`, definition.sourceRef);
      continue;
    }
    if (!definition.formula || !value) continue;
    if (value.source !== 'derived') issue(issues, 'PROPERTY_PROVENANCE_INVALID', `properties.${id}.source`, `Formula property ${id} must use derived provenance.`, value.sourceRef);
    const calculated = evaluateInstanceFormula(definition, valuesByPset.get(definition.pset) ?? new Map());
    if (!calculated.ok) {
      issue(issues, 'FORMULA_RESULT_INVALID', `properties.${id}`, calculated.error, value.sourceRef);
      continue;
    }
    if (typeof value.value !== 'number' || Math.abs(value.value - calculated.value) > (definition.formula.tolerance ?? 1e-9)) {
      issue(issues, 'FORMULA_RESULT_MISMATCH', `properties.${id}.value`, `Expected ${calculated.value} from ${definition.formula.expression}.`, value.sourceRef);
    }
  }

  const knownBep = new Map(registry.bepRequirements.map(requirement => [requirement.key, requirement]));
  for (const requirement of registry.bepRequirements) {
    const value = instance.bep[requirement.key];
    if (requirement.requiredAt.includes(instance.stage) && value === undefined) issue(issues, 'BEP_REQUIRED', `bep.${requirement.key}`, `Required ${instance.stage} BEP value is missing.`, requirement.sourceRef);
    else if (value !== undefined && !hasValueType(value, requirement.type)) issue(issues, 'BEP_TYPE_INVALID', `bep.${requirement.key}`, `BEP value must be ${requirement.type}.`, requirement.sourceRef);
  }
  for (const key of Object.keys(instance.bep)) {
    if (!knownBep.has(key)) issue(issues, 'BEP_REQUIREMENT_UNKNOWN', `bep.${key}`, `BEP key ${key} is not in registry ${registry.version}.`);
  }

  return { status: issues.length === 0 ? 'valid' : 'invalid', issues };
}
