import {
  COMMON_DOMAIN_EVIDENCE_AXES,
  DESIGN_DOMAIN_IDS,
  type DesignDomainId,
  type DomainEvidenceAxis,
  type DomainProfile,
} from './domainProfile';

const common = [...COMMON_DOMAIN_EVIDENCE_AXES] satisfies DomainEvidenceAxis[];

export const DOMAIN_PROFILES = {
  mechanical: {
    id: 'mechanical', family: 'product', documentSchemas: ['nexyfab.product-decomposition.v1', 'nexyfab.feature-tree.v1'],
    objectVocabulary: ['part', 'feature', 'body', 'occurrence', 'assembly', 'mate', 'joint', 'datum', 'drawing', 'bom'],
    requiredInputs: [
      { key: 'functional_requirements', label: 'Functional and interface requirements', requiredFor: 'concept', authoritative: true },
      { key: 'critical_dimensions', label: 'Critical dimensions and tolerances', requiredFor: 'exact', authoritative: true },
      { key: 'material_process', label: 'Material and manufacturing process', requiredFor: 'exact', authoritative: true },
      { key: 'loads_motion', label: 'Loads, motion and duty cycle', requiredFor: 'release', authoritative: true },
    ],
    manualTools: {
      guided: ['dimension', 'move-part', 'replace-component', 'lock-parameter'],
      standard: ['sketch', 'feature-tree', 'dimension', 'mate', 'measure', 'section-view'],
      expert: ['sketch', 'feature-tree', 'mate', 'surface', 'gdt', 'cam'],
    },
    validators: ['brep-validity', 'assembly-dof', 'continuous-collision', 'tolerance-stack', 'dfm', 'step-roundtrip'],
    deliverables: ['part-model', 'assembly', 'manufacturing-drawing', 'bom', 'step', 'inspection-evidence'],
    evidenceAxes: [...common, 'dimensions', 'features', 'part_definitions', 'occurrences', 'body_membership', 'hierarchy', 'transforms', 'joints', 'motion', 'tolerance', 'collision_clearance', 'materials', 'manufacturing', 'step_roundtrip', 'drawing_consistency', 'repair'],
    importFormats: ['step', 'iges', 'sat', 'x_t', 'stl', 'dxf'], exportFormats: ['nfab', 'step', 'dxf', 'pdf', 'bom-json'], fallbackPolicy: 'concept-only',
  },
  building: {
    id: 'building', family: 'spatial-bim', documentSchemas: ['nexyfab.architecture.v1'],
    objectVocabulary: ['site', 'storey', 'level', 'grid', 'space', 'zone', 'wall', 'slab', 'roof', 'opening', 'stair', 'envelope', 'service-opening'],
    requiredInputs: [
      { key: 'site_coordinate', label: 'Site coordinate and vertical datum', requiredFor: 'concept', authoritative: true },
      { key: 'program_storeys', label: 'Program, storeys and target areas', requiredFor: 'concept', authoritative: true },
      { key: 'occupancy_egress', label: 'Occupancy, egress and accessibility basis', requiredFor: 'exact', authoritative: true },
      { key: 'envelope_mep', label: 'Envelope and MEP coordination requirements', requiredFor: 'release', authoritative: true },
    ],
    manualTools: {
      guided: ['move-wall', 'resize-space', 'set-level', 'add-opening'],
      standard: ['grid', 'move-wall', 'resize-space', 'add-opening', 'section-view', 'properties'],
      expert: ['grid', 'host-edit', 'layer-compose', 'section-detail', 'ifc-properties'],
    },
    validators: ['coordinate', 'space-closure', 'host-integrity', 'egress', 'accessibility', 'envelope', 'mep-coordination', 'ifc-roundtrip'],
    deliverables: ['bim-model', 'plans', 'elevations', 'sections', 'schedules', 'ifc', 'coordination-report'],
    evidenceAxes: [...common, 'site_coordinates', 'storeys_grids', 'space_closure', 'hosts_openings', 'egress', 'accessibility', 'envelope_continuity', 'mep_coordination', 'ifc_roundtrip', 'schedules_quantities', 'drawing_consistency', 'repair'],
    importFormats: ['ifc', 'rvt', 'dwg', 'dxf', 'point-cloud'], exportFormats: ['nfab', 'ifc', 'dwg', 'dxf', 'pdf', 'schedule-json'], fallbackPolicy: 'concept-only',
  },
  civil: {
    id: 'civil', family: 'site-infrastructure', documentSchemas: ['nexyfab.civil.v1'],
    objectVocabulary: ['survey-control', 'point', 'surface', 'breakline', 'alignment', 'profile', 'cross-section', 'corridor', 'catchment', 'drainage-node', 'drainage-link', 'structure', 'stage'],
    requiredInputs: [
      { key: 'crs_survey', label: 'CRS, datum and survey control', requiredFor: 'concept', authoritative: true },
      { key: 'existing_surface', label: 'Existing surface and boundaries', requiredFor: 'exact', authoritative: true },
      { key: 'design_criteria', label: 'Alignment, drainage and design criteria', requiredFor: 'exact', authoritative: true },
      { key: 'ground_staging', label: 'Ground, structure and construction-stage inputs', requiredFor: 'release', authoritative: true },
    ],
    manualTools: {
      guided: ['edit-alignment', 'edit-profile', 'set-design-elevation', 'resolve-drainage-low-point'],
      standard: ['edit-alignment', 'edit-profile', 'surface-breakline', 'cross-section', 'drainage-network'],
      expert: ['survey-adjust', 'surface-breakline', 'corridor-target', 'cross-section', 'drainage-network', 'stage-model'],
    },
    validators: ['survey-closure', 'surface-quality', 'alignment-continuity', 'profile', 'corridor-target', 'earthwork', 'drainage', 'stage-equilibrium'],
    deliverables: ['civil-model', 'alignment-profile', 'cross-sections', 'earthwork-report', 'drainage-report', 'civil-drawings', 'landxml', 'ifc'],
    evidenceAxes: [...common, 'survey_control', 'surface_quality', 'alignment', 'profile', 'cross_sections', 'corridor', 'earthwork', 'drainage', 'construction_stages', 'structures', 'ifc_landxml_roundtrip', 'civil_drawings', 'quantities', 'repair'],
    importFormats: ['landxml', 'ifc', 'dwg', 'dxf', 'csv-pnezd', 'dem', 'point-cloud'], exportFormats: ['nfab', 'landxml', 'ifc', 'dwg', 'dxf', 'pdf', 'quantity-json'], fallbackPolicy: 'manual-review',
  },
  landscape: {
    id: 'landscape', family: 'site-infrastructure', documentSchemas: ['nexyfab.landscape.v1'],
    objectVocabulary: ['site-boundary', 'terrain-modifier', 'plant', 'planting-zone', 'hardscape', 'soil-volume', 'irrigation-zone', 'irrigation-pipe', 'drainage-path', 'maintenance-zone'],
    requiredInputs: [
      { key: 'site_existing', label: 'Site, terrain and existing conditions', requiredFor: 'concept', authoritative: true },
      { key: 'planting_soil', label: 'Planting palette, mature size and soil requirements', requiredFor: 'exact', authoritative: true },
      { key: 'grading_drainage', label: 'Grading and drainage criteria', requiredFor: 'exact', authoritative: true },
      { key: 'water_maintenance', label: 'Water supply and maintenance strategy', requiredFor: 'release', authoritative: true },
    ],
    manualTools: {
      guided: ['paint-planting-zone', 'set-spacing', 'edit-grade', 'split-irrigation-zone'],
      standard: ['terrain-modifier', 'paint-planting-zone', 'set-spacing', 'edit-grade', 'soil-volume'],
      expert: ['terrain-modifier', 'plant-data', 'soil-volume', 'hardscape-joint', 'hydraulic-network'],
    },
    validators: ['terrain-grading', 'surface-flow', 'mature-clearance', 'soil-volume', 'hardscape-slope', 'irrigation-pressure', 'schedule-consistency'],
    deliverables: ['landscape-model', 'grading-plan', 'planting-plan', 'planting-schedule', 'hardscape-plan', 'irrigation-plan', 'boq', 'maintenance-plan'],
    evidenceAxes: [...common, 'existing_conditions', 'terrain_grading', 'surface_flow', 'planting_data', 'mature_clearance', 'soil_volume', 'hardscape', 'irrigation', 'schedules_quantities', 'maintenance', 'drawing_consistency', 'repair'],
    importFormats: ['landxml', 'ifc', 'dwg', 'dxf', 'csv', 'gis'], exportFormats: ['nfab', 'ifc', 'dwg', 'dxf', 'pdf', 'schedule-json'], fallbackPolicy: 'manual-review',
  },
  interior: {
    id: 'interior', family: 'spatial-bim', documentSchemas: ['nexyfab.interior.v1'],
    objectVocabulary: ['space-reference', 'furniture', 'ffe', 'activity-clearance', 'finish', 'ceiling', 'light', 'millwork', 'mep-reference'],
    requiredInputs: [
      { key: 'field_measurement', label: 'Field measurement and architecture host revision', requiredFor: 'concept', authoritative: true },
      { key: 'space_users', label: 'Space program, users and circulation', requiredFor: 'concept', authoritative: true },
      { key: 'furniture_finishes', label: 'Furniture, finish and millwork specifications', requiredFor: 'exact', authoritative: true },
      { key: 'ceiling_mep_lighting', label: 'Ceiling, MEP, lighting and acoustic inputs', requiredFor: 'release', authoritative: true },
    ],
    manualTools: {
      guided: ['move-furniture', 'change-finish', 'set-ceiling-height', 'check-door-clearance'],
      standard: ['space-boundary', 'move-furniture', 'change-finish', 'millwork', 'reflected-ceiling'],
      expert: ['space-boundary', 'millwork', 'reflected-ceiling', 'lighting-layout', 'finish-build-up'],
    },
    validators: ['field-measurement', 'space-closure', 'circulation', 'door-swing', 'furniture-clearance', 'ceiling-mep', 'finish-thickness', 'lighting', 'acoustics'],
    deliverables: ['interior-model', 'layout-plan', 'reflected-ceiling-plan', 'elevations', 'millwork-details', 'finish-schedule', 'ffe-schedule', 'boq'],
    evidenceAxes: [...common, 'field_measurement', 'space_closure', 'hosts_openings', 'circulation', 'door_swing', 'egress', 'accessibility', 'furniture_clearance', 'ceiling_mep', 'finishes', 'millwork', 'lighting', 'acoustics', 'schedules_quantities', 'drawing_consistency', 'ifc_roundtrip', 'repair'],
    importFormats: ['ifc', 'rvt', 'skp', 'dwg', 'dxf'], exportFormats: ['nfab', 'ifc', 'dwg', 'dxf', 'pdf', 'schedule-json'], fallbackPolicy: 'concept-only',
  },
} as const satisfies Record<DesignDomainId, DomainProfile>;

