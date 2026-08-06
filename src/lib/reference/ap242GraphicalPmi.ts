interface EntityGraph { entities: Map<number, string>; roots: number[]; semanticRoots: number[]; faces: number[] }

function parse(step: string): EntityGraph {
  const entities = new Map<number, string>();
  for (const match of step.matchAll(/#(\d+)\s*=\s*([\s\S]*?);[ \t]*(?:\r?\n|$)/g)) {
    entities.set(Number(match[1]), match[2].replace(/\s+/g, ' ').trim());
  }
  const roots = [...entities].filter(([, body]) => /^(?:DRAUGHTING_CALLOUT|(?:TESSELLATED_)?ANNOTATION_OCCURRENCE)\(/.test(body)).map(([id]) => id);
  const semanticRoots = [...entities].filter(([, body]) => /(?:^|\(|\s)(?:DATUM|DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|[A-Z_]+_TOLERANCE)\(/.test(body) && !/(?:PLUS_MINUS_TOLERANCE|TOLERANCE_VALUE)\(/.test(body)).map(([id]) => id);
  const faces = [...entities].filter(([, body]) => /^ADVANCED_FACE\(/.test(body)).map(([id]) => id);
  return { entities, roots, semanticRoots, faces };
}

const refs = (body: string): number[] => [...body.matchAll(/#(\d+)/g)].map(match => Number(match[1]));

export interface GraphicalPmiTransplantResult {
  source: string;
  graphicalRoots: number;
  copiedEntities: number;
  unresolvedReferences: number[];
}

/** Copy the real AP242 graphical-PMI dependency graph while rebasing all entity references. */
export function transplantAp242GraphicalPmi(targetStep: string, sourceStep: string): GraphicalPmiTransplantResult {
  const source = parse(sourceStep);
  const target = parse(targetStep);
  if (source.roots.length === 0) return { source: targetStep, graphicalRoots: 0, copiedEntities: 0, unresolvedReferences: [] };

  const sourceFaceSet = new Set(source.faces);
  const sourceSemanticSet = new Set(source.semanticRoots);
  const copy = new Set<number>();
  const stack = [...source.roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (copy.has(id) || sourceFaceSet.has(id) || sourceSemanticSet.has(id)) continue;
    const body = source.entities.get(id);
    if (!body) continue;
    copy.add(id);
    for (const ref of refs(body)) stack.push(ref);
  }

  let nextId = Math.max(0, ...target.entities.keys()) + 1;
  const mapping = new Map<number, number>();
  for (const id of [...copy].sort((a, b) => a - b)) mapping.set(id, nextId++);
  source.faces.forEach((id, index) => { const targetId = target.faces[index]; if (targetId !== undefined) mapping.set(id, targetId); });
  source.semanticRoots.forEach((id, index) => { const targetId = target.semanticRoots[index]; if (targetId !== undefined) mapping.set(id, targetId); });

  const unresolved = new Set<number>();
  const lines = [...copy].sort((a, b) => a - b).map(id => {
    const body = source.entities.get(id)!;
    const rebased = body.replace(/#(\d+)/g, (_all, raw: string) => {
      const mapped = mapping.get(Number(raw));
      if (mapped === undefined) { unresolved.add(Number(raw)); return '$'; }
      return `#${mapped}`;
    });
    return `#${mapping.get(id)}=${rebased};`;
  });
  const endIso = targetStep.lastIndexOf('END-ISO-10303-21;');
  const dataEnd = targetStep.lastIndexOf('ENDSEC;', endIso);
  if (dataEnd < 0) throw new Error('Target STEP has no complete DATA section.');
  const merged = `${targetStep.slice(0, dataEnd).replace(/\s*$/, '\n')}/* NEXYFAB_GRAPHICAL_PMI */\n${lines.join('\n')}\n${targetStep.slice(dataEnd)}`;
  return { source: merged, graphicalRoots: source.roots.length, copiedEntities: lines.length, unresolvedReferences: [...unresolved].sort((a, b) => a - b) };
}
