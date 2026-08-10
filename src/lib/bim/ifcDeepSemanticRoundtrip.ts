import { parseEntities, type StepArg, type StepEntity } from '@/lib/brep-bridge/stepImport';
import { analyzeIfcSpatialStructure } from '@/lib/reference/ifcSpatialStructure';
import { snapshotIfcSemantics } from '@/lib/reference/ifcSemanticEvidence';

export interface IfcDeepRoundtripRequirements {
  occurrences: boolean;
  hierarchy: boolean;
  placements: boolean;
  propertySets: boolean;
  classifications: boolean;
  quantities: boolean;
  georeference: boolean;
}

export const IFC_DEEP_RELEASE_REQUIREMENTS: IfcDeepRoundtripRequirements = {
  occurrences: true, hierarchy: true, placements: true, propertySets: true,
  classifications: true, quantities: true, georeference: true,
};

export interface IfcPropertyValueSnapshot {
  name: string;
  ifcClass: string;
  value: string;
  unit: string | null;
}

export interface IfcPropertySetSnapshot {
  occurrenceGlobalId: string;
  psetGlobalId: string | null;
  name: string | null;
  values: IfcPropertyValueSnapshot[];
}

export interface IfcQuantitySnapshot {
  occurrenceGlobalId: string;
  setGlobalId: string | null;
  setName: string | null;
  name: string;
  ifcClass: string;
  value: string;
  unit: string | null;
}

export interface IfcClassificationSnapshot {
  occurrenceGlobalId: string;
  relationGlobalId: string | null;
  scheme: string | null;
  code: string | null;
  name: string | null;
  reference: string;
}

export interface IfcPlacementSnapshot {
  globalId: string;
  status: string;
  worldTransform: number[] | null;
}

export interface IfcDeepSemanticSnapshot {
  schema: string | null;
  occurrences: Array<{ globalId: string; ifcClass: string; parentGlobalId: string | null }>;
  placements: IfcPlacementSnapshot[];
  propertySets: IfcPropertySetSnapshot[];
  classifications: IfcClassificationSnapshot[];
  quantities: IfcQuantitySnapshot[];
  georeference: string[];
  duplicateGlobalIds: string[];
  unresolvedPlacementGlobalIds: string[];
}

export type IfcDeepRoundtripError =
  | 'DUPLICATE_GLOBAL_ID'
  | 'SOURCE_OCCURRENCE_EVIDENCE_MISSING'
  | 'SOURCE_HIERARCHY_EVIDENCE_MISSING'
  | 'SOURCE_PLACEMENT_EVIDENCE_MISSING'
  | 'SOURCE_PROPERTY_SET_EVIDENCE_MISSING'
  | 'SOURCE_CLASSIFICATION_EVIDENCE_MISSING'
  | 'SOURCE_QUANTITY_EVIDENCE_MISSING'
  | 'SOURCE_GEOREFERENCE_EVIDENCE_MISSING'
  | 'OCCURRENCE_CHANGED'
  | 'HIERARCHY_CHANGED'
  | 'PLACEMENT_UNRESOLVED'
  | 'PLACEMENT_CHANGED'
  | 'PROPERTY_SET_CHANGED'
  | 'CLASSIFICATION_CHANGED'
  | 'QUANTITY_CHANGED'
  | 'GEOREFERENCE_CHANGED';

export interface IfcDeepSemanticRoundtripReport {
  schema: 'nexyfab.ifc-deep-semantic-roundtrip.v1';
  passed: boolean;
  requirements: IfcDeepRoundtripRequirements;
  before: IfcDeepSemanticSnapshot;
  after: IfcDeepSemanticSnapshot;
  errors: IfcDeepRoundtripError[];
  changes: {
    occurrenceIds: string[];
    hierarchyIds: string[];
    placementIds: string[];
    propertySetKeys: string[];
    classificationKeys: string[];
    quantityKeys: string[];
  };
}

const ref = (arg: StepArg | undefined): number | null => arg?.kind === 'ref' ? arg.id : null;
const refs = (arg: StepArg | undefined): number[] => arg?.kind === 'list' ? arg.items.flatMap(item => item.kind === 'ref' ? [item.id] : []) : [];
const text = (arg: StepArg | undefined): string | null => arg?.kind === 'string' ? arg.value : null;

