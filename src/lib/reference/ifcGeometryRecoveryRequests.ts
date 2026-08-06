import { ifcToNexyfabAssembly } from '@/lib/brep-bridge/ifcImport';
import { parseEntities } from '@/lib/brep-bridge/stepImport';
import { analyzeIfcOccurrenceRecoveryEvidence, planIfcGeometryRecovery, type IfcGeometryRecoveryAction } from './ifcGeometryRecoveryPolicy';

export interface IfcGeometryRecoveryRequest {
  entityId: number; globalId: string | null; ifcClass: string; measuredDimensionsMm: number[]; missingAxes: number[];
  action: IfcGeometryRecoveryAction; automatic: boolean; requiredInputs: string[]; reason: string;
}
export interface IfcGeometryRecoveryRequestReport { releaseReady: boolean; elements: number; imported: number; requests: IfcGeometryRecoveryRequest[]; errors: string[] }

/** Produces occurrence-scoped recovery requests without inventing dimensions. */
export function buildIfcGeometryRecoveryRequests(source: string): IfcGeometryRecoveryRequestReport {
  const imported = ifcToNexyfabAssembly(source, { maxParts: 20_000 });
  const dimensions = imported.stats?.dimensionEvidence ?? [], entities = parseEntities(source);
  const evidence = analyzeIfcOccurrenceRecoveryEvidence(source, dimensions.map(item => item.entityId));
  const requests = dimensions.map(item => {
    const scoped = evidence.get(item.entityId) ?? { hasMaterialLayerUsage: false, hasProfileDefinition: false, hasTypeRelationship: false };
    const plan = planIfcGeometryRecovery({ ifcClass: item.ifcClass, dimensions: item.dimensions, ...scoped, evidenceScopedToOccurrence: true, typeGeometryAlreadyTried: true });
    const entity = entities.get(item.entityId); const globalId = entity?.args[0]?.kind === 'string' ? entity.args[0].value : null;
    const requiredInputs = plan.automatic ? [] : item.ifcClass === 'IFCRAILING' ? ['profile_definition_or_physical_width_mm'] : item.ifcClass === 'IFCWALL' ? ['material_layer_set_or_wall_thickness_mm'] : item.ifcClass === 'IFCDOOR' ? ['unique_positive_volume_and_plan_area_or_door_depth_mm'] : ['authoritative_missing_dimensions_mm'];
    return { entityId: item.entityId, globalId, ifcClass: item.ifcClass, measuredDimensionsMm: item.dimensions, missingAxes: item.dimensions.flatMap((value, index) => !Number.isFinite(value) || value <= 0.5 ? [index] : []), action: plan.action, automatic: plan.automatic, requiredInputs, reason: plan.reason };
  });
  const errors = [...(!imported.ok && !imported.stats ? [imported.error ?? 'ifc_import_failed'] : []), ...(requests.some(request => request.globalId === null) ? ['occurrence_global_id_missing'] : [])];
  return { releaseReady: requests.length === 0 && errors.length === 0 && imported.ok, elements: imported.stats?.elements ?? 0, imported: imported.stats?.imported ?? 0, requests, errors };
}
