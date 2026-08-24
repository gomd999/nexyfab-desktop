export const smallPlazaCourtyardFixture = {
  schema: 'nexyfab.landscape.small-plaza-courtyard-fixture.v1',
  identity: { id: 'landscape-small-plaza-courtyard-original', revision: 'fixture-r1' },
  provenance: {
    origin: 'ORIGINAL_SYNTHETIC', rightsStatus: 'RIGHTS_CLEARED',
    externalSourcesUsed: [] as string[], copiedGeometry: false, copiedSchedules: false,
  },
  units: { length: 'm', area: 'm2', volume: 'm3', flow: 'lpm', pressure: 'kPa' },
  coordinateFrame: {
    kind: 'LOCAL_CARTESIAN_SYNTHETIC', crsStatus: 'NOT_RUN', horizontalDatumStatus: 'NOT_RUN',
    verticalDatumStatus: 'NOT_RUN', approvedTerrainStatus: 'NOT_RUN',
  },
  terrainBinding: {
    id: 'landscape-terrain-synthetic', civilSurfaceRef: 'civil-surface-not-connected',
    sourceRevisionStatus: 'NOT_RUN', contentHashStatus: 'NOT_RUN', drainageOutletStatus: 'NOT_RUN',
  },
  siteBoundary: [[0, 0], [30, 0], [30, 24], [0, 24], [0, 0]],
  grading: {
    spotGrades: [
      { id: 'landscape-grade-01', x: 0, y: 0, elevation: 100 },
      { id: 'landscape-grade-02', x: 30, y: 0, elevation: 99.7 },
      { id: 'landscape-grade-03', x: 30, y: 24, elevation: 99.5 },
      { id: 'landscape-grade-04', x: 0, y: 24, elevation: 99.8 },
    ],
    breaklines: [
      { id: 'landscape-breakline-01', pointRefs: ['landscape-grade-01', 'landscape-grade-02'] },
      { id: 'landscape-breakline-02', pointRefs: ['landscape-grade-04', 'landscape-grade-03'] },
    ],
    drainagePaths: [{ id: 'landscape-flow-01', pointRefs: ['landscape-grade-01', 'landscape-grade-03'], outletRef: 'landscape-outlet-01', continuityStatus: 'NOT_RUN' }],
    outlets: [{ id: 'landscape-outlet-01', civilOutletRef: 'civil-outfall-not-connected', approvalStatus: 'NOT_RUN' }],
  },
  hardscape: [
    { id: 'landscape-hardscape-plaza', kind: 'PAVING_PLACEHOLDER', boundary: [[3, 3], [27, 3], [27, 14], [3, 14], [3, 3]], thickness: 0.12, slopeStatus: 'NOT_RUN', accessibilityStatus: 'NOT_RUN' },
    { id: 'landscape-hardscape-path', kind: 'PATH_PLACEHOLDER', boundary: [[13, 14], [17, 14], [17, 24], [13, 24], [13, 14]], thickness: 0.12, slopeStatus: 'NOT_RUN', accessibilityStatus: 'NOT_RUN' },
  ],
  soilZones: [
    { id: 'landscape-soil-west', boundary: [[1, 15], [12, 15], [12, 23], [1, 23], [1, 15]], depth: 0.9, volumeM3: 79.2, geotechnicalStatus: 'NOT_RUN' },
    { id: 'landscape-soil-east', boundary: [[18, 15], [29, 15], [29, 23], [18, 23], [18, 15]], depth: 0.9, volumeM3: 79.2, geotechnicalStatus: 'NOT_RUN' },
  ],
  plantingZones: [
    { id: 'landscape-planting-west', soilZoneRef: 'landscape-soil-west', boundary: [[1, 15], [12, 15], [12, 23], [1, 23], [1, 15]] },
    { id: 'landscape-planting-east', soilZoneRef: 'landscape-soil-east', boundary: [[18, 15], [29, 15], [29, 23], [18, 23], [18, 15]] },
  ],
  plants: [
    { id: 'landscape-plant-west-01', plantingZoneRef: 'landscape-planting-west', catalogRef: 'catalog-not-connected-tree-a', x: 5, y: 19, matureCanopyDiameter: 5, matureRootDiameter: 4, catalogStatus: 'NOT_RUN' },
    { id: 'landscape-plant-west-02', plantingZoneRef: 'landscape-planting-west', catalogRef: 'catalog-not-connected-tree-a', x: 10, y: 19, matureCanopyDiameter: 5, matureRootDiameter: 4, catalogStatus: 'NOT_RUN' },
    { id: 'landscape-plant-east-01', plantingZoneRef: 'landscape-planting-east', catalogRef: 'catalog-not-connected-tree-b', x: 21, y: 19, matureCanopyDiameter: 5, matureRootDiameter: 4, catalogStatus: 'NOT_RUN' },
    { id: 'landscape-plant-east-02', plantingZoneRef: 'landscape-planting-east', catalogRef: 'catalog-not-connected-tree-b', x: 26, y: 19, matureCanopyDiameter: 5, matureRootDiameter: 4, catalogStatus: 'NOT_RUN' },
  ],
  irrigation: {
    source: { id: 'landscape-water-source-01', pressureKPa: 0, maxFlowLpm: 0, authorityStatus: 'NOT_RUN' },
    valves: [{ id: 'landscape-valve-01', sourceRef: 'landscape-water-source-01', zoneRef: 'landscape-irrigation-zone-01', catalogStatus: 'NOT_RUN' }],
    zones: [{ id: 'landscape-irrigation-zone-01', plantingZoneRefs: ['landscape-planting-west', 'landscape-planting-east'], designFlowLpm: 0, hydraulicStatus: 'NOT_RUN' }],
    pipes: [{ id: 'landscape-irrigation-pipe-01', fromRef: 'landscape-water-source-01', toRef: 'landscape-valve-01', diameterMm: 0, lengthM: 20, catalogStatus: 'NOT_RUN' }],
    emitters: [{ id: 'landscape-emitter-01', valveRef: 'landscape-valve-01', plantRefs: ['landscape-plant-west-01', 'landscape-plant-west-02', 'landscape-plant-east-01', 'landscape-plant-east-02'], flowLpm: 0, catalogStatus: 'NOT_RUN' }],
    waterBudget: { demandM3PerYear: 0, sourceCapacityStatus: 'NOT_RUN', climateAuthorityStatus: 'NOT_RUN' },
  },
  maintenance: {
    zones: [{ id: 'landscape-maintenance-zone-01', objectRefs: ['landscape-planting-west', 'landscape-planting-east', 'landscape-irrigation-zone-01'], accessWidthM: 1.2, accessStatus: 'NOT_RUN' }],
    tasks: [{ id: 'landscape-maintenance-task-01', zoneRef: 'landscape-maintenance-zone-01', description: 'project-defined placeholder task', authorityStatus: 'NOT_RUN' }],
  },
  verificationStatus: {
    terrain: 'NOT_RUN', grading: 'NOT_RUN', surfaceFlow: 'NOT_RUN', hardscapeAccessibility: 'NOT_RUN',
    plantCatalog: 'NOT_RUN', matureClearance: 'NOT_RUN', soil: 'NOT_RUN', irrigationHydraulics: 'NOT_RUN',
    waterBudget: 'NOT_RUN', quantities: 'NOT_RUN', exchangeRoundTrip: 'NOT_RUN', independentReview: 'NOT_RUN', pilot: 'NOT_RUN',
  },
  constructionApproval: { approved: false, basis: 'original synthetic fixture; no terrain, catalog, hydraulic, authority, field, exchange, or professional approval' },
} as const;

export type SmallPlazaCourtyardFixture = typeof smallPlazaCourtyardFixture;
