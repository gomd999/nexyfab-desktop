import type { DomainEvidenceAxis } from './domainProfile';
import { verifyArchitectureInteriorGoldenApprovals, type VerifyArchitectureInteriorGoldenApprovalsInput } from './architectureInteriorGoldenApproval';

export const ARCHITECTURE_INTERIOR_GOLDEN_SCHEMA = 'nexyfab.architecture-interior-golden-scenarios.v1' as const;

export const ARCHITECTURE_INTERIOR_GOLDEN_POLICY = Object.freeze({
  campaigns: 3,
  repeatsPerCampaign: 5,
  minimumAccuracy: 0.95,
  maximumFalseVerified: 0,
  holdout: {
    split: 'holdout' as const,
    actualSourceRequired: true,
    generationMayUseHoldout: false,
    independentReviewersRequired: 2,
  },
});

export type ArchitectureInteriorDomain = 'building' | 'interior';
export type GoldenDifficulty = 1 | 2 | 3;

export interface GoldenProvenanceLocator {
  /** URI/path owned by the evaluation operator; the source is never bundled here. */
  locator: string;
  /** Null until the operator records the hash of the actual holdout source. */
  sha256: string | null;
  sourceKind: 'external_holdout' | 'operator_holdout';
}

export interface GoldenAuthoritativeInput {
  id: string;
  kind: 'brief' | 'survey' | 'reference_model' | 'code_schedule' | 'manufacturer_catalog';
  requiredFor: 'concept' | 'exact' | 'release';
  authoritative: true;
  provenance: GoldenProvenanceLocator;
  requiredFacts: readonly string[];
}

export interface GoldenRequiredObject {
  id: string;
  category: 'site' | 'storey' | 'space' | 'wall' | 'slab' | 'opening' | 'door' | 'window' | 'stair' | 'elevator' | 'furniture' | 'fixture' | 'equipment' | 'mep' | 'finish' | 'millwork';
  minCount: number;
  identityFields: readonly string[];
}

export interface GoldenValidationAxis {
  axis: DomainEvidenceAxis;
  required: true;
  tolerancePolicy: string;
  expectedEvidence: readonly string[];
}

export interface GoldenRequiredOutput {
  id: string;
  kind: 'spatial_document' | 'ifc' | 'schedule' | 'verification_report' | 'preview' | 'boq';
  required: true;
  immutable: boolean;
  binding: 'project_revision' | 'source_hash' | 'none';
}

export interface GoldenCompletionCriteria {
  requiredAxes: readonly string[];
  requiredOutputs: readonly string[];
  requiredGatePassRate: 1;
  minimumAccuracy: 0.95;
  falseVerified: 0;
  holdoutApproval: {
    actualSourceHashRecorded: true;
    independentReviewers: 2;
    approvalReceiptRequired: true;
  };
}

export interface ArchitectureInteriorGoldenScenario {
  id: string;
  domain: ArchitectureInteriorDomain;
  difficulty: GoldenDifficulty;
  title: string;
  purpose: string;
  authoritativeInputs: readonly GoldenAuthoritativeInput[];
  requiredObjects: readonly GoldenRequiredObject[];
  validationAxes: readonly GoldenValidationAxis[];
  requiredOutputs: readonly GoldenRequiredOutput[];
  completionCriteria: GoldenCompletionCriteria;
}

export interface ArchitectureInteriorGoldenRun {
  campaign: number;
  repeat: number;
  usedForTuning: false;
  requiredGatesPassed: boolean;
  accuracy: number;
  falseVerified: boolean;
}

export interface ArchitectureInteriorHoldoutApproval {
  reviewerId: string;
  approvalReceiptHash: string;
  approved: true;
  /** Exact signed receipt bytes. A path is resolved only under approved roots. */
  receiptBytes?: Uint8Array;
  receiptPath?: string;
}

export interface ArchitectureInteriorGoldenEvaluationEvidence {
  scenarioId: string;
  /** Hashes are recorded at evaluation time; scenario templates never bundle holdout data. */
  inputSourceHashes: Record<string, string>;
  /** Campaign identity bindings signed into every independent approval. */
  suiteHash?: string;
  releaseHash?: string;
  runs: ArchitectureInteriorGoldenRun[];
  approvals: ArchitectureInteriorHoldoutApproval[];
}

export interface ArchitectureInteriorGoldenEvaluationReport {
  scenarioId: string;
  eligible: boolean;
  blockers: string[];
  campaigns: number;
  minimumRepeatsPerCampaign: number;
  minimumAccuracy: number | null;
  falseVerified: number;
}