function canonicalArg(arg: StepArg | undefined, entities: Map<number, StepEntity>, depth = 0, seen = new Set<number>()): string {
  if (!arg) return '$';
  if (arg.kind === 'list') return `(${arg.items.map(item => canonicalArg(item, entities, depth, seen)).join(',')})`;
  if (arg.kind === 'ref') {
    if (depth >= 5 || seen.has(arg.id)) return '#CYCLE';
    const entity = entities.get(arg.id);
    if (!entity) return '#MISSING';
    const nextSeen = new Set(seen); nextSeen.add(arg.id);
    return `${entity.name}(${entity.args.map(item => canonicalArg(item, entities, depth + 1, nextSeen)).join(',')})`;
  }
  if (arg.kind === 'typed') return `${arg.name.toUpperCase()}(${arg.args.map(item => canonicalArg(item, entities, depth, seen)).join(',')})`;
  if (arg.kind === 'string') return JSON.stringify(arg.value);
  if (arg.kind === 'number') return Number(arg.value.toPrecision(15)).toString();
  if (arg.kind === 'enum') return `.${arg.value.toUpperCase()}.`;
  return arg.kind === 'null' ? '$' : '*';
}

function occurrenceGuidByEntity(source: string, entities: Map<number, StepEntity>): Map<number, string> {
  const semantic = snapshotIfcSemantics(source);
  const wanted = new Set(semantic.occurrences.map(item => item.globalId));
  const result = new Map<number, string>();
  for (const [id, entity] of entities) {
    const guid = text(entity.args[0]);
    if (guid && wanted.has(guid)) result.set(id, guid);
  }
  return result;
}

function propertyValue(entity: StepEntity, entities: Map<number, StepEntity>): IfcPropertyValueSnapshot {
  const valueArgs = entity.name === 'IFCPROPERTYSINGLEVALUE' ? [entity.args[2]] : entity.args.slice(2);
  const unitArg = entity.name === 'IFCPROPERTYSINGLEVALUE' ? entity.args[3] : undefined;
  return {
    name: text(entity.args[0]) ?? '', ifcClass: entity.name,
    value: valueArgs.map(value => canonicalArg(value, entities)).join('|'),
    unit: unitArg?.kind === 'null' || unitArg === undefined ? null : canonicalArg(unitArg, entities),
  };
}

function classificationValue(arg: StepArg | undefined, entities: Map<number, StepEntity>): Pick<IfcClassificationSnapshot, 'scheme' | 'code' | 'name'> {
  const target = entities.get(ref(arg) ?? -1);
  if (!target || target.name !== 'IFCCLASSIFICATIONREFERENCE') return { scheme: null, code: null, name: null };
  const source = entities.get(ref(target.args[3]) ?? -1);
  return {
    scheme: source?.name === 'IFCCLASSIFICATION' ? text(source.args[3]) ?? text(source.args[0]) : null,
    code: text(target.args[1]) ?? text(target.args[0]),
    name: text(target.args[2]),
  };
}

function sorted<T>(items: T[], key: (item: T) => string): T[] {
  return items.sort((left, right) => key(left).localeCompare(key(right)));
}

