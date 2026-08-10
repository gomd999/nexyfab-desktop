import { detectStepUnits } from '@/lib/brep-bridge/stepRead';
import {
  analyzeStepAssemblyPlacements,
  analyzeStepAssemblyStructure,
} from './stepAssemblyEvidence';

export interface XcafExpectedDefinition {
  id: string;
  name: string;
  color?: string;
}

export interface XcafExpectedOccurrence {
  id: string;
  definitionId: string;
  matrix: readonly number[];
}

export interface XcafAssemblyRoundtripCheck {
  id: string;
  pass: boolean;
  expected: unknown;
  measured: unknown;
}

export interface XcafAssemblyRoundtripEvidence {
  schema: 'nexyfab.xcaf-assembly-roundtrip-evidence.v1';
  status: 'pass' | 'fail';
  generatorPath: 'xcaf-stepcafcontrol-ap242';
  verifierPath: 'isolated-step-part21-parser';
  sourceOccurrenceCount: number;
  sourceDefinitionCount: number;
  checks: XcafAssemblyRoundtripCheck[];
  placementEvidence: ReturnType<typeof analyzeStepAssemblyPlacements>;
  structureEvidence: ReturnType<typeof analyzeStepAssemblyStructure>;
}

function signature(matrix: readonly number[]): string | null {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return null;
  return matrix.map(value => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(7))).join(',');
}

function decodeStepX2(value: string): string {
  return value.replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_match, hex: string) =>
    (hex.match(/.{4}/g) ?? []).map(code => String.fromCharCode(Number.parseInt(code, 16))).join(''));
}

function productNames(source: string): string[] {
  return [...source.matchAll(/\bPRODUCT\s*\(\s*'((?:[^']|'')*)'/gi)]
    .map(match => decodeStepX2(match[1]!.replaceAll("''", "'")));
}

function check(id: string, expected: unknown, measured: unknown, pass: boolean): XcafAssemblyRoundtripCheck {
  return { id, pass, expected, measured };
}

/**
 * Verifies XCAF/AP242 assembly semantics separately from part geometry.
 * This parser does not claim a second CAD kernel; it is an isolated Part 21
 * structural verifier for hierarchy, reuse, rigid placements, names, colours
 * and declared units.
 */
export function verifyXcafAssemblyRoundtrip(input: {
  step: string;
  definitions: readonly XcafExpectedDefinition[];
  occurrences: readonly XcafExpectedOccurrence[];
  unit?: 'mm';
}): XcafAssemblyRoundtripEvidence {
  const placementEvidence = analyzeStepAssemblyPlacements(input.step);
  const structureEvidence = analyzeStepAssemblyStructure(input.step);
  const expectedMatrices = input.occurrences.map(item => signature(item.matrix)).sort();
  const measuredMatrices = placementEvidence.occurrences.flatMap(item =>
    item.localToParent.status === 'available' ? [signature(item.localToParent.matrix)] : [])
    .filter((item): item is string => item !== null).sort();
  const expectedRepeated = [...new Map(input.occurrences.map(item => [item.definitionId, 0])).keys()]
    .filter(id => input.occurrences.filter(item => item.definitionId === id).length > 1).length;
  const names = productNames(input.step);
  const missingNames = input.definitions.map(item => item.name).filter(name => !names.includes(name));
  const expectedUniqueColors = new Set(input.definitions.flatMap(item => item.color ? [item.color.toLowerCase()] : [])).size;
  const measuredColors = (input.step.match(/\bCOLOUR_RGB\s*\(/gi) ?? []).length;
  const units = detectStepUnits(input.step);
  const checks = [
    check('ap242-schema', true, /FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN/gi.test(input.step), /FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN/gi.test(input.step)),
    check('occurrence-count', input.occurrences.length, placementEvidence.sourceOccurrenceCount, placementEvidence.sourceOccurrenceCount === input.occurrences.length),
    check('cycle-free', true, placementEvidence.cycleFree, placementEvidence.cycleFree),
    check('rigid-transform-availability', input.occurrences.length, placementEvidence.availableTransformCount,
      placementEvidence.availableTransformCount === input.occurrences.length && placementEvidence.invalidTransformCount === 0 && placementEvidence.missingTransformCount === 0),
    check('occurrence-transforms', expectedMatrices, measuredMatrices, JSON.stringify(expectedMatrices) === JSON.stringify(measuredMatrices)),
    check('reused-definitions', expectedRepeated, structureEvidence.repeatedDefinitions, structureEvidence.repeatedDefinitions === expectedRepeated),
    check('definition-names', [], missingNames, missingNames.length === 0),
    check('definition-colors', expectedUniqueColors, measuredColors, measuredColors >= expectedUniqueColors),
    check('length-unit-mm', 'mm', units, (input.unit ?? 'mm') === 'mm' && units.unit === 'mm' && units.confidence === 'high'),
  ];
  return {
    schema: 'nexyfab.xcaf-assembly-roundtrip-evidence.v1',
    status: checks.every(item => item.pass) ? 'pass' : 'fail',
    generatorPath: 'xcaf-stepcafcontrol-ap242',
    verifierPath: 'isolated-step-part21-parser',
    sourceOccurrenceCount: input.occurrences.length,
    sourceDefinitionCount: input.definitions.length,
    checks,
    placementEvidence,
    structureEvidence,
  };
}