const provenance = (locator: string, sourceKind: GoldenProvenanceLocator['sourceKind'] = 'external_holdout'): GoldenProvenanceLocator => ({ locator, sha256: null, sourceKind });
const input = (id: string, kind: GoldenAuthoritativeInput['kind'], requiredFor: GoldenAuthoritativeInput['requiredFor'], locator: string, requiredFacts: readonly string[]): GoldenAuthoritativeInput => ({ id, kind, requiredFor, authoritative: true, provenance: provenance(locator), requiredFacts });
const object = (id: string, category: GoldenRequiredObject['category'], minCount: number, identityFields: readonly string[]): GoldenRequiredObject => ({ id, category, minCount, identityFields });
const axis = (axisName: DomainEvidenceAxis, tolerancePolicy: string, expectedEvidence: readonly string[]): GoldenValidationAxis => ({ axis: axisName, required: true, tolerancePolicy, expectedEvidence });
const output = (id: string, kind: GoldenRequiredOutput['kind'], binding: GoldenRequiredOutput['binding'], immutable = true): GoldenRequiredOutput => ({ id, kind, required: true, immutable, binding });
const criteria = (axes: readonly string[], outputs: readonly string[]): GoldenCompletionCriteria => ({ requiredAxes: axes, requiredOutputs: outputs, requiredGatePassRate: 1, minimumAccuracy: 0.95, falseVerified: 0, holdoutApproval: { actualSourceHashRecorded: true, independentReviewers: 2, approvalReceiptRequired: true } });

