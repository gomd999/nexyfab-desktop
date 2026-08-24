/**
 * Rights-cleared teaching fixture for the first mechanical product vertical.
 *
 * The values below are independently chosen nominal values intended to exercise
 * the product contract.  They are not copied from a manufacturer catalogue,
 * drawing, standard table, or customer design, and are not manufacturing
 * approval data.
 */

export const motorGearboxDriveModuleFixture = {
  schema: 'nexyfab.mechanical.product.fixture.motor-gearbox-drive-module.v1',
  fixtureId: 'fixture-mechanical-drive-module-001',
  productKind: 'adjustable-motor-gearbox-drive-module',
  units: 'mm-N-mm-rpm',
  status: 'EDUCATIONAL_DESIGN_CANDIDATE',
  manufacturingApproval: {
    approved: false,
    claimBasis: 'independently authored test fixture; not released for fabrication',
  },
  provenance: {
    sourceKind: 'SELF_GENERATED_PARAMETER_SET',
    sourceId: 'nexyfab-internal-educational-fixture-001',
    sourceRevision: '1.0.0',
    generatedBy: 'NexyFab precision-cad fixture authoring',
    rightsStatus: 'RIGHTS_CLEARED_ORIGINAL',
    rightsBasis: 'Original parameter choices; no external expressive material included',
    externalSourcesUsed: [] as const,
    restrictions: ['Do not represent as a vendor component or certified design'] as const,
  },
  designBasis: {
    intent: 'Compact adjustable drive used to exercise assembly, inspection, and motion workflows',
    numericalBasis: 'Educational synthetic values selected for deterministic unit tests only',
    assumptions: [
      'Nominal static load case is illustrative and requires engineering verification before use',
      'Purchased components are abstract envelopes, not vendor-specific geometry',
      'All dimensions are nominal until toleranced and inspected against an approved revision',
    ] as const,
  },
  requirements: {
    ratedTorqueNm: 42,
    operatingSpeedRpm: { min: 120, max: 1800 },
    serviceFactor: 1.35,
    dutyCyclePercent: 60,
    designLifeHours: 12000,
    shaftAlignmentMmPerMm: 0.05,
    axialLoadN: 180,
    radialLoadN: 420,
  },
  interfaces: {
    motorMount: { pattern: 'four-hole-rectangular', spacingX: 80, spacingY: 63, fastener: 'M8' },
    gearboxMount: { pattern: 'four-hole-rectangular', spacingX: 96, spacingY: 72, fastener: 'M8' },
    drivenShaft: { diameter: 25, usableLength: 42, keyWidth: 8, keyDepth: 3.3 },
    baseMounting: { holeCount: 4, holeDiameter: 11, spacingX: 180, spacingY: 120 },
  },
  components: [
    {
      id: 'mfg-base-001', role: 'base', description: 'Machined support base',
      material: 'independently specified aluminium alloy envelope', process: 'machined',
      criticalDimensions: [{ name: 'baseLength', nominal: 240, tolerance: 0.10, unit: 'mm' }, { name: 'baseWidth', nominal: 160, tolerance: 0.10, unit: 'mm' }, { name: 'mountingPlaneFlatness', nominal: 0, tolerance: 0.05, unit: 'mm' }],
    },
    {
      id: 'mfg-shaft-001', role: 'shaft', description: 'Stepped driven shaft',
      material: 'independently specified steel envelope', process: 'turned-and-keyed',
      criticalDimensions: [{ name: 'bearingJournalDiameter', nominal: 25, tolerance: 0.013, unit: 'mm' }, { name: 'journalRunout', nominal: 0, tolerance: 0.02, unit: 'mm' }, { name: 'usableLength', nominal: 42, tolerance: 0.05, unit: 'mm' }],
    },
    {
      id: 'mfg-bearing-support-a-001', role: 'bearing_support', description: 'Drive-side bearing pedestal',
      material: 'independently specified cast-and-machined envelope', process: 'cast-and-machined',
      criticalDimensions: [{ name: 'boreDiameter', nominal: 52, tolerance: 0.025, unit: 'mm' }, { name: 'supportHeight', nominal: 68, tolerance: 0.05, unit: 'mm' }],
    },
    {
      id: 'mfg-bearing-support-b-001', role: 'bearing_support', description: 'Opposite-side bearing pedestal',
      material: 'independently specified cast-and-machined envelope', process: 'cast-and-machined',
      criticalDimensions: [{ name: 'boreDiameter', nominal: 52, tolerance: 0.025, unit: 'mm' }, { name: 'supportHeight', nominal: 68, tolerance: 0.05, unit: 'mm' }],
    },
    {
      id: 'mfg-coupling-001', role: 'coupling', description: 'Flexible coupling envelope',
      material: 'independently specified steel-and-elastomer envelope', process: 'turned-and-assembled',
      criticalDimensions: [{ name: 'pilotDiameter', nominal: 25, tolerance: 0.02, unit: 'mm' }, { name: 'overallLength', nominal: 58, tolerance: 0.05, unit: 'mm' }],
    },
    {
      id: 'mfg-fastener-set-001', role: 'fasteners', description: 'Base and interface fastener set',
      material: 'abstract fastener grade; selection pending governed specification', process: 'purchased-component-envelope',
      criticalDimensions: [{ name: 'baseFastenerDiameter', nominal: 10, tolerance: 0.20, unit: 'mm' }, { name: 'interfaceFastenerDiameter', nominal: 8, tolerance: 0.20, unit: 'mm' }],
    },
    {
      id: 'mfg-guard-001', role: 'guard', description: 'Removable rotating-part guard envelope',
      material: 'independently specified formed sheet envelope', process: 'formed-and-fastened',
      criticalDimensions: [{ name: 'clearanceToRotatingEnvelope', nominal: 12, tolerance: 1, unit: 'mm' }, { name: 'guardThickness', nominal: 1.5, tolerance: 0.10, unit: 'mm' }],
    },
  ],
  inspection: [
    { id: 'insp-base-flatness-001', componentId: 'mfg-base-001', characteristic: 'mountingPlaneFlatness', method: 'surface-plate-and-indicator', acceptance: 'within declared tolerance', critical: true },
    { id: 'insp-shaft-runout-001', componentId: 'mfg-shaft-001', characteristic: 'journalRunout', method: 'between-centres-indicator', acceptance: 'within declared tolerance', critical: true },
    { id: 'insp-alignment-001', componentId: 'mfg-shaft-001', characteristic: 'assembly shaft alignment', method: 'dial-indicator-alignment-check', acceptance: 'within requirement value', critical: true },
    { id: 'insp-guard-clearance-001', componentId: 'mfg-guard-001', characteristic: 'clearanceToRotatingEnvelope', method: 'calibrated-depth-measurement', acceptance: 'not below nominal minus tolerance', critical: true },
  ],
  verificationStatus: {
    loadLife: 'NOT_RUN',
    toleranceStack: 'NOT_RUN',
    exactBrepRoundTrip: 'NOT_RUN',
    independentReview: 'NOT_RUN',
    fabricationPilot: 'NOT_RUN',
  },
} as const;

export type MotorGearboxDriveModuleFixture = typeof motorGearboxDriveModuleFixture;