export function getDomainProfile(domain: DesignDomainId): DomainProfile {
  return DOMAIN_PROFILES[domain];
}

export function validateDomainProfileRegistry(): string[] {
  const issues: string[] = [];
  const commonAxes = new Set<string>(COMMON_DOMAIN_EVIDENCE_AXES);
  const mechanicalOnly = new Set(['part_definitions', 'occurrences', 'body_membership', 'joints', 'motion', 'tolerance', 'step_roundtrip']);
  for (const domain of DESIGN_DOMAIN_IDS) {
    const profile = DOMAIN_PROFILES[domain];
    if (profile.id !== domain) issues.push(`${domain}: profile id mismatch`);
    for (const axis of commonAxes) if (!profile.evidenceAxes.includes(axis as never)) issues.push(`${domain}: common evidence axis missing:${axis}`);
    if (new Set(profile.evidenceAxes).size !== profile.evidenceAxes.length) issues.push(`${domain}: duplicate evidence axes`);
    if (!profile.documentSchemas.length || !profile.objectVocabulary.length || !profile.validators.length || !profile.deliverables.length) issues.push(`${domain}: incomplete profile contract`);
    if (domain !== 'mechanical') for (const axis of profile.evidenceAxes) if (mechanicalOnly.has(axis)) issues.push(`${domain}: mechanical-only evidence axis leaked:${axis}`);
    if (profile.requiredInputs.some(input => !input.key.trim() || !input.label.trim() || !input.authoritative)) issues.push(`${domain}: invalid required input`);
  }
  return issues;
}
