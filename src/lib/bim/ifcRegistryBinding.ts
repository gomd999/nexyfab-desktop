import {
  validateBimInformationInstance,
  type BimInformationInstance,
  type BimInformationRegistry,
  type BimPropertyDefinition,
  type BimValidationReport,
} from './informationRegistry';
import { snapshotIfcDeepSemantics, verifyIfcDeepSemanticRoundtrip, type IfcDeepSemanticRoundtripReport } from './ifcDeepSemanticRoundtrip';

export type IfcRegistryBindingIssueCode =
  | 'BIM_INSTANCE_INVALID'
  | 'IFC_OCCURRENCE_MISSING'
  | 'IFC_PROPERTY_MISSING'
  | 'IFC_PROPERTY_AMBIGUOUS'
  | 'IFC_PROPERTY_VALUE_MISMATCH'
  | 'IFC_PROPERTY_UNIT_MISMATCH'
  | 'IFC_CLASSIFICATION_MISSING';

export interface IfcRegistryBindingIssue {
  code: IfcRegistryBindingIssueCode;
  path: string;
  message: string;
}

export interface IfcRegistryBindingReport {
  passed: boolean;
  occurrenceGlobalId: string;
  registryId: string;
  registryVersion: string;
  instanceValidation: BimValidationReport;
  issues: IfcRegistryBindingIssue[];
}

export interface IfcRegistryBoundRoundtripReport {
  passed: boolean;
  semanticRoundtrip: IfcDeepSemanticRoundtripReport;
  beforeBinding: IfcRegistryBindingReport;
  afterBinding: IfcRegistryBindingReport;
}

function unwrapIfcValue(value: string): unknown {
  let candidate = value.trim();
  const typed = candidate.match(/^[A-Z][A-Z0-9_]*\(([\s\S]*)\)$/);
  if (typed?.[1] !== undefined) candidate = typed[1].trim();
  if (/^"[\s\S]*"$/.test(candidate)) {
    try { return JSON.parse(candidate); } catch { return candidate; }
  }
  if (candidate === '.T.' || candidate === '.TRUE.') return true;
  if (candidate === '.F.' || candidate === '.FALSE.') return false;
  const number = Number(candidate);
  return candidate !== '' && Number.isFinite(number) ? number : candidate;
}

function ifcUnitCode(signature: string | null): string | null {
  if (signature === null) return 'none';
  const upper = signature.toUpperCase();
  if (upper.includes('.LENGTHUNIT.') && upper.includes('.METRE.')) return upper.includes('.MILLI.') ? 'mm' : 'm';
  if (upper.includes('SQUARE MILLIMETRE')) return 'mm2';
  if (upper.includes('CUBIC MILLIMETRE')) return 'mm3';
  if (upper.includes('.AREAUNIT.') && upper.includes('.SQUARE_METRE.')) return upper.includes('.MILLI.') ? 'mm2' : 'm2';
  if (upper.includes('.VOLUMEUNIT.') && upper.includes('.CUBIC_METRE.')) return upper.includes('.MILLI.') ? 'mm3' : 'm3';
  if (upper.includes('.MASSUNIT.') && upper.includes('.GRAM.')) return upper.includes('.KILO.') ? 'kg' : 'g';
  if (upper.includes('.COUNTUNIT.')) return 'count';
  return null;
}

function equalValue(expected: unknown, actual: unknown, definition: BimPropertyDefinition): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tolerance = definition.formula?.tolerance ?? Math.max(1e-9, Math.abs(expected) * 1e-12);
    return Number.isFinite(actual) && Math.abs(expected - actual) <= tolerance;
  }
  return Object.is(expected, actual);
}

export function validateIfcRegistryBinding(
  registry: BimInformationRegistry,
  instance: BimInformationInstance,
  ifcSource: string,
  occurrenceGlobalId: string,
): IfcRegistryBindingReport {
  const instanceValidation = validateBimInformationInstance(registry, instance);
  const issues: IfcRegistryBindingIssue[] = [];
  if (instanceValidation.status === 'invalid') {
    issues.push({ code: 'BIM_INSTANCE_INVALID', path: 'instance', message: `${instanceValidation.issues.length} BIM registry validation issue(s).` });
    return { passed: false, occurrenceGlobalId, registryId: registry.registryId, registryVersion: registry.version, instanceValidation, issues };
  }
  const snapshot = snapshotIfcDeepSemantics(ifcSource);
  if (!snapshot.occurrences.some(occurrence => occurrence.globalId === occurrenceGlobalId)) {
    issues.push({ code: 'IFC_OCCURRENCE_MISSING', path: 'occurrenceGlobalId', message: `IFC occurrence ${occurrenceGlobalId} is missing.` });
  }
  const definitions = new Map(registry.properties.map(definition => [`${definition.pset}.${definition.key}`, definition]));
  for (const property of instance.properties) {
    const id = `${property.pset}.${property.key}`;
    const definition = definitions.get(id)!;
    const psets = snapshot.propertySets.filter(pset => pset.occurrenceGlobalId === occurrenceGlobalId && pset.name === property.pset);
    const matches = psets.flatMap(pset => pset.values.filter(value => value.name === property.key));
    if (matches.length === 0) {
      issues.push({ code: 'IFC_PROPERTY_MISSING', path: `properties.${id}`, message: `IFC property ${id} is missing on ${occurrenceGlobalId}.` });
      continue;
    }
    if (matches.length > 1) {
      issues.push({ code: 'IFC_PROPERTY_AMBIGUOUS', path: `properties.${id}`, message: `IFC property ${id} occurs ${matches.length} times.` });
      continue;
    }
    const match = matches[0]!;
    if (!equalValue(property.value, unwrapIfcValue(match.value), definition)) {
      issues.push({ code: 'IFC_PROPERTY_VALUE_MISMATCH', path: `properties.${id}.value`, message: `IFC value does not match registry instance value for ${id}.` });
    }
    const actualUnit = ifcUnitCode(match.unit);
    if (actualUnit !== definition.unit) {
      issues.push({ code: 'IFC_PROPERTY_UNIT_MISMATCH', path: `properties.${id}.unit`, message: `IFC unit ${actualUnit ?? '(unsupported)'} does not match ${definition.unit}.` });
    }
  }
  for (const classification of instance.classifications) {
    const found = snapshot.classifications.some(value => value.occurrenceGlobalId === occurrenceGlobalId && value.scheme === classification.scheme && value.code === classification.code);
    if (!found) issues.push({ code: 'IFC_CLASSIFICATION_MISSING', path: `classifications.${classification.scheme}:${classification.code}`, message: `IFC classification is missing on ${occurrenceGlobalId}.` });
  }
  return { passed: issues.length === 0, occurrenceGlobalId, registryId: registry.registryId, registryVersion: registry.version, instanceValidation, issues };
}

export function verifyIfcRegistryBoundRoundtrip(
  registry: BimInformationRegistry,
  instance: BimInformationInstance,
  beforeIfc: string,
  afterIfc: string,
  occurrenceGlobalId: string,
): IfcRegistryBoundRoundtripReport {
  const semanticRoundtrip = verifyIfcDeepSemanticRoundtrip(beforeIfc, afterIfc);
  const beforeBinding = validateIfcRegistryBinding(registry, instance, beforeIfc, occurrenceGlobalId);
  const afterBinding = validateIfcRegistryBinding(registry, instance, afterIfc, occurrenceGlobalId);
  return { passed: semanticRoundtrip.passed && beforeBinding.passed && afterBinding.passed, semanticRoundtrip, beforeBinding, afterBinding };
}