export function snapshotIfcDeepSemantics(source: string): IfcDeepSemanticSnapshot {
  const entities = parseEntities(source);
  const base = snapshotIfcSemantics(source);
  const guidByEntity = occurrenceGuidByEntity(source, entities);
  const propertySets: IfcPropertySetSnapshot[] = [];
  const quantities: IfcQuantitySnapshot[] = [];
  const classifications: IfcClassificationSnapshot[] = [];

  for (const relation of entities.values()) {
    if (relation.name === 'IFCRELDEFINESBYPROPERTIES') {
      const target = entities.get(ref(relation.args[5]) ?? -1);
      if (!target) continue;
      for (const occurrenceId of refs(relation.args[4])) {
        const occurrenceGlobalId = guidByEntity.get(occurrenceId);
        if (!occurrenceGlobalId) continue;
        if (target.name === 'IFCPROPERTYSET') {
          const values = refs(target.args[4]).flatMap(id => {
            const child = entities.get(id);
            return child?.name.startsWith('IFCPROPERTY') ? [propertyValue(child, entities)] : [];
          });
          propertySets.push({
            occurrenceGlobalId, psetGlobalId: text(target.args[0]), name: text(target.args[2]),
            values: sorted(values, item => `${item.name}:${item.ifcClass}:${item.value}:${item.unit ?? ''}`),
          });
        } else if (target.name === 'IFCELEMENTQUANTITY') {
          for (const quantityId of refs(target.args[5] ?? target.args[4])) {
            const quantity = entities.get(quantityId);
            if (!quantity?.name.startsWith('IFCQUANTITY')) continue;
            quantities.push({
              occurrenceGlobalId, setGlobalId: text(target.args[0]), setName: text(target.args[2]),
              name: text(quantity.args[0]) ?? '', ifcClass: quantity.name,
              value: canonicalArg(quantity.args[3], entities),
              unit: quantity.args[2]?.kind === 'null' || quantity.args[2] === undefined ? null : canonicalArg(quantity.args[2], entities),
            });
          }
        }
      }
    } else if (relation.name === 'IFCRELASSOCIATESCLASSIFICATION') {
      const classificationRef = relation.args[5];
      for (const occurrenceId of refs(relation.args[4])) {
        const occurrenceGlobalId = guidByEntity.get(occurrenceId);
        if (occurrenceGlobalId) classifications.push({
          occurrenceGlobalId, relationGlobalId: text(relation.args[0]), ...classificationValue(classificationRef, entities),
          reference: canonicalArg(classificationRef, entities),
        });
      }
    }
  }

  const spatial = analyzeIfcSpatialStructure(source);
  const placements = spatial.nodes.flatMap(node => node.globalId ? [{
    globalId: node.globalId, status: node.placementStatus,
    worldTransform: node.worldTransform?.map(value => Number(value.toPrecision(15))) ?? null,
  }] : []);
  const georeference = [...entities.values()].filter(entity => ['IFCPROJECTEDCRS', 'IFCMAPCONVERSION'].includes(entity.name))
    .map(entity => `${entity.name}(${entity.args.map(arg => canonicalArg(arg, entities)).join(',')})`).sort();
  return {
    schema: base.schema,
    occurrences: base.occurrences,
    placements: sorted(placements, item => item.globalId),
    propertySets: sorted(propertySets, item => `${item.occurrenceGlobalId}:${item.name ?? ''}:${item.psetGlobalId ?? ''}`),
    classifications: sorted(classifications, item => `${item.occurrenceGlobalId}:${item.reference}:${item.relationGlobalId ?? ''}`),
    quantities: sorted(quantities, item => `${item.occurrenceGlobalId}:${item.setName ?? ''}:${item.name}:${item.ifcClass}`),
    georeference,
    duplicateGlobalIds: base.duplicateGlobalIds,
    unresolvedPlacementGlobalIds: placements.filter(item => item.status !== 'available' && item.status !== 'not_applicable').map(item => item.globalId),
  };
}

function changedKeys<T>(before: T[], after: T[], key: (item: T) => string): string[] {
  const beforeMap = new Map(before.map(item => [key(item), JSON.stringify(item)]));
  const afterMap = new Map(after.map(item => [key(item), JSON.stringify(item)]));
  return [...new Set([...beforeMap.keys(), ...afterMap.keys()])].filter(id => beforeMap.get(id) !== afterMap.get(id)).sort();
}

function placementChanges(before: IfcPlacementSnapshot[], after: IfcPlacementSnapshot[]): string[] {
  const right = new Map(after.map(item => [item.globalId, item]));
  const changed: string[] = [];
  for (const left of before) {
    const candidate = right.get(left.globalId);
    if (!candidate || candidate.status !== left.status || left.worldTransform === null || candidate.worldTransform === null || left.worldTransform.length !== candidate.worldTransform.length) {
      if (JSON.stringify(left) !== JSON.stringify(candidate)) changed.push(left.globalId);
      continue;
    }
    if (left.worldTransform.some((value, index) => Math.abs(value - candidate.worldTransform![index]!) > Math.max(1e-9, Math.abs(value) * 1e-12))) changed.push(left.globalId);
  }
  for (const item of after) if (!before.some(left => left.globalId === item.globalId)) changed.push(item.globalId);
  return [...new Set(changed)].sort();
}

