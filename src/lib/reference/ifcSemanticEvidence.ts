import { parseEntities, type StepArg, type StepEntity } from '@/lib/brep-bridge/stepImport';

export interface IfcSemanticEvidence { guids: number; hierarchyRelations: number; materialRelations: number; propertySets: number; quantitySets: number; georeferenceEntities: number }
export interface IfcSemanticSnapshot {
  schema: string | null;
  occurrences: Array<{ globalId: string; ifcClass: string; parentGlobalId: string | null }>;
  definitions: Array<{ globalId: string; kind: 'property' | 'quantity' | 'material'; signature: string }>;
  georeference: Array<{ ifcClass: string; signature: string }>;
  duplicateGlobalIds: string[];
}
export interface IfcSemanticRoundtripEvidence {
  passed: boolean; before: IfcSemanticSnapshot; after: IfcSemanticSnapshot;
  missingOccurrences: string[]; changedOccurrences: string[];
  missingDefinitions: string[]; changedDefinitions: string[];
  georeferencePreserved: boolean; errors: string[];
}
const ref = (arg: StepArg | undefined): number | null => arg?.kind === 'ref' ? arg.id : null;
const refs = (arg: StepArg | undefined): number[] => arg?.kind === 'list' ? arg.items.flatMap(item => item.kind === 'ref' ? [item.id] : []) : [];
const string = (arg: StepArg | undefined): string | null => arg?.kind === 'string' ? arg.value : null;
const canonical = (arg: StepArg): string => {
  if (arg.kind === 'list') return `(${arg.items.map(canonical).join(',')})`;
  if (arg.kind === 'ref') return '#REF';
  if (arg.kind === 'string') return JSON.stringify(arg.value);
  if (arg.kind === 'number') return Number(arg.value.toPrecision(15)).toString();
  if (arg.kind === 'enum') return `.${arg.value.toUpperCase()}.`;
  return arg.kind === 'null' ? '$' : '*';
};
const entitySignature = (entity: StepEntity): string => `${entity.name}(${entity.args.map(canonical).join(',')})`;
const isOccurrence = (name: string): boolean => /^IFC[A-Z0-9]+$/.test(name)
  && !/^(?:IFCREL|IFCPROPERTY|IFCQUANTITY|IFCELEMENTQUANTITY|IFCMATERIAL|IFCOWNER|IFCAPPLICATION|IFCPERSON|IFCORGANIZATION|IFCUNIT|IFCSIUNIT|IFCGEOMETRIC|IFCAXIS|IFCCARTESIAN|IFCDIRECTION|IFCSHAPE|IFCFACE|IFCPOLY|IFCCLOSED|IFCPRODUCTDEFINITION|IFCMAPCONVERSION|IFCPROJECTEDCRS|IFCBOUNDARY|IFCSTRUCTURALLOAD)/.test(name)
  && !/(?:TYPE|STYLE)$/.test(name);