export const ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS: readonly ArchitectureInteriorGoldenScenario[] = Object.freeze([
  {
    id: 'arch-single-storey-small-office', domain: 'building', difficulty: 1, title: 'Single-storey small office',
    purpose: 'A compact office tests closed spaces, hosted openings, accessible circulation, and basic MEP coordination.',
    authoritativeInputs: [
      input('office-brief', 'brief', 'concept', 'holdout://architecture-interior/office/brief', ['occupancy', 'room_program', 'design_units']),
      input('office-survey', 'survey', 'exact', 'holdout://architecture-interior/office/survey', ['site_origin', 'external_dimensions', 'level_elevation']),
      input('office-code-schedule', 'code_schedule', 'release', 'holdout://architecture-interior/office/code-schedule', ['egress_width', 'accessible_route', 'door_clearance']),
    ],
    requiredObjects: [
      object('site', 'site', 1, ['id', 'coordinateSystem']), object('storey', 'storey', 1, ['id', 'elevation']), object('office-spaces', 'space', 3, ['id', 'closedBoundary', 'occupancy']), object('office-walls', 'wall', 4, ['id', 'hostStorey', 'thickness']), object('office-openings', 'opening', 2, ['id', 'hostId', 'width']), object('office-doors', 'door', 1, ['id', 'hostId', 'swing']), object('office-windows', 'window', 2, ['id', 'hostId', 'sillHeight']), object('office-mep', 'mep', 1, ['id', 'system', 'spaceId']),
    ],
    validationAxes: [
      axis('site_coordinates', 'source survey coordinates must be preserved within 1 mm in declared units', ['coordinate_system', 'origin', 'level_elevation']), axis('space_closure', 'every required room boundary must close without self-intersection', ['closed_boundary', 'room_area']), axis('hosts_openings', 'every opening must reference exactly one host wall and remain within its boundary', ['host_id', 'opening_clearance']), axis('egress', 'required route and door clear width must meet the supplied code schedule', ['route_graph', 'door_clear_width']), axis('accessibility', 'accessible route must be continuous and obstacle-free', ['route_slope', 'turning_clearance']), axis('mep_coordination', 'MEP objects must remain inside the assigned space and avoid openings', ['system', 'space_id', 'collision_clearance']), axis('ifc_roundtrip', 'exported and re-imported spatial identities must retain stable IDs', ['entity_identity', 'relationship_identity']), axis('schedules_quantities', 'room, opening, and wall schedules must reconcile with the model', ['object_count', 'quantity_totals']),
    ],
    requiredOutputs: [output('office-spatial-document', 'spatial_document', 'project_revision'), output('office-ifc', 'ifc', 'source_hash'), output('office-verification', 'verification_report', 'project_revision'), output('office-schedule', 'schedule', 'project_revision'), output('office-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['site_coordinates', 'space_closure', 'hosts_openings', 'egress', 'accessibility', 'mep_coordination', 'ifc_roundtrip', 'schedules_quantities'], ['office-spatial-document', 'office-ifc', 'office-verification', 'office-schedule', 'office-preview']),
  },
  {
    id: 'arch-multi-storey-apartment', domain: 'building', difficulty: 2, title: 'Multi-storey apartment',
    purpose: 'A repeated multi-storey apartment tests vertical hierarchy, cores, shafts, unit separation, and quantity consistency.',
    authoritativeInputs: [
      input('apartment-brief', 'brief', 'concept', 'holdout://architecture-interior/apartment/brief', ['unit_mix', 'storey_count', 'occupancy']),
      input('apartment-reference-model', 'reference_model', 'exact', 'holdout://architecture-interior/apartment/reference-model', ['grid', 'storey_heights', 'core_layout', 'unit_boundaries']),
      input('apartment-code-schedule', 'code_schedule', 'release', 'holdout://architecture-interior/apartment/code-schedule', ['fire_egress', 'stair_width', 'accessible_lift', 'fire_compartment']),
    ],
    requiredObjects: [
      object('apartment-site', 'site', 1, ['id', 'coordinateSystem']), object('apartment-storeys', 'storey', 3, ['id', 'elevation', 'height']), object('apartment-units', 'space', 6, ['id', 'closedBoundary', 'unitNumber']), object('apartment-walls', 'wall', 12, ['id', 'hostStorey', 'type']), object('apartment-openings', 'opening', 6, ['id', 'hostId', 'fireRating']), object('apartment-doors', 'door', 6, ['id', 'hostId', 'swing']), object('apartment-windows', 'window', 6, ['id', 'hostId', 'sillHeight']), object('apartment-stair', 'stair', 1, ['id', 'connectsStoreys', 'clearWidth']), object('apartment-lift', 'elevator', 1, ['id', 'servesStoreys', 'accessible']), object('apartment-shafts', 'mep', 2, ['id', 'system', 'verticalContinuity']),
    ],
    validationAxes: [
      axis('storeys_grids', 'storey elevations and grid coordinates must match the reference within 1 mm', ['storey_elevations', 'grid_axes']), axis('space_closure', 'every dwelling unit and common space must be closed and non-overlapping', ['unit_boundaries', 'overlap_matrix']), axis('hosts_openings', 'openings retain host wall and fire/thermal properties across repeated floors', ['host_id', 'fire_rating']), axis('envelope_continuity', 'external envelope is continuous across storeys except declared openings', ['envelope_faces', 'opening_exceptions']), axis('egress', 'all occupied storeys connect to compliant exits through the supplied route graph', ['route_graph', 'travel_distance']), axis('accessibility', 'accessible unit, entrance, lift, and common route remain connected', ['accessible_route', 'lift_served_storeys']), axis('mep_coordination', 'vertical shafts remain continuous and coordinated with slabs and rooms', ['shaft_continuity', 'clearance']), axis('ifc_roundtrip', 'storey, unit, opening, and relationship identities survive IFC round-trip', ['entity_identity', 'relationship_identity']), axis('schedules_quantities', 'unit, opening, wall, and storey quantities reconcile across repeated levels', ['schedule_reconciliation', 'quantity_totals']),
    ],
    requiredOutputs: [output('apartment-spatial-document', 'spatial_document', 'project_revision'), output('apartment-ifc', 'ifc', 'source_hash'), output('apartment-verification', 'verification_report', 'project_revision'), output('apartment-schedule', 'schedule', 'project_revision'), output('apartment-boq', 'boq', 'project_revision'), output('apartment-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['storeys_grids', 'space_closure', 'hosts_openings', 'envelope_continuity', 'egress', 'accessibility', 'mep_coordination', 'ifc_roundtrip', 'schedules_quantities'], ['apartment-spatial-document', 'apartment-ifc', 'apartment-verification', 'apartment-schedule', 'apartment-boq', 'apartment-preview']),
  },
  {
    id: 'interior-cafe-restaurant-kitchen', domain: 'interior', difficulty: 3, title: 'Cafe / restaurant kitchen',
    purpose: 'A hospitality interior tests measured placement, circulation, door swings, kitchen equipment, ceiling services, and finish schedules.',
    authoritativeInputs: [
      input('cafe-brief', 'brief', 'concept', 'holdout://architecture-interior/cafe/brief', ['seating_capacity', 'service_flow', 'room_program']),
      input('cafe-survey', 'survey', 'exact', 'holdout://architecture-interior/cafe/survey', ['as_built_dimensions', 'columns', 'fixed_services']),
      input('cafe-catalog', 'manufacturer_catalog', 'exact', 'holdout://architecture-interior/cafe/equipment-catalog', ['equipment_footprints', 'service_clearances', 'connection_points']),
      input('cafe-code-schedule', 'code_schedule', 'release', 'holdout://architecture-interior/cafe/code-schedule', ['egress', 'accessible_route', 'sanitary_clearance']),
    ],
    requiredObjects: [
      object('cafe-rooms', 'space', 4, ['id', 'closedBoundary', 'function']), object('cafe-walls', 'wall', 6, ['id', 'hostStorey', 'finish']), object('cafe-doors', 'door', 2, ['id', 'hostId', 'swing']), object('cafe-windows', 'window', 2, ['id', 'hostId', 'sillHeight']), object('cafe-furniture', 'furniture', 8, ['id', 'catalogType', 'clearance']), object('cafe-equipment', 'equipment', 5, ['id', 'catalogType', 'serviceClearance']), object('cafe-millwork', 'millwork', 2, ['id', 'runLength', 'finish']), object('cafe-mep', 'mep', 4, ['id', 'system', 'spaceId']), object('cafe-finishes', 'finish', 4, ['id', 'surface', 'material']),
    ],
    validationAxes: [
      axis('field_measurement', 'fixed survey dimensions and service points must be preserved within 1 mm', ['as_built_dimensions', 'fixed_services']), axis('circulation', 'customer and service routes must be connected and maintain supplied clearances', ['route_graph', 'clearance_matrix']), axis('door_swing', 'door leaves must not obstruct required routes or equipment clearances', ['swing_arc', 'obstruction_check']), axis('furniture_clearance', 'each catalog object retains its required clearance envelope', ['catalog_id', 'clearance_envelope']), axis('ceiling_mep', 'ceiling services connect to assigned systems without clashes', ['system', 'connection_points', 'clash_report']), axis('finishes', 'finish assignments cover required surfaces without gaps or overlaps', ['surface_coverage', 'material_id']), axis('millwork', 'millwork dimensions and service interfaces match the approved catalog', ['run_length', 'interface_points']), axis('lighting', 'lighting objects retain target zones and mounting relationships', ['target_zone', 'mounting_host']), axis('acoustics', 'acoustic finish schedule covers occupied zones with declared performance', ['zone_coverage', 'performance_class']), axis('output_consistency', 'preview, schedule, and exported document refer to the same revision', ['revision_binding', 'artifact_hash']),
    ],
    requiredOutputs: [output('cafe-spatial-document', 'spatial_document', 'project_revision'), output('cafe-verification', 'verification_report', 'project_revision'), output('cafe-schedule', 'schedule', 'project_revision'), output('cafe-boq', 'boq', 'project_revision'), output('cafe-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['field_measurement', 'circulation', 'door_swing', 'furniture_clearance', 'ceiling_mep', 'finishes', 'millwork', 'lighting', 'acoustics', 'output_consistency'], ['cafe-spatial-document', 'cafe-verification', 'cafe-schedule', 'cafe-boq', 'cafe-preview']),
  },
  {
    id: 'arch-office-mep-service-openings', domain: 'building', difficulty: 2, title: 'Office MEP companion and service openings',
    purpose: 'A building companion case tests coordinated ceiling services, interference clearance, and explicit service openings without asserting any external source approval.',
    authoritativeInputs: [
      input('mep-companion-brief', 'brief', 'concept', 'holdout://architecture-interior/mep-companion/brief', ['space_program', 'service_systems', 'ceiling_zones']),
      input('mep-companion-reference-model', 'reference_model', 'exact', 'holdout://architecture-interior/mep-companion/reference-model', ['host_walls', 'slabs', 'ceiling_zones', 'space_boundaries']),
      input('mep-companion-service-survey', 'survey', 'exact', 'holdout://architecture-interior/mep-companion/service-survey', ['fixed_services', 'structural_constraints', 'service_routes']),
      input('mep-companion-code-schedule', 'code_schedule', 'release', 'holdout://architecture-interior/mep-companion/code-schedule', ['firestop', 'access_clearance', 'opening_limits']),
    ],
    requiredObjects: [
      object('mep-companion-site', 'site', 1, ['id', 'coordinateSystem']), object('mep-companion-storey', 'storey', 1, ['id', 'elevation']), object('mep-companion-spaces', 'space', 4, ['id', 'closedBoundary', 'ceilingZone']), object('mep-companion-walls', 'wall', 8, ['id', 'hostStorey', 'thickness']), object('mep-companion-slabs', 'slab', 1, ['id', 'storeyId', 'thickness']), object('mep-companion-openings', 'opening', 4, ['id', 'hostId', 'serviceType']), object('mep-companion-mep', 'mep', 8, ['id', 'system', 'spaceId']), object('mep-companion-equipment', 'equipment', 3, ['id', 'system', 'serviceClearance']),
    ],
    validationAxes: [
      axis('coordinate_units', 'all service and host geometry uses the declared project units and coordinate frame', ['unit_system', 'coordinate_frame']), axis('semantic_objects', 'hosts, services, openings, and systems retain their explicit semantic identities', ['host_type', 'system_type', 'service_opening']), axis('relationships', 'every service opening binds one host and one assigned system', ['host_binding', 'system_binding']), axis('hosts_openings', 'each opening remains inside its host wall or slab and preserves required clearances', ['host_id', 'opening_extent', 'clearance']), axis('ceiling_mep', 'ceiling services connect to assigned systems without interference', ['system', 'connection_points', 'interference_report']), axis('mep_coordination', 'MEP routes avoid structural and architectural exclusions with declared tolerances', ['route_clearance', 'collision_check']), axis('ifc_roundtrip', 'service, host, opening, and relationship identities survive IFC round-trip', ['entity_identity', 'relationship_identity']), axis('revision_integrity', 'model, service layout, and schedules refer to one immutable source revision', ['revision_id', 'source_hash']), axis('output_consistency', 'drawings, schedules, and verification report bind to the same evaluated revision', ['revision_binding', 'artifact_hash']),
    ],
    requiredOutputs: [output('mep-companion-spatial-document', 'spatial_document', 'project_revision'), output('mep-companion-ifc', 'ifc', 'source_hash'), output('mep-companion-verification', 'verification_report', 'project_revision'), output('mep-companion-schedule', 'schedule', 'project_revision'), output('mep-companion-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['coordinate_units', 'semantic_objects', 'relationships', 'hosts_openings', 'ceiling_mep', 'mep_coordination', 'ifc_roundtrip', 'revision_integrity', 'output_consistency'], ['mep-companion-spatial-document', 'mep-companion-ifc', 'mep-companion-verification', 'mep-companion-schedule', 'mep-companion-preview']),
  },
  {
    id: 'arch-comprehensive-residential', domain: 'building', difficulty: 3, title: 'Comprehensive residential building',
    purpose: 'A comprehensive residential case combines model, drawing, and schedule revision checks across architecture, interiors, openings, circulation, and services.',
    authoritativeInputs: [
      input('residential-brief', 'brief', 'concept', 'holdout://architecture-interior/comprehensive-residential/brief', ['occupancy', 'unit_mix', 'room_program']),
      input('residential-survey', 'survey', 'exact', 'holdout://architecture-interior/comprehensive-residential/survey', ['site_origin', 'levels', 'fixed_conditions']),
      input('residential-reference-model', 'reference_model', 'exact', 'holdout://architecture-interior/comprehensive-residential/reference-model', ['storeys', 'units', 'cores', 'host_relationships']),
      input('residential-model-drawing-schedule', 'reference_model', 'release', 'holdout://architecture-interior/comprehensive-residential/model-drawing-schedule', ['model_revision', 'drawing_revision', 'schedule_revision', 'revision_binding']),
      input('residential-code-schedule', 'code_schedule', 'release', 'holdout://architecture-interior/comprehensive-residential/code-schedule', ['egress', 'accessibility', 'fire_compartment', 'service_clearance']),
    ],
    requiredObjects: [
      object('residential-site', 'site', 1, ['id', 'coordinateSystem']), object('residential-storeys', 'storey', 4, ['id', 'elevation', 'height']), object('residential-spaces', 'space', 12, ['id', 'closedBoundary', 'roomType']), object('residential-walls', 'wall', 24, ['id', 'hostStorey', 'type']), object('residential-openings', 'opening', 16, ['id', 'hostId', 'fireRating']), object('residential-doors', 'door', 12, ['id', 'hostId', 'swing']), object('residential-windows', 'window', 16, ['id', 'hostId', 'sillHeight']), object('residential-stair', 'stair', 1, ['id', 'connectsStoreys', 'clearWidth']), object('residential-lift', 'elevator', 1, ['id', 'servesStoreys', 'accessible']), object('residential-mep', 'mep', 8, ['id', 'system', 'spaceId']), object('residential-furniture', 'furniture', 12, ['id', 'spaceId', 'clearance']),
    ],
    validationAxes: [
      axis('site_coordinates', 'survey origin and storey elevations are preserved within 1 mm in declared units', ['coordinate_system', 'origin', 'level_elevation']), axis('storeys_grids', 'storeys, grids, and unit hosts remain aligned to the reference model', ['storey_elevations', 'grid_axes', 'host_storey']), axis('space_closure', 'all dwelling and common spaces close without overlap or unassigned boundaries', ['closed_boundary', 'overlap_matrix']), axis('hosts_openings', 'doors, windows, and service openings retain unique hosts and supplied properties', ['host_id', 'opening_properties']), axis('egress', 'occupied units and common spaces connect to compliant exits through the supplied route graph', ['route_graph', 'travel_distance']), axis('accessibility', 'accessible entrance, lift, units, and common routes remain connected', ['accessible_route', 'turning_clearance']), axis('ceiling_mep', 'ceiling services and vertical distribution remain coordinated with rooms and slabs', ['system', 'service_zone', 'clash_report']), axis('schedules_quantities', 'model quantities reconcile with the evaluated drawing and schedule revision', ['schedule_reconciliation', 'quantity_totals', 'revision_id']), axis('revision_integrity', 'model, drawing, and schedule revisions are identical and immutable for the run', ['model_revision', 'drawing_revision', 'schedule_revision']), axis('ifc_roundtrip', 'storey, space, opening, placement, and relationship identities survive IFC round-trip', ['entity_identity', 'placement_identity', 'relationship_identity']), axis('output_consistency', 'all exported documents and reports bind to the same project revision', ['revision_binding', 'artifact_hash']),
    ],
    requiredOutputs: [output('residential-spatial-document', 'spatial_document', 'project_revision'), output('residential-ifc', 'ifc', 'source_hash'), output('residential-verification', 'verification_report', 'project_revision'), output('residential-schedule', 'schedule', 'project_revision'), output('residential-boq', 'boq', 'project_revision'), output('residential-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['site_coordinates', 'storeys_grids', 'space_closure', 'hosts_openings', 'egress', 'accessibility', 'ceiling_mep', 'schedules_quantities', 'revision_integrity', 'ifc_roundtrip', 'output_consistency'], ['residential-spatial-document', 'residential-ifc', 'residential-verification', 'residential-schedule', 'residential-boq', 'residential-preview']),
  },
  {
    id: 'arch-ifc4-3-regression', domain: 'building', difficulty: 3, title: 'IFC4.3 semantic regression',
    purpose: 'An IFC4.3 regression case checks wall, slab, opening, placement, and georeference semantics through an independent round-trip contract.',
    authoritativeInputs: [
      input('ifc-regression-brief', 'brief', 'concept', 'holdout://architecture-interior/ifc4-3-regression/brief', ['exchange_scope', 'entity_scope', 'coordinate_reference']),
      input('ifc-regression-model', 'reference_model', 'exact', 'holdout://architecture-interior/ifc4-3-regression/model', ['ifc_version', 'walls', 'slabs', 'openings', 'placements']),
      input('ifc-regression-georeference', 'survey', 'exact', 'holdout://architecture-interior/ifc4-3-regression/georeference', ['map_conversion', 'projected_crs', 'local_origin']),
      input('ifc-regression-exchange-contract', 'code_schedule', 'release', 'holdout://architecture-interior/ifc4-3-regression/exchange-contract', ['wall_semantics', 'slab_semantics', 'opening_relationships', 'placement_rules', 'georeference_rules']),
    ],
    requiredObjects: [
      object('ifc-regression-site', 'site', 1, ['id', 'coordinateSystem', 'georeference']), object('ifc-regression-storey', 'storey', 1, ['id', 'elevation']), object('ifc-regression-spaces', 'space', 2, ['id', 'closedBoundary', 'storeyId']), object('ifc-regression-walls', 'wall', 4, ['id', 'hostStorey', 'placement']), object('ifc-regression-slabs', 'slab', 1, ['id', 'storeyId', 'placement']), object('ifc-regression-openings', 'opening', 2, ['id', 'hostId', 'placement']), object('ifc-regression-doors', 'door', 1, ['id', 'hostId', 'placement']),
    ],
    validationAxes: [
      axis('coordinate_units', 'IFC units, local placement, and georeference use explicit compatible definitions', ['unit_assignment', 'local_origin', 'map_conversion']), axis('semantic_objects', 'IFC4.3 wall, slab, opening, site, storey, and space entities retain their intended types', ['entity_type', 'predefined_type']), axis('geometry', 'wall and slab geometry remains valid and measurable after export and import', ['representation', 'solid_geometry', 'quantities']), axis('relationships', 'openings remain related to their host walls or slabs and spaces retain containment', ['voids_relationship', 'host_relationship', 'containment']), axis('ifc_roundtrip', 'IFC4.3 wall, slab, opening, placement, and georeference semantics round-trip without identity loss', ['entity_identity', 'placement_identity', 'georeference_identity']), axis('revision_integrity', 'source and round-tripped IFC artifacts bind to one immutable evaluated revision', ['source_hash', 'roundtrip_hash', 'revision_id']), axis('output_consistency', 'verification, schedule, and IFC outputs identify the same exchange revision', ['revision_binding', 'artifact_hash']),
    ],
    requiredOutputs: [output('ifc-regression-spatial-document', 'spatial_document', 'project_revision'), output('ifc-regression-ifc', 'ifc', 'source_hash'), output('ifc-regression-verification', 'verification_report', 'project_revision'), output('ifc-regression-schedule', 'schedule', 'project_revision'), output('ifc-regression-preview', 'preview', 'none', false)],
    completionCriteria: criteria(['coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'ifc_roundtrip', 'revision_integrity', 'output_consistency'], ['ifc-regression-spatial-document', 'ifc-regression-ifc', 'ifc-regression-verification', 'ifc-regression-schedule', 'ifc-regression-preview']),
  },
]);

const SHA256 = /^[a-f0-9]{64}$/;
const LOCATOR = /^(?:holdout|https?):\/\/[^\s]+$/;
const sameMembers = (left: readonly string[], right: readonly string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

/** Validates the contract without reading or copying any external source. */
export function validateArchitectureInteriorGoldenScenarios(value: unknown = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS): string[] {
  if (!Array.isArray(value) || value.length !== 6) return ['scenario_count_invalid'];
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const scenario of value) {
    if (!scenario || typeof scenario !== 'object') { issues.push('scenario_invalid'); continue; }
    const item = scenario as ArchitectureInteriorGoldenScenario;
    if (!item.id || ids.has(item.id)) issues.push(`scenario_id_invalid:${item.id}`);
    ids.add(item.id);
    if (item.domain !== 'building' && item.domain !== 'interior') issues.push(`scenario_domain_invalid:${item.id}`);
    if (![1, 2, 3].includes(item.difficulty) || !item.title?.trim() || !item.purpose?.trim()) issues.push(`scenario_metadata_invalid:${item.id}`);
    if (!item.authoritativeInputs?.length) issues.push(`authoritative_inputs_missing:${item.id}`);
    const inputIds = new Set<string>();
    for (const source of item.authoritativeInputs ?? []) {
      if (!source.id?.trim() || inputIds.has(source.id) || !source.requiredFacts?.length) issues.push(`authoritative_input_invalid:${item.id}:${source.id}`);
      inputIds.add(source.id);
      if (source.authoritative !== true || !['external_holdout', 'operator_holdout'].includes(source.provenance?.sourceKind) || !LOCATOR.test(source.provenance.locator) || (source.provenance.sha256 !== null && !SHA256.test(source.provenance.sha256))) issues.push(`provenance_invalid:${item.id}:${source.id}`);
    }
    if (!item.requiredObjects?.length) issues.push(`required_objects_missing:${item.id}`);
    const objectIds = new Set<string>();
    for (const object of item.requiredObjects ?? []) {
      if (!object.id?.trim() || objectIds.has(object.id) || !Number.isSafeInteger(object.minCount) || object.minCount < 1 || !object.identityFields?.length) issues.push(`required_object_invalid:${item.id}:${object.id}`);
      objectIds.add(object.id);
    }
    if (!item.validationAxes?.length) issues.push(`validation_axes_missing:${item.id}`);
    if (!item.requiredOutputs?.length) issues.push(`required_outputs_missing:${item.id}`);
    const axisIds = (item.validationAxes ?? []).map(entry => entry.axis);
    const outputIds = (item.requiredOutputs ?? []).map(entry => entry.id);
    if (new Set(axisIds).size !== axisIds.length || item.validationAxes?.some(entry => entry.required !== true || !entry.tolerancePolicy?.trim() || !entry.expectedEvidence?.length)) issues.push(`validation_axis_invalid:${item.id}`);
    if (new Set(outputIds).size !== outputIds.length || item.requiredOutputs?.some(entry => entry.required !== true)) issues.push(`required_output_invalid:${item.id}`);
    if (!sameMembers(item.completionCriteria?.requiredAxes ?? [], axisIds) || !sameMembers(item.completionCriteria?.requiredOutputs ?? [], outputIds)) issues.push(`completion_scope_mismatch:${item.id}`);
    if (item.completionCriteria?.minimumAccuracy !== ARCHITECTURE_INTERIOR_GOLDEN_POLICY.minimumAccuracy || item.completionCriteria?.falseVerified !== ARCHITECTURE_INTERIOR_GOLDEN_POLICY.maximumFalseVerified || item.completionCriteria?.requiredGatePassRate !== 1 || item.completionCriteria?.holdoutApproval?.actualSourceHashRecorded !== true || item.completionCriteria?.holdoutApproval?.independentReviewers !== 2 || item.completionCriteria?.holdoutApproval?.approvalReceiptRequired !== true) issues.push(`completion_policy_mismatch:${item.id}`);
  }
  return [...new Set(issues)];
}

export function architectureInteriorGoldenScenarioById(id: string): ArchitectureInteriorGoldenScenario | undefined {
  return ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.find(item => item.id === id);
}

/** Fail-closed promotion gate for evidence produced from real, independently approved holdout sources. */
export type ArchitectureInteriorGoldenApprovalVerificationOptions = Omit<VerifyArchitectureInteriorGoldenApprovalsInput, 'approvals' | 'scenarioId' | 'sourceHashes' | 'suiteHash' | 'releaseHash'>;

export function evaluateArchitectureInteriorGoldenEvidence(
  evidence: ArchitectureInteriorGoldenEvaluationEvidence,
  approvalOptions: ArchitectureInteriorGoldenApprovalVerificationOptions = {},
): ArchitectureInteriorGoldenEvaluationReport {
  const scenario = architectureInteriorGoldenScenarioById(evidence.scenarioId);
  const blockers: string[] = [];
  if (!scenario) blockers.push('unknown_scenario');
  const expectedInputIds = scenario?.authoritativeInputs.map(item => item.id) ?? [];
  const sourceIds = Object.keys(evidence.inputSourceHashes ?? {});
  if (!sameMembers(sourceIds, expectedInputIds) || sourceIds.some(id => !SHA256.test(evidence.inputSourceHashes[id] ?? ''))) blockers.push('actual_holdout_source_hashes');

  const slots = new Set<string>();
  const repeatsByCampaign = new Map<number, Set<number>>();
  let malformedRun = false;
  for (const run of evidence.runs ?? []) {
    if (!Number.isSafeInteger(run.campaign) || run.campaign < 1 || run.campaign > ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns || !Number.isSafeInteger(run.repeat) || run.repeat < 1 || run.repeat > ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign || run.usedForTuning !== false || !Number.isFinite(run.accuracy) || run.accuracy < 0 || run.accuracy > 1) malformedRun = true;
    const slot = `${run.campaign}:${run.repeat}`;
    if (slots.has(slot)) malformedRun = true;
    slots.add(slot);
    const repeats = repeatsByCampaign.get(run.campaign) ?? new Set<number>();
    repeats.add(run.repeat);
    repeatsByCampaign.set(run.campaign, repeats);
  }
  if (malformedRun) blockers.push('run_contract');
  const campaigns = [...repeatsByCampaign.keys()].filter(value => value >= 1 && value <= ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns).length;
  const minimumRepeatsPerCampaign = campaigns ? Math.min(...[...repeatsByCampaign.entries()].filter(([campaign]) => campaign >= 1 && campaign <= ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns).map(([, repeats]) => repeats.size)) : 0;
  if (campaigns !== ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns) blockers.push('campaigns');
  if (minimumRepeatsPerCampaign !== ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign || slots.size !== ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns * ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign) blockers.push('campaign_repeats');
  if ((evidence.runs ?? []).some(run => !run.requiredGatesPassed)) blockers.push('required_gate_pass_rate');
  const minimumAccuracy = evidence.runs?.length ? Math.min(...evidence.runs.map(run => run.accuracy)) : null;
  if (minimumAccuracy === null || minimumAccuracy < ARCHITECTURE_INTERIOR_GOLDEN_POLICY.minimumAccuracy) blockers.push('minimum_accuracy');
  const falseVerified = (evidence.runs ?? []).filter(run => run.falseVerified).length;
  if (falseVerified > ARCHITECTURE_INTERIOR_GOLDEN_POLICY.maximumFalseVerified) blockers.push('false_verified');

  const approvalResult = verifyArchitectureInteriorGoldenApprovals({
    ...approvalOptions,
    approvals: evidence.approvals ?? [],
    scenarioId: evidence.scenarioId,
    sourceHashes: evidence.inputSourceHashes,
    suiteHash: evidence.suiteHash,
    releaseHash: evidence.releaseHash,
    requiredReviewers: ARCHITECTURE_INTERIOR_GOLDEN_POLICY.holdout.independentReviewersRequired,
  });
  if (!approvalResult.ok) {
    blockers.push('independent_holdout_approval');
    blockers.push(...approvalResult.issues.map(issue => `approval_verification:${issue}`));
  }
  return { scenarioId: evidence.scenarioId, eligible: blockers.length === 0, blockers: [...new Set(blockers)], campaigns, minimumRepeatsPerCampaign, minimumAccuracy, falseVerified };
}