export function verifyIfcDeepSemanticRoundtrip(
  beforeSource: string,
  afterSource: string,
  requirements: IfcDeepRoundtripRequirements = IFC_DEEP_RELEASE_REQUIREMENTS,
): IfcDeepSemanticRoundtripReport {
  const before = snapshotIfcDeepSemantics(beforeSource);
  const after = snapshotIfcDeepSemantics(afterSource);
  const occurrenceIds = changedKeys(before.occurrences, after.occurrences, item => item.globalId);
  const hierarchyIds = changedKeys(
    before.occurrences.map(({ globalId, parentGlobalId }) => ({ globalId, parentGlobalId })),
    after.occurrences.map(({ globalId, parentGlobalId }) => ({ globalId, parentGlobalId })), item => item.globalId,
  );
  const placementIds = placementChanges(before.placements, after.placements);
  const propertySetKeys = changedKeys(before.propertySets, after.propertySets, item => `${item.occurrenceGlobalId}:${item.psetGlobalId ?? item.name ?? ''}`);
  const classificationKeys = changedKeys(before.classifications, after.classifications, item => `${item.occurrenceGlobalId}:${item.relationGlobalId ?? item.reference}`);
  const quantityKeys = changedKeys(before.quantities, after.quantities, item => `${item.occurrenceGlobalId}:${item.setGlobalId ?? item.setName ?? ''}:${item.name}`);
  const errors: IfcDeepRoundtripError[] = [];
  const add = (condition: boolean, code: IfcDeepRoundtripError) => { if (condition && !errors.includes(code)) errors.push(code); };
  add(before.duplicateGlobalIds.length > 0 || after.duplicateGlobalIds.length > 0, 'DUPLICATE_GLOBAL_ID');
  add(requirements.occurrences && before.occurrences.length === 0, 'SOURCE_OCCURRENCE_EVIDENCE_MISSING');
  add(requirements.hierarchy && !before.occurrences.some(item => item.parentGlobalId !== null), 'SOURCE_HIERARCHY_EVIDENCE_MISSING');
  add(requirements.placements && !before.placements.some(item => item.status === 'available'), 'SOURCE_PLACEMENT_EVIDENCE_MISSING');
  add(requirements.propertySets && before.propertySets.length === 0, 'SOURCE_PROPERTY_SET_EVIDENCE_MISSING');
  add(requirements.classifications && before.classifications.length === 0, 'SOURCE_CLASSIFICATION_EVIDENCE_MISSING');
  add(requirements.quantities && before.quantities.length === 0, 'SOURCE_QUANTITY_EVIDENCE_MISSING');
  add(requirements.georeference && before.georeference.length < 2, 'SOURCE_GEOREFERENCE_EVIDENCE_MISSING');
  add(requirements.occurrences && occurrenceIds.length > 0, 'OCCURRENCE_CHANGED');
  add(requirements.hierarchy && hierarchyIds.length > 0, 'HIERARCHY_CHANGED');
  add(requirements.placements && (before.unresolvedPlacementGlobalIds.length > 0 || after.unresolvedPlacementGlobalIds.length > 0), 'PLACEMENT_UNRESOLVED');
  add(requirements.placements && placementIds.length > 0, 'PLACEMENT_CHANGED');
  add(requirements.propertySets && propertySetKeys.length > 0, 'PROPERTY_SET_CHANGED');
  add(requirements.classifications && classificationKeys.length > 0, 'CLASSIFICATION_CHANGED');
  add(requirements.quantities && quantityKeys.length > 0, 'QUANTITY_CHANGED');
  add(requirements.georeference && JSON.stringify(before.georeference) !== JSON.stringify(after.georeference), 'GEOREFERENCE_CHANGED');
  return {
    schema: 'nexyfab.ifc-deep-semantic-roundtrip.v1', passed: errors.length === 0, requirements, before, after, errors,
    changes: { occurrenceIds, hierarchyIds, placementIds, propertySetKeys, classificationKeys, quantityKeys },
  };
}
