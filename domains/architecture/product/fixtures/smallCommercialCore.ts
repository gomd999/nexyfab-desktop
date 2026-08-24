export const smallCommercialCoreFixture = {
  schema: 'nexyfab.architecture.small-commercial-core-fixture.v1',
  identity: {
    id: 'architecture-small-commercial-core-original',
    revision: 'fixture-r1',
    title: 'Original synthetic two-storey commercial core',
  },
  provenance: {
    origin: 'ORIGINAL_SYNTHETIC',
    rightsStatus: 'RIGHTS_CLEARED',
    externalSourcesUsed: [] as string[],
    copiedGeometry: false,
    copiedTables: false,
  },
  units: { length: 'mm', area: 'm2', angle: 'deg' },
  coordinateFrame: {
    id: 'arch-frame-local',
    kind: 'LOCAL_CARTESIAN_SYNTHETIC',
    horizontalDatumStatus: 'NOT_RUN',
    verticalDatumStatus: 'NOT_RUN',
    surveyStatus: 'NOT_RUN',
    projectNorthDeg: 0,
  },
  site: {
    id: 'arch-site-envelope',
    boundary: [[0, 0], [24_000, 0], [24_000, 18_000], [0, 18_000], [0, 0]],
    surveyed: false,
  },
  levels: [
    { id: 'arch-level-01', name: 'Level 01', elevation: 0, storeyHeight: 3600 },
    { id: 'arch-level-02', name: 'Level 02', elevation: 3600, storeyHeight: 3600 },
    { id: 'arch-level-roof', name: 'Roof', elevation: 7200, storeyHeight: 0 },
  ],
  grids: [
    { id: 'arch-grid-a', axis: 'x', ordinate: 3000 },
    { id: 'arch-grid-b', axis: 'x', ordinate: 9000 },
    { id: 'arch-grid-c', axis: 'x', ordinate: 15_000 },
    { id: 'arch-grid-d', axis: 'x', ordinate: 21_000 },
    { id: 'arch-grid-1', axis: 'y', ordinate: 3000 },
    { id: 'arch-grid-2', axis: 'y', ordinate: 9000 },
    { id: 'arch-grid-3', axis: 'y', ordinate: 15_000 },
  ],
  spaces: [
    { id: 'arch-space-l1-work', levelRef: 'arch-level-01', usage: 'office-placeholder', boundary: [[3000, 3000], [15_000, 3000], [15_000, 15_000], [3000, 15_000], [3000, 3000]], occupants: 0 },
    { id: 'arch-space-l1-core', levelRef: 'arch-level-01', usage: 'service-core-placeholder', boundary: [[15_000, 3000], [21_000, 3000], [21_000, 15_000], [15_000, 15_000], [15_000, 3000]], occupants: 0 },
    { id: 'arch-space-l2-work', levelRef: 'arch-level-02', usage: 'office-placeholder', boundary: [[3000, 3000], [15_000, 3000], [15_000, 15_000], [3000, 15_000], [3000, 3000]], occupants: 0 },
    { id: 'arch-space-l2-core', levelRef: 'arch-level-02', usage: 'service-core-placeholder', boundary: [[15_000, 3000], [21_000, 3000], [21_000, 15_000], [15_000, 15_000], [15_000, 3000]], occupants: 0 },
  ],
  walls: [
    { id: 'arch-wall-l1-south', levelRef: 'arch-level-01', start: [3000, 3000], end: [21_000, 3000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l1-east', levelRef: 'arch-level-01', start: [21_000, 3000], end: [21_000, 15_000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l1-north', levelRef: 'arch-level-01', start: [21_000, 15_000], end: [3000, 15_000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l1-west', levelRef: 'arch-level-01', start: [3000, 15_000], end: [3000, 3000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l2-south', levelRef: 'arch-level-02', start: [3000, 3000], end: [21_000, 3000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l2-east', levelRef: 'arch-level-02', start: [21_000, 3000], end: [21_000, 15_000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l2-north', levelRef: 'arch-level-02', start: [21_000, 15_000], end: [3000, 15_000], thickness: 200, height: 3600 },
    { id: 'arch-wall-l2-west', levelRef: 'arch-level-02', start: [3000, 15_000], end: [3000, 3000], thickness: 200, height: 3600 },
  ],
  slabs: [
    { id: 'arch-slab-l1', levelRef: 'arch-level-01', boundaryRef: 'arch-site-envelope', thickness: 250, structuralStatus: 'NOT_RUN' },
    { id: 'arch-slab-l2', levelRef: 'arch-level-02', boundaryRef: 'arch-site-envelope', thickness: 250, structuralStatus: 'NOT_RUN' },
  ],
  roof: { id: 'arch-roof-main', levelRef: 'arch-level-roof', boundaryRef: 'arch-site-envelope', drainageStatus: 'NOT_RUN' },
  envelopeLayers: [
    { id: 'arch-envelope-wall-placeholder', hostRefs: ['arch-wall-l1-south', 'arch-wall-l1-east', 'arch-wall-l1-north', 'arch-wall-l1-west', 'arch-wall-l2-south', 'arch-wall-l2-east', 'arch-wall-l2-north', 'arch-wall-l2-west'], thermalStatus: 'NOT_RUN', fireStatus: 'NOT_RUN' },
  ],
  openings: [
    { id: 'arch-door-main', kind: 'door', hostRef: 'arch-wall-l1-south', levelRef: 'arch-level-01', offset: 5000, width: 1200, height: 2400, exit: true, catalogStatus: 'NOT_RUN' },
    { id: 'arch-window-l1-01', kind: 'window', hostRef: 'arch-wall-l1-south', levelRef: 'arch-level-01', offset: 10_000, width: 1800, height: 1500, exit: false, catalogStatus: 'NOT_RUN' },
    { id: 'arch-window-l2-01', kind: 'window', hostRef: 'arch-wall-l2-south', levelRef: 'arch-level-02', offset: 10_000, width: 1800, height: 1500, exit: false, catalogStatus: 'NOT_RUN' },
  ],
  stair: {
    id: 'arch-stair-core', fromLevelRef: 'arch-level-01', toLevelRef: 'arch-level-02',
    clearWidth: 1200, rise: 180, going: 280, landingLength: 1200, codeStatus: 'NOT_RUN',
  },
  serviceOpenings: [
    { id: 'arch-service-opening-l1-01', hostRef: 'arch-slab-l2', systemRef: 'arch-mep-placeholder', width: 600, depth: 400, coordinationStatus: 'NOT_RUN' },
  ],
  egress: {
    nodes: [
      { id: 'arch-egress-origin-l1', levelRef: 'arch-level-01', x: 9000, y: 9000, kind: 'origin' },
      { id: 'arch-egress-exit-l1', levelRef: 'arch-level-01', x: 5000, y: 3000, kind: 'exit' },
      { id: 'arch-egress-origin-l2', levelRef: 'arch-level-02', x: 9000, y: 9000, kind: 'origin' },
      { id: 'arch-egress-stair-l2', levelRef: 'arch-level-02', x: 18_000, y: 9000, kind: 'junction' },
    ],
    edges: [
      { id: 'arch-egress-edge-l1', from: 'arch-egress-origin-l1', to: 'arch-egress-exit-l1', clearWidth: 1200 },
      { id: 'arch-egress-edge-l2', from: 'arch-egress-origin-l2', to: 'arch-egress-stair-l2', clearWidth: 1200 },
    ],
    codeStatus: 'NOT_RUN',
  },
  upstream: {
    structural: { id: 'arch-structural-placeholder', revisionStatus: 'NOT_RUN' },
    mep: { id: 'arch-mep-placeholder', revisionStatus: 'NOT_RUN' },
    mechanical: { id: 'arch-mechanical-placeholder', revisionStatus: 'NOT_RUN' },
  },
  verificationStatus: {
    survey: 'NOT_RUN', codeAuthority: 'NOT_RUN', topology: 'NOT_RUN', stair: 'NOT_RUN',
    egress: 'NOT_RUN', accessibility: 'NOT_RUN', envelope: 'NOT_RUN', coordination: 'NOT_RUN',
    ifcRoundTrip: 'NOT_RUN', independentReview: 'NOT_RUN', pilot: 'NOT_RUN',
  },
  constructionApproval: {
    approved: false,
    basis: 'original synthetic fixture; no survey, code, engineering, IFC, field, or professional approval',
  },
} as const;

export type SmallCommercialCoreFixture = typeof smallCommercialCoreFixture;
