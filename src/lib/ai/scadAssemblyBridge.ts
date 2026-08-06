import type { ComplexProductArchitecture } from './complexProductArchitecture';
import type { OccurrenceTransformEvidence } from './productAssemblyCertificate';
import type { AgentSession } from './scad-agent/types';

export interface ScadAssemblyBridgeResult {
  schema: 'nexyfab.scad-assembly-bridge.v1';
  status: 'pass' | 'fail';
  architecture: ComplexProductArchitecture | null;
  transforms: OccurrenceTransformEvidence[];
  codes: string[];
}

export interface ParsedEffectiveScadAssembly {
  modules: Record<string, string>;
  composition: string | null;
}

interface ParsedPlacement {
  moduleName: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const VECTOR = '\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]';
const CALL = '([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\)\\s*;';
const PLACEMENT_PATTERNS = [
  new RegExp(`^translate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*rotate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*${CALL}$`),
  new RegExp(`^rotate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*translate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*${CALL}$`),
  new RegExp(`^translate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*${CALL}$`),
  new RegExp(`^rotate\\s*\\(\\s*${VECTOR}\\s*\\)\\s*${CALL}$`),
  new RegExp(`^${CALL}$`),
];

const vector = (match: RegExpMatchArray, offset: number): [number, number, number] => [
  Number(match[offset]), Number(match[offset + 1]), Number(match[offset + 2]),
];

function parsePlacement(line: string): ParsedPlacement | null {
  let match = line.match(PLACEMENT_PATTERNS[0]!);
  if (match) return { position: vector(match, 1), rotation: vector(match, 4), moduleName: match[7]! };
  match = line.match(PLACEMENT_PATTERNS[1]!);
  if (match) return { rotation: vector(match, 1), position: vector(match, 4), moduleName: match[7]! };
  match = line.match(PLACEMENT_PATTERNS[2]!);
  if (match) return { position: vector(match, 1), rotation: [0, 0, 0], moduleName: match[4]! };
  match = line.match(PLACEMENT_PATTERNS[3]!);
  if (match) return { rotation: vector(match, 1), position: [0, 0, 0], moduleName: match[4]! };
  match = line.match(PLACEMENT_PATTERNS[4]!);
  return match ? { moduleName: match[1]!, position: [0, 0, 0], rotation: [0, 0, 0] } : null;
}

function matrix(position: [number, number, number], rotation: [number, number, number]): number[] {
  const [x, y, z] = rotation.map(value => value * Math.PI / 180);
  const cx = Math.cos(x!), sx = Math.sin(x!);
  const cy = Math.cos(y!), sy = Math.sin(y!);
  const cz = Math.cos(z!), sz = Math.sin(z!);
  // Rz * Ry * Rx, row-major, translation in the last column.
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, position[0],
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, position[1],
    -sy, cy * sx, cy * cx, position[2],
    0, 0, 0, 1,
  ];
}