/** Extract identity-linked IFC semantics; geometry support is a separate gate. */
export function snapshotIfcSemantics(source: string): IfcSemanticSnapshot {
  const entities = parseEntities(source), globalIdByEntity = new Map<number, string>(), seen = new Map<string, number>();
  const isEncodedGlobalId = (value: string) => /^[0-3][0-9A-Za-z_$]{21}$/.test(value);
  for (const [id, entity] of entities) {
    const guid = string(entity.args[0]);
    if (guid && (isOccurrence(entity.name) || entity.name.startsWith('IFCREL'))) {
      globalIdByEntity.set(id, guid);
      // IFC GlobalId uniqueness applies to the encoded 22-character IfcRoot id.
      // Other entities also place ordinary Name/URI strings in argument zero.
      if (isEncodedGlobalId(guid)) seen.set(guid, (seen.get(guid) ?? 0) + 1);
    }
  }
  const parent = new Map<number, number>();
  const definitions: IfcSemanticSnapshot['definitions'] = [];
  for (const entity of entities.values()) {
    if (['IFCRELAGGREGATES', 'IFCRELNESTS'].includes(entity.name)) { const p = ref(entity.args[4]); if (p !== null) for (const child of refs(entity.args[5])) parent.set(child, p); }
    else if (entity.name === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') { const p = ref(entity.args[5]); if (p !== null) for (const child of refs(entity.args[4])) parent.set(child, p); }
    const relationGuid = string(entity.args[0]); if (!relationGuid) continue;
    if (entity.name === 'IFCRELDEFINESBYPROPERTIES') {
      const target = entities.get(ref(entity.args[5]) ?? -1);
      if (target) definitions.push({ globalId: relationGuid, kind: target.name === 'IFCELEMENTQUANTITY' ? 'quantity' : 'property', signature: entitySignature(target) });
    } else if (entity.name === 'IFCRELASSOCIATESMATERIAL') {
      const target = entities.get(ref(entity.args[5]) ?? -1); if (target) definitions.push({ globalId: relationGuid, kind: 'material', signature: entitySignature(target) });
    }
  }
  const occurrences = [...entities].flatMap(([id, entity]) => {
    const globalId = globalIdByEntity.get(id); if (!globalId || !isOccurrence(entity.name)) return [];
    const parentId = parent.get(id); return [{ globalId, ifcClass: entity.name, parentGlobalId: parentId === undefined ? null : globalIdByEntity.get(parentId) ?? null }];
  }).sort((a, b) => a.globalId.localeCompare(b.globalId));
  const georeference = [...entities.values()].filter(entity => ['IFCMAPCONVERSION', 'IFCPROJECTEDCRS'].includes(entity.name))
    .map(entity => ({ ifcClass: entity.name, signature: entitySignature(entity) })).sort((a, b) => `${a.ifcClass}:${a.signature}`.localeCompare(`${b.ifcClass}:${b.signature}`));
  return { schema: source.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null, occurrences, definitions: definitions.sort((a, b) => a.globalId.localeCompare(b.globalId)), georeference, duplicateGlobalIds: [...seen].filter(([, count]) => count > 1).map(([guid]) => guid).sort() };
}

/** Compare source and exported/re-imported IFC; absent evidence fails closed. */
export function verifyIfcSemanticRoundtrip(beforeSource: string, afterSource: string): IfcSemanticRoundtripEvidence {
  const before = snapshotIfcSemantics(beforeSource), after = snapshotIfcSemantics(afterSource);
  const occurrenceMap = new Map(after.occurrences.map(item => [item.globalId, item])), definitionMap = new Map(after.definitions.map(item => [`${item.kind}:${item.globalId}`, item]));
  const missingOccurrences: string[] = [], changedOccurrences: string[] = [], missingDefinitions: string[] = [], changedDefinitions: string[] = [];
  for (const item of before.occurrences) { const found = occurrenceMap.get(item.globalId); if (!found) missingOccurrences.push(item.globalId); else if (found.ifcClass !== item.ifcClass || found.parentGlobalId !== item.parentGlobalId) changedOccurrences.push(item.globalId); }
  for (const item of before.definitions) { const key = `${item.kind}:${item.globalId}`, found = definitionMap.get(key); if (!found) missingDefinitions.push(key); else if (found.signature !== item.signature) changedDefinitions.push(key); }
  const georeferencePreserved = JSON.stringify(before.georeference) === JSON.stringify(after.georeference);
  const errors = [...(before.duplicateGlobalIds.length || after.duplicateGlobalIds.length ? ['duplicate_global_id'] : []), ...(missingOccurrences.length ? ['occurrence_missing'] : []), ...(changedOccurrences.length ? ['occurrence_changed'] : []), ...(missingDefinitions.length ? ['definition_missing'] : []), ...(changedDefinitions.length ? ['definition_changed'] : []), ...(!georeferencePreserved ? ['georeference_changed'] : [])];
  return { passed: errors.length === 0, before, after, missingOccurrences, changedOccurrences, missingDefinitions, changedDefinitions, georeferencePreserved, errors };
}

export function analyzeIfcSemantics(source: string): IfcSemanticEvidence {
  const count = (pattern: RegExp) => source.match(pattern)?.length ?? 0;
  return {
    guids: snapshotIfcSemantics(source).occurrences.length,
    hierarchyRelations: count(/#[0-9]+\s*=\s*IFC(?:RELAGGREGATES|RELCONTAINEDINSPATIALSTRUCTURE|RELNESTS)\s*\(/gi),
    materialRelations: count(/#[0-9]+\s*=\s*IFC(?:RELASSOCIATESMATERIAL|MATERIAL(?:LAYERSET|PROFILESET|CONSTITUENTSET)?)\s*\(/gi),
    propertySets: count(/#[0-9]+\s*=\s*IFC(?:PROPERTYSET|RELDEFINESBYPROPERTIES)\s*\(/gi),
    quantitySets: count(/#[0-9]+\s*=\s*IFC(?:ELEMENTQUANTITY|QUANTITY(?:LENGTH|AREA|VOLUME|COUNT|WEIGHT|TIME))\s*\(/gi),
    georeferenceEntities: count(/#[0-9]+\s*=\s*IFC(?:MAPCONVERSION|PROJECTEDCRS|GEOGRAPHICELEMENT|SITE)\s*\(/gi),
  };
}
