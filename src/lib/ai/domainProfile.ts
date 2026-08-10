export const DESIGN_DOMAIN_IDS = [
  'mechanical',
  'building',
  'civil',
  'landscape',
  'interior',
] as const;

export type DesignDomainId = (typeof DESIGN_DOMAIN_IDS)[number];
export type DomainFamily = 'product' | 'spatial-bim' | 'site-infrastructure';
export type UserExperienceLevel = 'guided' | 'expert';

export const COMMON_DOMAIN_EVIDENCE_AXES = [
  'requirements',
  'coordinate_units',
  'semantic_objects',
  'geometry',
  'relationships',
  'provenance',
  'revision_integrity',
  'output_consistency',
] as const;

export const DOMAIN_SPECIFIC_EVIDENCE_AXES = [
  // Mechanical product design.
  'dimensions', 'features', 'part_definitions', 'occurrences', 'body_membership',
  'hierarchy', 'transforms', 'joints', 'motion', 'tolerance',
  'collision_clearance', 'materials', 'manufacturing', 'step_roundtrip',
  'drawing_consistency', 'repair',
  // Architecture / BIM.
  'site_coordinates', 'storeys_grids', 'space_closure', 'hosts_openings',
  'egress', 'accessibility', 'envelope_continuity', 'mep_coordination',
  'ifc_roundtrip', 'schedules_quantities',
  // Civil / infrastructure.
  'survey_control', 'surface_quality', 'alignment', 'profile', 'cross_sections',
  'corridor', 'earthwork', 'drainage', 'construction_stages', 'structures',
  'ifc_landxml_roundtrip', 'civil_drawings', 'quantities',
  // Landscape.
  'existing_conditions', 'terrain_grading', 'surface_flow', 'planting_data',
  'mature_clearance', 'soil_volume', 'hardscape', 'irrigation', 'maintenance',
  // Interior.
  'field_measurement', 'circulation', 'door_swing', 'furniture_clearance',
  'ceiling_mep', 'finishes', 'millwork', 'lighting', 'acoustics',
] as const;

export type CommonDomainEvidenceAxis = (typeof COMMON_DOMAIN_EVIDENCE_AXES)[number];
export type DomainSpecificEvidenceAxis = (typeof DOMAIN_SPECIFIC_EVIDENCE_AXES)[number];
export type DomainEvidenceAxis = CommonDomainEvidenceAxis | DomainSpecificEvidenceAxis;

export interface DomainRequiredInput {
  key: string;
  label: string;
  requiredFor: 'concept' | 'exact' | 'release';
  authoritative: boolean;
}

export interface DomainProfile {
  id: DesignDomainId;
  family: DomainFamily;
  documentSchemas: readonly string[];
  objectVocabulary: readonly string[];
  requiredInputs: readonly DomainRequiredInput[];
  manualTools: Readonly<Record<UserExperienceLevel, readonly string[]>>;
  validators: readonly string[];
  deliverables: readonly string[];
  evidenceAxes: readonly DomainEvidenceAxis[];
  importFormats: readonly string[];
  exportFormats: readonly string[];
  fallbackPolicy: 'concept-only' | 'manual-review';
}
