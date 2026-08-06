import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Ap242PmiEvidence {
  schema: 'AP242' | 'other';
  semantic: {
    datums: number;
    datumFeatures: number;
    dimensions: number;
    geometricTolerances: number;
    plusMinusTolerances: number;
    total: number;
    unparsed: number;
  };
  graphical: { draughtingCallouts: number; annotationOccurrences: number; total: number };
  topology: { semanticRoots: number; rootsReachingAdvancedFace: number; coverage: number; method: string };
}

interface GdtResult {
  datumFeatureCount: number;
  counts: { datums: number; dims: number; geoTols: number; plusMinus: number };
  unparsed: unknown[];
}

function parseEntities(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const match of text.matchAll(/#(\d+)\s*=\s*([\s\S]*?);[ \t]*(?:\r?\n|$)/g)) {
    map.set(Number(match[1]), match[2].replace(/\s+/g, ' ').trim());
  }
  return map;
}

const refsOf = (body: string): number[] => [...body.matchAll(/#(\d+)/g)].map(match => Number(match[1]));
const isSemanticRoot = (body: string): boolean =>
  /(?:^|\(|\s)(?:DATUM|DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|[A-Z_]+_TOLERANCE)\(/.test(body) &&
  !/(?:PLUS_MINUS_TOLERANCE|TOLERANCE_VALUE)\(/.test(body);

function topologyReachability(entities: Map<number, string>): Ap242PmiEvidence['topology'] {
  const adjacency = new Map<number, Set<number>>();
  for (const [id, body] of entities) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    for (const ref of refsOf(body)) {
      adjacency.get(id)!.add(ref);
      if (!adjacency.has(ref)) adjacency.set(ref, new Set());
      adjacency.get(ref)!.add(id);
    }
  }
  const faceIds = new Set([...entities].filter(([, body]) => /^ADVANCED_FACE\(/.test(body)).map(([id]) => id));
  const roots = [...entities].filter(([, body]) => isSemanticRoot(body)).map(([id]) => id);
  let bound = 0;
  for (const root of roots) {
    const queue: Array<[number, number]> = [[root, 0]];
    const seen = new Set([root]);
    let hit = false;
    while (queue.length && !hit) {
      const [id, depth] = queue.shift()!;
      if (faceIds.has(id)) { hit = true; break; }
      if (depth >= 8) continue;
      for (const next of adjacency.get(id) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push([next, depth + 1]); }
      }
    }
    if (hit) bound++;
  }
  return {
    semanticRoots: roots.length,
    rootsReachingAdvancedFace: bound,
    coverage: roots.length ? bound / roots.length : 0,
    method: 'bounded-undirected-STEP-reference-graph(depth<=8); evidence of entity linkage, not persistent topology identity',
  };
}

export async function analyzeAp242Pmi(stepText: string): Promise<Ap242PmiEvidence> {
  const modulePath = pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'gdt-import.mjs')).href;
  const gdtModule = await import(/* webpackIgnore: true */ modulePath) as { extractGdt: (text: string) => GdtResult };
  const gdt = gdtModule.extractGdt(stepText);
  const entities = parseEntities(stepText);
  const draughtingCallouts = [...entities.values()].filter(body => /(?:^|\s|\()DRAUGHTING_CALLOUT\(/.test(body)).length;
  const annotationOccurrences = [...entities.values()].filter(body => /(?:ANNOTATION_OCCURRENCE|TESSELLATED_ANNOTATION_OCCURRENCE)\(/.test(body)).length;
  const total = gdt.counts.datums + gdt.counts.dims + gdt.counts.geoTols;
  return {
    schema: /AP242|MANAGED_MODEL_BASED_3D_ENGINEERING/i.test(stepText) ? 'AP242' : 'other',
    semantic: {
      datums: gdt.counts.datums,
      datumFeatures: gdt.datumFeatureCount,
      dimensions: gdt.counts.dims,
      geometricTolerances: gdt.counts.geoTols,
      plusMinusTolerances: gdt.counts.plusMinus,
      total,
      unparsed: gdt.unparsed.length,
    },
    graphical: { draughtingCallouts, annotationOccurrences, total: draughtingCallouts + annotationOccurrences },
    topology: topologyReachability(entities),
  };
}

