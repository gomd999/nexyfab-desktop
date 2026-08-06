import { parseEntities, type StepArg, type StepEntity } from '@/lib/brep-bridge/stepImport';

export type IfcGeometryRecoveryAction = 'material_layer_sweep' | 'profile_sweep' | 'type_geometry_retry' | 'request_authoritative_thickness';

export interface IfcGeometryRecoveryInput {
  ifcClass: string;
  dimensions: readonly number[];
  hasMaterialLayerUsage: boolean;
  hasProfileDefinition: boolean;
  hasTypeRelationship: boolean;
  evidenceScopedToOccurrence: boolean;
  typeGeometryAlreadyTried: boolean;
}

export interface IfcGeometryRecoveryPlan {
  action: IfcGeometryRecoveryAction;
  automatic: boolean;
  reason: string;
  safeguards: readonly ['preserve_source', 'reject_non_positive_dimensions', 'revalidate_complete_occurrence_coverage'];
}

export interface IfcOccurrenceRecoveryEvidence {
  hasMaterialLayerUsage: boolean;
  hasProfileDefinition: boolean;
  hasTypeRelationship: boolean;
}

const ref = (arg: StepArg | undefined): number | null => arg?.kind === 'ref' ? arg.id : null;
const directRefs = (arg: StepArg | undefined): number[] => arg?.kind === 'ref' ? [arg.id] : arg?.kind === 'list' ? arg.items.flatMap(directRefs) : arg?.kind === 'typed' ? arg.args.flatMap(directRefs) : [];
const allRefs = (entity: StepEntity): number[] => entity.args.flatMap(directRefs);

function graphContains(startIds: readonly number[], entities: Map<number, StepEntity>, predicate: (entity: StepEntity) => boolean): boolean {
  const pending = [...startIds]; const seen = new Set<number>();
  while (pending.length) {
    const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id);
    const entity = entities.get(id); if (!entity) continue; if (predicate(entity)) return true;
    if (seen.size < 20_000) pending.push(...allRefs(entity));
  }
  return false;
}

/** Resolves recovery evidence only through relations/graphs connected to each occurrence. */
export function analyzeIfcOccurrenceRecoveryEvidence(source: string, occurrenceIds: readonly number[]): Map<number, IfcOccurrenceRecoveryEvidence> {
  const entities = parseEntities(source); const wanted = new Set(occurrenceIds); const typeRelated = new Set<number>(); const materialRoots = new Map<number, number[]>();
  for (const entity of entities.values()) {
    if (entity.name === 'IFCRELDEFINESBYTYPE') for (const id of directRefs(entity.args[4])) if (wanted.has(id)) typeRelated.add(id);
    if (entity.name === 'IFCRELASSOCIATESMATERIAL') {
      const materialId = ref(entity.args[5]); if (materialId === null) continue;
      for (const id of directRefs(entity.args[4])) if (wanted.has(id)) materialRoots.set(id, [...(materialRoots.get(id) ?? []), materialId]);
    }
  }
  const result = new Map<number, IfcOccurrenceRecoveryEvidence>();
  for (const id of occurrenceIds) {
    const occurrence = entities.get(id); const representationId = occurrence ? ref(occurrence.args[6]) : null;
    result.set(id, {
      hasTypeRelationship: typeRelated.has(id),
      hasMaterialLayerUsage: graphContains(materialRoots.get(id) ?? [], entities, entity => entity.name === 'IFCMATERIALLAYERSETUSAGE'),
      hasProfileDefinition: representationId !== null && graphContains([representationId], entities, entity => entity.name.endsWith('PROFILEDEF')),
    });
  }
  return result;
}

/** Chooses a recovery path without fabricating a missing physical dimension. */
export function planIfcGeometryRecovery(input: IfcGeometryRecoveryInput): IfcGeometryRecoveryPlan {
  const zeroOrInvalid = input.dimensions.some(value => !Number.isFinite(value) || value <= 0.5);
  const safeguards = ['preserve_source', 'reject_non_positive_dimensions', 'revalidate_complete_occurrence_coverage'] as const;
  if (!zeroOrInvalid) return { action: 'type_geometry_retry', automatic: true, reason: 'Measured bounds are positive; retry the governed representation/type resolver.', safeguards };
  if (input.evidenceScopedToOccurrence && input.ifcClass === 'IFCWALL' && input.hasMaterialLayerUsage) {
    return { action: 'material_layer_sweep', automatic: true, reason: 'Derive wall thickness only from explicit IfcMaterialLayerSetUsage and retain the source axis.', safeguards };
  }
  if (input.evidenceScopedToOccurrence && ['IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER', 'IFCRAILING'].includes(input.ifcClass) && input.hasProfileDefinition) {
    return { action: 'profile_sweep', automatic: true, reason: 'Sweep the explicitly assigned profile along the governed directrix.', safeguards };
  }
  if (input.evidenceScopedToOccurrence && input.hasTypeRelationship && !input.typeGeometryAlreadyTried) {
    return { action: 'type_geometry_retry', automatic: true, reason: 'Retry explicit IfcTypeProduct geometry/property inheritance before requesting input.', safeguards };
  }
  return { action: 'request_authoritative_thickness', automatic: false, reason: 'The source proves a planar/linear extent but does not prove the missing physical dimension.', safeguards };
}
