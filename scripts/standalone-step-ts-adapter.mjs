#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const EPS = 1e-9;

function splitStatements(section) {
  const values = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index];
    if (char === "'") {
      if (quoted && section[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      const value = section.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }
  if (section.slice(start).trim()) throw new Error('INDEPENDENT_STEP_TRUNCATED_STATEMENT');
  return values;
}

function refs(rhs) {
  return [...rhs.matchAll(/#(\d+)/g)].map(match => Number(match[1]));
}

function decodeStepString(value) {
  return value.replaceAll("''", "'");
}

function quotedArgs(rhs) {
  return [...rhs.matchAll(/'((?:''|[^'])*)'/g)].map(match => decodeStepString(match[1]));
}

function numbers(value) {
  return value.split(',').map(item => Number(item.trim().replace(/[dD]/g, 'E')));
}

function vectorFromEntity(entity) {
  const match = entity?.rhs.match(/(?:CARTESIAN_POINT|DIRECTION)\s*\(\s*'(?:''|[^'])*'\s*,\s*\(([^)]*)\)/i);
  if (!match) return null;
  const values = numbers(match[1]);
  return values.length === 3 && values.every(Number.isFinite) ? values : null;
}

function canonicalRhs(rhs) {
  let out = '';
  let quoted = false;
  let pendingSpace = false;
  for (let index = 0; index < rhs.length; index += 1) {
    const char = rhs[index];
    if (char === "'") {
      if (pendingSpace && out && !out.endsWith('(') && !out.endsWith(',')) out += ' ';
      pendingSpace = false;
      out += char;
      if (quoted && rhs[index + 1] === "'") out += rhs[++index];
      else quoted = !quoted;
    } else if (!quoted && /\s/.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && out && !out.endsWith('(') && !out.endsWith(',') && char !== ')' && char !== ',') out += ' ';
      pendingSpace = false;
      out += char;
    }
  }
  return out.trim();
}

export function parseStandaloneStep(source) {
  if (typeof source !== 'string' || !/^\s*ISO-10303-21\s*;/i.test(source)
    || !/END-ISO-10303-21\s*;/i.test(source)) throw new Error('INDEPENDENT_STEP_ENVELOPE_INVALID');
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const dataStart = withoutComments.search(/\bDATA\s*;/i);
  if (dataStart < 0) throw new Error('INDEPENDENT_STEP_DATA_MISSING');
  const dataBodyStart = withoutComments.indexOf(';', dataStart) + 1;
  const dataEnd = withoutComments.search(/\bENDSEC\s*;[\s\r\n]*END-ISO-10303-21/i);
  if (dataEnd <= dataBodyStart) throw new Error('INDEPENDENT_STEP_DATA_END_MISSING');
  const schemaMatch = withoutComments.slice(0, dataStart).match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  const schema = schemaMatch?.[1] ?? '';
  if (!/AP242/i.test(schema)) throw new Error(`INDEPENDENT_STEP_AP242_REQUIRED:${schema || 'missing'}`);
  const entities = new Map();
  for (const statement of splitStatements(withoutComments.slice(dataBodyStart, dataEnd))) {
    const match = statement.match(/^#(\d+)\s*=\s*([\s\S]+)$/);
    if (!match) throw new Error(`INDEPENDENT_STEP_ENTITY_INVALID:${statement.slice(0, 40)}`);
    const id = Number(match[1]);
    if (entities.has(id)) throw new Error(`INDEPENDENT_STEP_ENTITY_DUPLICATE:${id}`);
    const rhs = canonicalRhs(match[2]);
    const type = rhs.match(/^([A-Z0-9_]+)\s*\(/i)?.[1]?.toUpperCase() ?? 'COMPLEX';
    entities.set(id, { id, rhs, type, refs: refs(rhs) });
  }
  if (!entities.size) throw new Error('INDEPENDENT_STEP_ENTITY_EMPTY');
  return { schema, entities };
}

function reachable(entities, rootId) {
  const found = new Set();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    found.add(id);
    for (const child of entities.get(id)?.refs ?? []) pending.push(child);
  }
  return found;
}

function axisPlacement(entities, id) {
  const placement = entities.get(id);
  if (placement?.type !== 'AXIS2_PLACEMENT_3D' || placement.refs.length < 3) {
    throw new Error(`INDEPENDENT_STEP_PLACEMENT_INVALID:${id}`);
  }
  const origin = vectorFromEntity(entities.get(placement.refs[0]));
  const z = vectorFromEntity(entities.get(placement.refs[1]));
  const x = vectorFromEntity(entities.get(placement.refs[2]));
  if (!origin || !z || !x) throw new Error(`INDEPENDENT_STEP_PLACEMENT_VECTOR_INVALID:${id}`);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  for (const vector of [x, y, z]) {
    const length = Math.hypot(...vector);
    if (Math.abs(length - 1) > 1e-7) throw new Error(`INDEPENDENT_STEP_PLACEMENT_NOT_ORTHONORMAL:${id}`);
  }
  if (Math.abs(x[0] * z[0] + x[1] * z[1] + x[2] * z[2]) > 1e-7) {
    throw new Error(`INDEPENDENT_STEP_PLACEMENT_NOT_ORTHOGONAL:${id}`);
  }
  return { origin, x, y, z };
}

function applyPlacement(point, placement) {
  return [0, 1, 2].map(index => placement.origin[index]
    + placement.x[index] * point[0]
    + placement.y[index] * point[1]
    + placement.z[index] * point[2]);
}

function productForDefinition(entities, definitionId) {
  const definition = entities.get(definitionId);
  const formation = entities.get(definition?.refs[0]);
  const product = entities.get(formation?.refs[0]);
  if (!definition || definition.type !== 'PRODUCT_DEFINITION'
    || !formation || !/PRODUCT_DEFINITION_FORMATION/.test(formation.type)
    || product?.type !== 'PRODUCT') throw new Error(`INDEPENDENT_STEP_PRODUCT_CHAIN_INVALID:${definitionId}`);
  const args = quotedArgs(product.rhs);
  if (!args[0] || !args[1]) throw new Error(`INDEPENDENT_STEP_PRODUCT_NAME_MISSING:${definitionId}`);
  return { partNumber: args[0], name: args[1] };
}

function representationForDefinition(entities, definitionId) {
  const pds = [...entities.values()].find(entity => entity.type === 'PRODUCT_DEFINITION_SHAPE' && entity.refs.at(-1) === definitionId);
  const sdr = [...entities.values()].find(entity => entity.type === 'SHAPE_DEFINITION_REPRESENTATION' && entity.refs[0] === pds?.id);
  const representation = entities.get(sdr?.refs[1]);
  if (!pds || !sdr || !representation) throw new Error(`INDEPENDENT_STEP_SHAPE_CHAIN_INVALID:${definitionId}`);
  return representation;
}

function solidForDefinition(entities, definitionId) {
  const representation = representationForDefinition(entities, definitionId);
  const graph = reachable(entities, representation.id);
  const solids = [...graph].filter(id => entities.get(id)?.type === 'MANIFOLD_SOLID_BREP');
  if (solids.length !== 1) throw new Error(`INDEPENDENT_STEP_ONE_SOLID_REQUIRED:${definitionId}:${solids.length}`);
  return solids[0];
}

function measureBox(entities, solidId, placement) {
  const graph = reachable(entities, solidId);
  const faces = [...graph].filter(id => entities.get(id)?.type === 'ADVANCED_FACE');
  const edges = [...graph].filter(id => entities.get(id)?.type === 'EDGE_CURVE');
  const pointValues = [...graph]
    .filter(id => entities.get(id)?.type === 'CARTESIAN_POINT')
    .map(id => vectorFromEntity(entities.get(id)))
    .filter(Boolean);
  const unique = new Map(pointValues.map(point => [point.map(value => value.toPrecision(14)).join(','), point]));
  if (faces.length !== 6 || edges.length !== 12 || unique.size !== 8) {
    throw new Error(`INDEPENDENT_STEP_BOX_TOPOLOGY_REQUIRED:${solidId}:faces=${faces.length}:edges=${edges.length}:points=${unique.size}`);
  }
  const local = [...unique.values()];
  const axes = [0, 1, 2].map(index => local.map(point => point[index]));
  const min = axes.map(axis => Math.min(...axis));
  const max = axes.map(axis => Math.max(...axis));
  const dimensions = max.map((value, index) => value - min[index]);
  if (dimensions.some(value => !Number.isFinite(value) || value <= EPS)) throw new Error(`INDEPENDENT_STEP_BOX_DEGENERATE:${solidId}`);
  const expectedCorners = new Set();
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    expectedCorners.add([x, y, z].map(value => value.toPrecision(14)).join(','));
  }
  if ([...unique.keys()].some(key => !expectedCorners.has(key))) throw new Error(`INDEPENDENT_STEP_NON_BOX_VERTEX:${solidId}`);
  const world = local.map(point => applyPlacement(point, placement));
  return {
    volume: dimensions[0] * dimensions[1] * dimensions[2],
    surfaceArea: 2 * (dimensions[0] * dimensions[1] + dimensions[1] * dimensions[2] + dimensions[0] * dimensions[2]),
    dimensions,
    placementOrigin: placement.origin,
    world,
  };
}

function equalMeasurement(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function inspectStandaloneStep(source) {
  const parsed = parseStandaloneStep(source);
  const entities = parsed.entities;
  const applicationProtocol = [...entities.values()].find(entity => entity.type === 'APPLICATION_PROTOCOL_DEFINITION'
    && /ap242/i.test(quotedArgs(entity.rhs)[1] ?? ''));
  const protocolArgs = quotedArgs(applicationProtocol?.rhs ?? '');
  const protocolYear = Number(applicationProtocol?.rhs.match(/,\s*(\d{4})\s*,\s*#\d+\s*\)/)?.[1]);
  if (!applicationProtocol || !/ap242/i.test(protocolArgs[1] ?? '')
    || !Number.isInteger(protocolYear) || protocolYear < 2011 || protocolYear > new Date().getUTCFullYear()) {
    throw new Error('INDEPENDENT_STEP_AP242_PROTOCOL_DEFINITION_REQUIRED');
  }
  const occurrences = [...entities.values()].filter(entity => entity.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE');
  const transforms = new Map();
  const transformOccurrences = new Set();
  for (const entity of entities.values()) {
    if (entity.type !== 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION' || entity.refs.length < 2) continue;
    const relationship = entities.get(entity.refs[0]);
    const occurrencePds = entities.get(entity.refs[1]);
    if (!relationship || occurrencePds?.type !== 'PRODUCT_DEFINITION_SHAPE') {
      throw new Error(`INDEPENDENT_STEP_TRANSFORM_BINDING_INVALID:${entity.id}`);
    }
    const occurrenceRef = occurrencePds.refs.at(-1);
    const occurrence = entities.get(occurrenceRef);
    if (occurrence?.type !== 'NEXT_ASSEMBLY_USAGE_OCCURRENCE') {
      throw new Error(`INDEPENDENT_STEP_TRANSFORM_OCCURRENCE_INVALID:${entity.id}`);
    }
    if (!relationship.rhs.includes('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION')) {
      throw new Error(`INDEPENDENT_STEP_RRWT_MISSING:${entity.id}`);
    }
    const boundTransforms = relationship.refs
      .map(ref => entities.get(ref))
      .filter(candidate => candidate?.type === 'ITEM_DEFINED_TRANSFORMATION');
    const occurrenceName = quotedArgs(occurrence.rhs)[0];
    const transformName = quotedArgs(boundTransforms[0]?.rhs ?? '')[0]?.replace(/_xfm$/, '');
    if (boundTransforms.length !== 1 || (transformName && transformName !== occurrenceName)) {
      throw new Error(`INDEPENDENT_STEP_RRWT_TRANSFORM_CROSS_BINDING_INVALID:${entity.id}`);
    }
    const parentDefinition = occurrence.refs.at(-2);
    const childDefinition = occurrence.refs.at(-1);
    const parentRepresentationId = representationForDefinition(entities, parentDefinition).id;
    const childRepresentationId = representationForDefinition(entities, childDefinition).id;
    const representationRefs = relationship.refs.filter(ref => ref === parentRepresentationId || ref === childRepresentationId);
    const parentToChild = representationRefs.length === 2
      && representationRefs[0] === parentRepresentationId && representationRefs[1] === childRepresentationId;
    const childToParent = representationRefs.length === 2
      && representationRefs[0] === childRepresentationId && representationRefs[1] === parentRepresentationId;
    if (!parentToChild && !childToParent) {
      throw new Error(`INDEPENDENT_STEP_REPRESENTATION_RELATION_CROSS_BINDING_INVALID:${entity.id}`);
    }
    const firstFrame = axisPlacement(entities, boundTransforms[0].refs[0]);
    const secondFrame = axisPlacement(entities, boundTransforms[0].refs[1]);
    const identity = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const isIdentity = frame => [...frame.origin, ...frame.x, ...frame.y, ...frame.z]
      .every((value, index) => Math.abs(value - identity[index]) <= 1e-7);
    let occurrenceFrame;
    if (parentToChild && isIdentity(secondFrame)) occurrenceFrame = firstFrame;
    else if (childToParent && isIdentity(firstFrame)) occurrenceFrame = secondFrame;
    else throw new Error(`INDEPENDENT_STEP_RELATION_TRANSFORM_ORIENTATION_INVALID:${entity.id}`);
    if (transforms.has(occurrenceName)) throw new Error(`INDEPENDENT_STEP_OCCURRENCE_TRANSFORM_DUPLICATE:${occurrenceName}`);
    transforms.set(occurrenceName, occurrenceFrame);
    transformOccurrences.add(quotedArgs(occurrence.rhs)[0]);
  }
  if (!occurrences.length || transforms.size !== occurrences.length || transformOccurrences.size !== occurrences.length) {
    throw new Error(`INDEPENDENT_STEP_OCCURRENCE_TRANSFORM_MISMATCH:${occurrences.length}:${transforms.size}:${transformOccurrences.size}`);
  }
  const componentNames = [];
  const partNumbers = [];
  const parts = [];
  const points = [];
  let volume = 0;
  let surfaceArea = 0;
  for (const occurrence of occurrences) {
    const occurrenceArgs = quotedArgs(occurrence.rhs);
    const occurrenceName = occurrenceArgs[0];
    const occurrenceLabel = occurrenceArgs[1];
    const childDefinition = occurrence.refs.at(-1);
    const placement = transforms.get(occurrenceName);
    if (!occurrenceName || !childDefinition || !placement || !transformOccurrences.has(occurrenceName)) {
      throw new Error(`INDEPENDENT_STEP_OCCURRENCE_INVALID:${occurrence.id}`);
    }
    const product = productForDefinition(entities, childDefinition);
    const box = measureBox(entities, solidForDefinition(entities, childDefinition), placement);
    componentNames.push(product.name);
    partNumbers.push(product.partNumber);
    parts.push({
      occurrence: occurrenceName,
      occurrenceLabel,
      name: product.name,
      partNumber: product.partNumber,
      dimensionsMm: box.dimensions,
      translationMm: box.placementOrigin,
      volumeMm3: box.volume,
      surfaceAreaMm2: box.surfaceArea,
    });
    points.push(...box.world);
    volume += box.volume;
    surfaceArea += box.surfaceArea;
  }
  const axes = [0, 1, 2].map(index => points.map(point => point[index]));
  const boundingBox = [
    Math.min(...axes[0]), Math.min(...axes[1]), Math.min(...axes[2]),
    Math.max(...axes[0]), Math.max(...axes[1]), Math.max(...axes[2]),
  ];
  return {
    bodyCount: occurrences.length,
    occurrenceCount: occurrences.length,
    units: /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(source) ? 'mm' : 'unknown',
    boundingBox,
    volume,
    surfaceArea,
    componentNames,
    partNumbers,
    parts,
    attributes: {
      schema: 'AP242',
      protocolYear,
      topology: 'manifold-solid-brep/axis-aligned-box',
      placement: 'axis2-placement-3d',
    },
  };
}

export function rewriteStandaloneStep(source) {
  const parsed = parseStandaloneStep(source);
  const statements = [...parsed.entities.values()].sort((left, right) => left.id - right.id)
    .map(entity => `#${entity.id}=${entity.rhs};`);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Independent ISO 10303-21 roundtrip'),'2;1');",
    "FILE_NAME('independent-returned.step','',('independent-parser'),('local-evidence'),'Pure TS Part 21 Parser/Writer','Pure TS Part 21 Parser/Writer','');",
    `FILE_SCHEMA(('${parsed.schema}'));`,
    'ENDSEC;',
    'DATA;',
    ...statements,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

function checks(measurement) {
  return [
    ['opened', 'independent parser constructed an entity graph'],
    ['schema_conformance', 'AP242 schema measured'],
    ['valid_brep', `${measurement.bodyCount} six-face/twelve-edge/eight-vertex manifold box bodies measured`],
    ['body_count', measurement.bodyCount],
    ['units', measurement.units],
    ['bounding_box', measurement.boundingBox.join(',')],
    ['volume', measurement.volume],
    ['surface_area', measurement.surfaceArea],
    ['product_structure', `${measurement.occurrenceCount} product occurrences`],
    ['occurrence_transforms', `${measurement.occurrenceCount} explicit transforms`],
    ['component_names', measurement.componentNames.join('|')],
    ['part_numbers', measurement.partNumbers.join('|')],
    ['attributes', JSON.stringify(measurement.attributes)],
    ['returned_reimport', 'returned bytes parsed by the independent parser'],
    ['geometry_diff', 'source and returned independent measurements are byte-for-byte equal'],
    ['revision_binding', 'runner-bound design revision and source hash'],
  ].map(([id, actual]) => ({ id, status: 'pass', actual }));
}

function writeBound(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { path: relative.replaceAll('\\', '/'), sha256: sha256(value) };
}

/** Separately implemented, intentionally box-assembly-bounded Part 21 parser/writer. */
export async function executeIndependentStepParser({ sourcePath, sourceSha256, designRevisionSha256, evidenceRoot }) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  if (sha256(Buffer.from(source)) !== sourceSha256) throw new Error('INDEPENDENT_STEP_SOURCE_HASH_MISMATCH');
  const sourceMeasurement = inspectStandaloneStep(source);
  if (sourceMeasurement.units !== 'mm') throw new Error('INDEPENDENT_STEP_MM_REQUIRED');
  const returnedText = rewriteStandaloneStep(source);
  const returnedMeasurement = inspectStandaloneStep(returnedText);
  if (!equalMeasurement(sourceMeasurement, returnedMeasurement)) throw new Error('INDEPENDENT_STEP_ROUNDTRIP_MEASUREMENT_MISMATCH');
  const openedPayload = {
    schema: 'nexyfab.independent-step-opened.v1',
    engine: 'pure-ts-part21',
    sourceArtifactSha256: sourceSha256,
    designRevisionSha256,
    measurement: sourceMeasurement,
  };
  const report = {
    schema: 'nexyfab.independent-step-c4-report.v1',
    protocol: 'AP242',
    modelKind: 'assembly',
    sourceArtifactSha256: sourceSha256,
    designRevisionSha256,
    checks: checks(sourceMeasurement),
    measurements: { source: sourceMeasurement, returned: returnedMeasurement },
  };
  const opened = writeBound(evidenceRoot, 'independent-opened.json', `${JSON.stringify(openedPayload, null, 2)}\n`);
  const returned = writeBound(evidenceRoot, 'independent-returned.step', returnedText);
  const reportArtifact = writeBound(evidenceRoot, 'independent-report.json', JSON.stringify(report));
  return {
    engine: { family: 'iso10303-part21-pure-ts', identity: 'Separate pure TypeScript ISO 10303-21 parser/writer', version: '1.0.0-box-assembly' },
    report,
    opened,
    returned,
    reportArtifact,
  };
}
