/**
 * Rights-cleared synthetic interior fit-out fixture.
 *
 * This is an independently authored coordination envelope for tests only. The
 * values are nominal millimetres selected to exercise host binding, space,
 * furniture, ceiling, MEP, finish, and millwork relationships. They are not
 * copied from a drawing, catalogue, standard, brand, or surveyed project and
 * must not be treated as construction approval data.
 */

export const smallOfficeFitoutFixture = {
  schema: 'nexyfab.interior.product.fixture.small-office-fitout.v1',
  fixtureId: 'fixture-interior-small-office-001',
  productKind: 'small-office-fit-out',
  revision: 'synthetic-1.0.0',
  status: 'CONCEPT',
  units: 'mm',
  coordinateSystem: {
    name: 'local-host-XY',
    origin: 'synthetic host southwest corner',
    xAxis: 'east',
    yAxis: 'north',
    zAxis: 'up',
    verticalDatum: 'local-finished-floor-zero',
  },
  provenance: {
    origin: 'ORIGINAL_SYNTHETIC',
    rightsStatus: 'RIGHTS_CLEARED',
    rightsBasis: 'independently authored concepts and nominal envelopes; no external expressive material used',
    externalSourcesUsed: [] as const,
    surveyedHost: false,
    sourceRef: 'fixture://nexyfab/interior/small-office/001',
  },
  designBasis: {
    numericalBasis: 'Synthetic test values only; field measurement and governed product data are required before use.',
    hostAssumption: 'Closed rectangular host envelope with a single nominal entry opening.',
    approvalBasis: 'Coordination fixture only; not a permit, construction, procurement, or life-safety document.',
  },
  program: [
    { id: 'int-program-open-work', spaceId: 'int-space-open-work', name: 'open work area', occupants: 8, areaTargetM2: 42, required: true },
    { id: 'int-program-meeting', spaceId: 'int-space-meeting', name: 'meeting room', occupants: 6, areaTargetM2: 15, required: true },
    { id: 'int-program-support', spaceId: 'int-space-support', name: 'support and storage', occupants: 1, areaTargetM2: 6, required: true },
  ],
  host: {
    id: 'int-host-office-shell',
    revision: 'synthetic-host-1',
    polygon: [
      { x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8400 }, { x: 0, y: 8400 },
    ],
    floorElevation: 0,
    ceilingElevation: 3000,
    walls: [
      { id: 'int-wall-south', start: { x: 0, y: 0 }, end: { x: 12000, y: 0 }, thickness: 180, hostRef: 'int-host-office-shell' },
      { id: 'int-wall-east', start: { x: 12000, y: 0 }, end: { x: 12000, y: 8400 }, thickness: 180, hostRef: 'int-host-office-shell' },
      { id: 'int-wall-north', start: { x: 12000, y: 8400 }, end: { x: 0, y: 8400 }, thickness: 180, hostRef: 'int-host-office-shell' },
      { id: 'int-wall-west', start: { x: 0, y: 8400 }, end: { x: 0, y: 0 }, thickness: 180, hostRef: 'int-host-office-shell' },
    ],
    openings: [
      { id: 'int-door-entry', kind: 'door', hostWallId: 'int-wall-south', sill: 0, head: 2100, width: 1000, center: { x: 6000, y: 0 }, swing: 'inward-left', hostRef: 'int-host-office-shell' },
    ],
  },
  spaces: [
    { id: 'int-space-open-work', name: 'open work area', hostRef: 'int-host-office-shell', polygon: [{ x: 300, y: 300 }, { x: 7700, y: 300 }, { x: 7700, y: 8100 }, { x: 300, y: 8100 }], finishZoneId: 'int-finish-work', ceilingZoneId: 'int-ceiling-work' },
    { id: 'int-space-meeting', name: 'meeting room', hostRef: 'int-host-office-shell', polygon: [{ x: 7900, y: 300 }, { x: 11700, y: 300 }, { x: 11700, y: 4300 }, { x: 7900, y: 4300 }], finishZoneId: 'int-finish-meeting', ceilingZoneId: 'int-ceiling-meeting' },
    { id: 'int-space-support', name: 'support and storage', hostRef: 'int-host-office-shell', polygon: [{ x: 7900, y: 4600 }, { x: 11700, y: 4600 }, { x: 11700, y: 8100 }, { x: 7900, y: 8100 }], finishZoneId: 'int-finish-support', ceilingZoneId: 'int-ceiling-support' },
  ],
  furnitureEnvelopes: [
    { id: 'int-ffe-workstations', kind: 'workstation-group', spaceRef: 'int-space-open-work', envelope: { x: 1100, y: 1800, width: 5200, depth: 1800, height: 750 }, quantity: 4 },
    { id: 'int-ffe-meeting-table', kind: 'meeting-table', spaceRef: 'int-space-meeting', envelope: { x: 8500, y: 1700, width: 2400, depth: 1100, height: 740 }, quantity: 1 },
    { id: 'int-ffe-storage', kind: 'storage-run', spaceRef: 'int-space-support', envelope: { x: 8300, y: 5200, width: 3000, depth: 450, height: 2100 }, quantity: 1 },
  ],
  ceilings: [
    { id: 'int-ceiling-work', spaceRef: 'int-space-open-work', type: 'modular-plane', elevation: 2700, hostRef: 'int-host-office-shell' },
    { id: 'int-ceiling-meeting', spaceRef: 'int-space-meeting', type: 'modular-plane', elevation: 2700, hostRef: 'int-host-office-shell' },
    { id: 'int-ceiling-support', spaceRef: 'int-space-support', type: 'modular-plane', elevation: 2700, hostRef: 'int-host-office-shell' },
  ],
  lightingPlaceholders: [
    { id: 'int-light-work-grid', ceilingRef: 'int-ceiling-work', kind: 'linear-placeholder', quantity: 8, photometricStatus: 'NOT_RUN' },
    { id: 'int-light-meeting-center', ceilingRef: 'int-ceiling-meeting', kind: 'surface-placeholder', quantity: 2, photometricStatus: 'NOT_RUN' },
    { id: 'int-light-support-general', ceilingRef: 'int-ceiling-support', kind: 'surface-placeholder', quantity: 2, photometricStatus: 'NOT_RUN' },
  ],
  mepZones: [
    { id: 'int-mep-work', spaceRef: 'int-space-open-work', ceilingRef: 'int-ceiling-work', zoneKind: 'supply-return-coordination-envelope', verificationStatus: 'NOT_RUN' },
    { id: 'int-mep-meeting', spaceRef: 'int-space-meeting', ceilingRef: 'int-ceiling-meeting', zoneKind: 'supply-return-coordination-envelope', verificationStatus: 'NOT_RUN' },
    { id: 'int-mep-support', spaceRef: 'int-space-support', ceilingRef: 'int-ceiling-support', zoneKind: 'supply-return-coordination-envelope', verificationStatus: 'NOT_RUN' },
  ],
  finishes: [
    { id: 'int-finish-work', spaceRef: 'int-space-open-work', floor: 'resilient-floor-placeholder', wall: 'painted-wall-placeholder', ceiling: 'acoustic-panel-placeholder' },
    { id: 'int-finish-meeting', spaceRef: 'int-space-meeting', floor: 'resilient-floor-placeholder', wall: 'painted-wall-placeholder', ceiling: 'acoustic-panel-placeholder' },
    { id: 'int-finish-support', spaceRef: 'int-space-support', floor: 'resilient-floor-placeholder', wall: 'painted-wall-placeholder', ceiling: 'acoustic-panel-placeholder' },
  ],
  millwork: [
    { id: 'int-millwork-coffee-run', spaceRef: 'int-space-support', kind: 'service-counter-envelope', envelope: { x: 8300, y: 5900, width: 2200, depth: 650, height: 900 }, catalogStatus: 'NOT_RUN', constructionApproval: false },
  ],
  verificationStatus: {
    codeAuthority: 'NOT_RUN',
    manufacturerCatalog: 'NOT_RUN',
    photometric: 'NOT_RUN',
    mepCoordination: 'NOT_RUN',
    ifcRoundTrip: 'NOT_RUN',
    independentReview: 'NOT_RUN',
    pilot: 'NOT_RUN',
  },
  constructionApproval: { approved: false, basis: 'synthetic fixture; no field, code, catalog, or contractor approval' },
} as const;

export type SmallOfficeFitoutFixture = typeof smallOfficeFitoutFixture;