export function bridgeScadAssembly(
  session: Pick<AgentSession, 'modules' | 'composition'>,
  productName = 'SCAD Assembly',
): ScadAssemblyBridgeResult {
  const codes: string[] = [];
  const moduleNames = Object.keys(session.modules);
  if (moduleNames.length < 1) codes.push('SCAD_ASSEMBLY_DEFINITIONS_MISSING');
  if (!session.composition?.trim()) codes.push('SCAD_ASSEMBLY_COMPOSITION_MISSING');
  if (codes.length) return { schema: 'nexyfab.scad-assembly-bridge.v1', status: 'fail', architecture: null, transforms: [], codes };

  const placements: ParsedPlacement[] = [];
  for (const raw of session.composition!.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line || /^include\s*</i.test(line) || /^use\s*</i.test(line)) continue;
    const parsed = parsePlacement(line);
    if (!parsed) { codes.push(`SCAD_ASSEMBLY_PLACEMENT_UNPARSED:${line.slice(0, 80)}`); continue; }
    if (!Object.hasOwn(session.modules, parsed.moduleName)) {
      codes.push(`SCAD_ASSEMBLY_DEFINITION_MISSING:${parsed.moduleName}`);
      continue;
    }
    if (![...parsed.position, ...parsed.rotation].every(Number.isFinite)) {
      codes.push(`SCAD_ASSEMBLY_TRANSFORM_NONFINITE:${parsed.moduleName}`);
      continue;
    }
    placements.push(parsed);
  }
  if (!placements.length) codes.push('SCAD_ASSEMBLY_OCCURRENCES_MISSING');
  else if (placements.length < 2) codes.push('SCAD_ASSEMBLY_MULTIPLE_OCCURRENCES_REQUIRED');
  if (codes.length) return { schema: 'nexyfab.scad-assembly-bridge.v1', status: 'fail', architecture: null, transforms: [], codes };

  const rootDefinitionId = 'scad:def:product';
  const rootOccurrenceId = 'scad:occ:root';
  const requirementId = 'scad:req:source';
  const quantity = new Map<string, number>();
  const occurrences = placements.map((placement, index) => {
    const next = (quantity.get(placement.moduleName) ?? 0) + 1;
    quantity.set(placement.moduleName, next);
    return {
      id: `scad:occ:${placement.moduleName}:${index + 1}`,
      definitionId: `scad:def:${placement.moduleName}`,
      parentOccurrenceId: rootOccurrenceId,
      quantityIndex: next,
    };
  });
  const architecture: ComplexProductArchitecture = {
    schema: 'nexyfab.complex-product-architecture.v1',
    requirements: [{ id: requirementId, kind: 'manufacturing', text: `Preserve independent SCAD modules and placements for ${productName}.`, status: 'confirmed', sourceRefs: ['scad-agent:session'] }],
    definitions: [
      { id: rootDefinitionId, name: productName, kind: 'product', sourcing: 'make', independentlyReplaceable: false, bodyIntent: { policy: 'multi_body', expectedBodies: null }, requirementIds: [requirementId] },
      ...moduleNames.map(name => ({ id: `scad:def:${name}`, name, kind: 'part' as const, sourcing: 'make' as const, independentlyReplaceable: true, bodyIntent: { policy: 'single_body' as const, expectedBodies: 1 }, requirementIds: [requirementId] })),
    ],
    occurrences: [{ id: rootOccurrenceId, definitionId: rootDefinitionId, parentOccurrenceId: null, quantityIndex: 1 }, ...occurrences],
    interfaces: [],
    interfaceExpectation: 'unknown',
  };
  const transforms: OccurrenceTransformEvidence[] = [
    { occurrenceId: rootOccurrenceId, matrix: [...IDENTITY], source: 'assembly_solver' },
    ...placements.map((placement, index) => ({ occurrenceId: occurrences[index]!.id, matrix: matrix(placement.position, placement.rotation), source: 'assembly_solver' as const })),
  ];
  return { schema: 'nexyfab.scad-assembly-bridge.v1', status: 'pass', architecture, transforms, codes: [] };
}

export function bridgeEffectiveScadSource(
  source: string,
  productName = 'SCAD Assembly',
): ScadAssemblyBridgeResult {
  const parsed = parseEffectiveScadAssemblySource(source);
  if (!Object.keys(parsed.modules).length) {
    return { schema: 'nexyfab.scad-assembly-bridge.v1', status: 'fail', architecture: null, transforms: [], codes: ['SCAD_ASSEMBLY_MODULE_SECTIONS_MISSING'] };
  }
  return bridgeScadAssembly(parsed, productName);
}

export function parseEffectiveScadAssemblySource(source: string): ParsedEffectiveScadAssembly {
  const modules: Record<string, string> = {};
  let composition: string | null = null;
  let activeModule: string | null = null;
  let activeLines: string[] = [];
  const flushModule = () => {
    if (activeModule) modules[activeModule] = activeLines.join('\n').trim();
    activeModule = null;
    activeLines = [];
  };
  for (const line of source.split(/\r?\n/)) {
    const moduleHeader = line.match(/^\/\/.*module:\s*([A-Za-z_][A-Za-z0-9_]*)\s*/i);
    if (moduleHeader) {
      flushModule();
      activeModule = moduleHeader[1]!;
      continue;
    }
    if (/^\/\/.*\bcomposition\b/i.test(line.trim())) {
      flushModule();
      composition = '';
      continue;
    }
    if (composition !== null) composition += `${composition ? '\n' : ''}${line}`;
    else if (activeModule) activeLines.push(line);
  }
  flushModule();
  return { modules, composition };
}
