import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ParsedDimension { kind: string; name: string; value: number | null; tol: { lower: number | null; upper: number | null } | null }
interface ParsedGeoTolerance { kind: string; magnitudeMm: number | null; datums: string[]; modifiers?: string[] }
interface ParsedGdt { datums: string[]; dims: ParsedDimension[]; geoTols: ParsedGeoTolerance[] }
export interface PmiSemanticSnapshot {
  datums: string[];
  dimensions: Array<{ kind: string; name: string; value: number | null; lower: number | null; upper: number | null }>;
  geometricTolerances: Array<{ kind: string; magnitudeMm: number | null; datums: string[]; modifiers: string[] }>;
}
export interface PmiSemanticRoundtripResult {
  pass: boolean;
  before: PmiSemanticSnapshot;
  after: PmiSemanticSnapshot;
  exportedStep: string;
  mismatches: string[];
  scope: 'semantic-pmi-only';
}

async function parseGdt(text: string): Promise<ParsedGdt> {
  const url = pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'gdt-import.mjs')).href;
  const gdtModule = await import(/* webpackIgnore: true */ url) as { extractGdt: (source: string) => ParsedGdt };
  return gdtModule.extractGdt(text);
}

const normalizedNumber = (value: number | null): number | null => value === null || !Number.isFinite(value) ? null : Number(value.toPrecision(12));
function snapshot(parsed: ParsedGdt): PmiSemanticSnapshot {
  return {
    datums: [...new Set(parsed.datums)].sort(),
    dimensions: parsed.dims.map(item => ({ kind: item.kind, name: item.name, value: normalizedNumber(item.value), lower: normalizedNumber(item.tol?.lower ?? null), upper: normalizedNumber(item.tol?.upper ?? null) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    geometricTolerances: parsed.geoTols.map(item => ({ kind: item.kind, magnitudeMm: normalizedNumber(item.magnitudeMm), datums: [...new Set(item.datums)].sort(), modifiers: [...new Set(item.modifiers ?? [])].sort() }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

export async function extractAp242PmiSemanticSnapshot(stepText: string): Promise<PmiSemanticSnapshot> {
  return snapshot(await parseGdt(stepText));
}

const real = (value: number) => Number.isInteger(value) ? `${value}.` : String(value);
const esc = (value: string) => value.replaceAll("'", "''");

/** Emit a deterministic AP242 semantic-PMI interchange document. It intentionally contains no product geometry. */
export function emitCanonicalAp242Pmi(input: PmiSemanticSnapshot): string {
  let next = 1;
  const lines: string[] = [];
  const add = (body: string) => { const id = next++; lines.push(`#${id}=${body};`); return `#${id}`; };
  const productShape = add(`PRODUCT_DEFINITION_SHAPE('','semantic PMI normalization',$)`);
  const lengthUnit = add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const datumRefs = new Map<string, string>();
  for (const label of input.datums) datumRefs.set(label, add(`DATUM('',$,${productShape},.F.,'${esc(label)}')`));

  for (const [index, dim] of input.dimensions.entries()) {
    const target = add(`SHAPE_ASPECT('DIM-${index + 1}','normalized dimension target',${productShape},.T.)`);
    const dimRef = dim.kind === 'location'
      ? add(`DIMENSIONAL_LOCATION('${esc(dim.name)}',$,${target},${target})`)
      : add(`DIMENSIONAL_SIZE(${target},'${esc(dim.name)}')`);
    if (dim.value !== null) {
      const measure = add(`( LENGTH_MEASURE_WITH_UNIT() MEASURE_REPRESENTATION_ITEM() MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(dim.value)}),${lengthUnit}) REPRESENTATION_ITEM('nominal value') )`);
      const rep = add(`SHAPE_DIMENSION_REPRESENTATION('',(${measure}),${productShape})`);
      add(`DIMENSIONAL_CHARACTERISTIC_REPRESENTATION(${dimRef},${rep})`);
    }
    if (dim.lower !== null && dim.upper !== null) {
      const lower = add(`( LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(dim.lower)}),${lengthUnit}) REPRESENTATION_ITEM('') )`);
      const upper = add(`( LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(dim.upper)}),${lengthUnit}) REPRESENTATION_ITEM('') )`);
      const value = add(`TOLERANCE_VALUE(${lower},${upper})`);
      add(`PLUS_MINUS_TOLERANCE(${value},${dimRef})`);
    }
  }

  for (const [index, tol] of input.geometricTolerances.entries()) {
    const target = add(`SHAPE_ASPECT('GDT-${index + 1}','normalized tolerance target',${productShape},.T.)`);
    const magnitude = tol.magnitudeMm === null ? null : add(`( LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(tol.magnitudeMm)}),${lengthUnit}) REPRESENTATION_ITEM('') )`);
    const compartments = tol.datums.map(label => {
      const datum = datumRefs.get(label);
      return datum ? add(`DATUM_REFERENCE_COMPARTMENT('',$,${productShape},.F.,${datum},$)`) : null;
    }).filter((value): value is string => value !== null);
    const system = compartments.length ? add(`DATUM_SYSTEM('DS-${index + 1}',$,${productShape},.F.,(${compartments.join(',')}))`) : null;
    const refs = [magnitude, target, system].filter((value): value is string => value !== null);
    const modifiers = tol.modifiers.map(modifier => `.${modifier}.`);
    add(`${tol.kind}('normalized-${index + 1}','',${[...refs, ...modifiers].join(',')})`);
  }

  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('NexyFab semantic PMI normalization'),'2;1');\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/** Attach normalized semantic PMI to an existing geometry STEP without changing its geometry entities. */
export function attachCanonicalAp242Pmi(geometryStep: string, input: PmiSemanticSnapshot): string {
  const canonical = emitCanonicalAp242Pmi(input);
  const canonicalData = canonical.match(/\bDATA;\s*([\s\S]*?)\s*ENDSEC;\s*END-ISO-10303-21;/i)?.[1];
  if (!canonicalData) throw new Error('Canonical PMI document has no DATA section.');
  if ((input.datums.length + input.dimensions.length + input.geometricTolerances.length) === 0) return geometryStep;

  const endIso = geometryStep.lastIndexOf('END-ISO-10303-21;');
  const data = geometryStep.indexOf('DATA;');
  const dataEnd = endIso < 0 ? -1 : geometryStep.lastIndexOf('ENDSEC;', endIso);
  if (data < 0 || dataEnd < data || endIso < 0) throw new Error('Geometry STEP has no complete DATA section.');

  let maxId = 0;
  for (const match of geometryStep.slice(data, dataEnd).matchAll(/^#(\d+)\s*=/gm)) maxId = Math.max(maxId, Number(match[1]));
  const shifted = canonicalData.replace(/#(\d+)/g, (_all, id: string) => `#${Number(id) + maxId}`).trim();
  const before = geometryStep.slice(0, dataEnd).replace(/\s*$/, '\n');
  return `${before}/* NEXYFAB_NORMALIZED_SEMANTIC_PMI */\n${shifted}\n${geometryStep.slice(dataEnd)}`;
}

interface StepEntityGraph {
  entities: Map<number, string>;
  roots: number[];
  faces: number[];
}

function semanticEntityGraph(step: string): StepEntityGraph {
  const entities = new Map<number, string>();
  for (const match of step.matchAll(/#(\d+)\s*=\s*([\s\S]*?);[ \t]*(?:\r?\n|$)/g)) {
    entities.set(Number(match[1]), match[2].replace(/\s+/g, ' ').trim());
  }
  const roots = [...entities]
    .filter(([, body]) => /(?:^|\(|\s)(?:DATUM|DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|[A-Z_]+_TOLERANCE)\(/.test(body) && !/(?:PLUS_MINUS_TOLERANCE|TOLERANCE_VALUE)\(/.test(body))
    .map(([id]) => id);
  const faces = [...entities].filter(([, body]) => /^ADVANCED_FACE\(/.test(body)).map(([id]) => id);
  return { entities, roots, faces };
}

function nearestFace(root: number, graph: StepEntityGraph): number | null {
  const faceSet = new Set(graph.faces);
  const adjacency = new Map<number, Set<number>>();
  for (const [id, body] of graph.entities) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    for (const match of body.matchAll(/#(\d+)/g)) {
      const ref = Number(match[1]);
      if (!adjacency.has(ref)) adjacency.set(ref, new Set());
      adjacency.get(id)!.add(ref);
      adjacency.get(ref)!.add(id);
    }
  }
  const queue: Array<[number, number]> = [[root, 0]];
  const seen = new Set([root]);
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    if (faceSet.has(id)) return id;
    if (depth >= 8) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push([next, depth + 1]); }
    }
  }
  return null;
}

export interface Ap242FaceReattachmentResult {
  source: string;
  mapped: number;
  semanticRoots: number;
  method: 'same-count-advanced-face-ordinal';
}

/** Reconnect normalized semantic roots to exported faces when OCCT preserved the face table cardinality. */
export async function attachCanonicalAp242PmiWithFaceLinks(geometryStep: string, sourceStep: string): Promise<Ap242FaceReattachmentResult> {
  const sourceGraph = semanticEntityGraph(sourceStep);
  const snapshot = await extractAp242PmiSemanticSnapshot(sourceStep);
  let attached = attachCanonicalAp242Pmi(geometryStep, snapshot);
  const outputGraph = semanticEntityGraph(attached);
  if (sourceGraph.faces.length === 0 || sourceGraph.faces.length !== outputGraph.faces.length) {
    return { source: attached, mapped: 0, semanticRoots: sourceGraph.roots.length, method: 'same-count-advanced-face-ordinal' };
  }
  const links: string[] = [];
  let nextId = Math.max(0, ...outputGraph.entities.keys()) + 1;
  for (let index = 0; index < Math.min(sourceGraph.roots.length, outputGraph.roots.length); index++) {
    const sourceFace = nearestFace(sourceGraph.roots[index]!, sourceGraph);
    if (sourceFace === null) continue;
    const faceOrdinal = sourceGraph.faces.indexOf(sourceFace);
    const outputFace = outputGraph.faces[faceOrdinal];
    if (outputFace === undefined) continue;
    links.push(`#${nextId++}=GEOMETRIC_ITEM_SPECIFIC_USAGE('NexyFab semantic face binding','ordinal-preserved OCCT roundtrip',#${outputGraph.roots[index]},#${outputGraph.roots[index]},(#${outputFace}));`);
  }
  if (links.length) {
    const endIso = attached.lastIndexOf('END-ISO-10303-21;');
    const dataEnd = attached.lastIndexOf('ENDSEC;', endIso);
    attached = `${attached.slice(0, dataEnd).replace(/\s*$/, '\n')}/* NEXYFAB_SEMANTIC_FACE_BINDINGS */\n${links.join('\n')}\n${attached.slice(dataEnd)}`;
  }
  return { source: attached, mapped: links.length, semanticRoots: sourceGraph.roots.length, method: 'same-count-advanced-face-ordinal' };
}

export async function verifyAp242PmiSemanticRoundtrip(stepText: string): Promise<PmiSemanticRoundtripResult> {
  const before = await extractAp242PmiSemanticSnapshot(stepText);
  const exportedStep = emitCanonicalAp242Pmi(before);
  const after = snapshot(await parseGdt(exportedStep));
  const mismatches: string[] = [];
  if (JSON.stringify(before.datums) !== JSON.stringify(after.datums)) mismatches.push('datums');
  if (JSON.stringify(before.dimensions) !== JSON.stringify(after.dimensions)) mismatches.push('dimensions');
  if (JSON.stringify(before.geometricTolerances) !== JSON.stringify(after.geometricTolerances)) mismatches.push('geometricTolerances');
  return { pass: mismatches.length === 0 && (before.datums.length + before.dimensions.length + before.geometricTolerances.length) > 0, before, after, exportedStep, mismatches, scope: 'semantic-pmi-only' };
}
