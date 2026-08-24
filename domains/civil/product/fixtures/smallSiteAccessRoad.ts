export const smallSiteAccessRoadFixture = {
  schema: 'nexyfab.civil.small-site-access-road-fixture.v1',
  identity: { id: 'civil-small-site-access-road-original', revision: 'fixture-r1' },
  provenance: {
    origin: 'ORIGINAL_SYNTHETIC', rightsStatus: 'RIGHTS_CLEARED',
    externalSourcesUsed: [] as string[], copiedGeometry: false, copiedTables: false,
  },
  units: { length: 'm', area: 'm2', volume: 'm3', slope: 'percent' },
  coordinateAuthority: {
    kind: 'LOCAL_CARTESIAN_SYNTHETIC', crsStatus: 'NOT_RUN', horizontalDatumStatus: 'NOT_RUN',
    verticalDatumStatus: 'NOT_RUN', epochStatus: 'NOT_RUN', surveyApproval: false,
  },
  surveyControls: [
    { id: 'civil-control-01', x: 0, y: 0, z: 100, authorityStatus: 'NOT_RUN' },
    { id: 'civil-control-02', x: 120, y: 0, z: 98.8, authorityStatus: 'NOT_RUN' },
  ],
  points: [
    { id: 'civil-point-01', x: 0, y: -12, z: 100.3 },
    { id: 'civil-point-02', x: 120, y: -12, z: 99.1 },
    { id: 'civil-point-03', x: 120, y: 12, z: 98.9 },
    { id: 'civil-point-04', x: 0, y: 12, z: 100.1 },
    { id: 'civil-point-05', x: 60, y: 0, z: 99.6 },
  ],
  breaklines: [
    { id: 'civil-breakline-south', pointRefs: ['civil-point-01', 'civil-point-02'] },
    { id: 'civil-breakline-north', pointRefs: ['civil-point-04', 'civil-point-03'] },
  ],
  surfaces: [
    {
      id: 'civil-surface-existing', kind: 'EXISTING', authorityStatus: 'NOT_RUN',
      triangleRefs: [
        { id: 'civil-triangle-ex-01', pointRefs: ['civil-point-01', 'civil-point-02', 'civil-point-05'] },
        { id: 'civil-triangle-ex-02', pointRefs: ['civil-point-02', 'civil-point-03', 'civil-point-05'] },
        { id: 'civil-triangle-ex-03', pointRefs: ['civil-point-03', 'civil-point-04', 'civil-point-05'] },
        { id: 'civil-triangle-ex-04', pointRefs: ['civil-point-04', 'civil-point-01', 'civil-point-05'] },
      ],
      breaklineRefs: ['civil-breakline-south', 'civil-breakline-north'],
    },
    {
      id: 'civil-surface-proposed', kind: 'PROPOSED', authorityStatus: 'NOT_RUN',
      triangleRefs: [
        { id: 'civil-triangle-pr-01', pointRefs: ['civil-point-01', 'civil-point-02', 'civil-point-05'] },
        { id: 'civil-triangle-pr-02', pointRefs: ['civil-point-02', 'civil-point-03', 'civil-point-05'] },
        { id: 'civil-triangle-pr-03', pointRefs: ['civil-point-03', 'civil-point-04', 'civil-point-05'] },
        { id: 'civil-triangle-pr-04', pointRefs: ['civil-point-04', 'civil-point-01', 'civil-point-05'] },
      ],
      breaklineRefs: ['civil-breakline-south', 'civil-breakline-north'],
    },
  ],
  alignment: {
    id: 'civil-alignment-access',
    segments: [{ id: 'civil-align-line-01', kind: 'LINE', startStation: 0, endStation: 120, start: [0, 0], end: [120, 0] }],
  },
  profile: {
    id: 'civil-profile-access', alignmentRef: 'civil-alignment-access',
    points: [{ id: 'civil-pvi-01', station: 0, elevation: 100 }, { id: 'civil-pvi-02', station: 60, elevation: 99.5 }, { id: 'civil-pvi-03', station: 120, elevation: 99 }],
    verticalCurves: [{ id: 'civil-vcurve-01', pviRef: 'civil-pvi-02', length: 20, criteriaStatus: 'NOT_RUN' }],
  },
  crossSections: [0, 30, 60, 90, 120].map((station, index) => ({
    id: `civil-section-${String(index + 1).padStart(2, '0')}`,
    alignmentRef: 'civil-alignment-access', station,
    points: [{ offset: -3.5, elevation: 100 - station / 120 }, { offset: 0, elevation: 100.07 - station / 120 }, { offset: 3.5, elevation: 100 - station / 120 }],
  })),
  corridor: {
    id: 'civil-corridor-access', alignmentRef: 'civil-alignment-access', profileRef: 'civil-profile-access',
    existingSurfaceRef: 'civil-surface-existing', proposedSurfaceRef: 'civil-surface-proposed',
    startStation: 0, endStation: 120, assembly: { carriagewayWidth: 7, crossSlopePercent: 2, daylightStatus: 'NOT_RUN' },
  },
  drainage: {
    catchments: [{ id: 'civil-catchment-01', outletRef: 'civil-inlet-01', areaM2: 2880, runoffAuthorityStatus: 'NOT_RUN' }],
    nodes: [
      { id: 'civil-inlet-01', kind: 'INLET', x: 5, y: 5, rim: 99.9, invert: 98.7 },
      { id: 'civil-manhole-01', kind: 'MANHOLE', x: 60, y: 5, rim: 99.4, invert: 98.1 },
      { id: 'civil-outfall-01', kind: 'OUTFALL', x: 120, y: 5, rim: 98.8, invert: 97.5 },
    ],
    links: [
      { id: 'civil-pipe-01', fromRef: 'civil-inlet-01', toRef: 'civil-manhole-01', diameterMm: 450, lengthM: 55, hydraulicStatus: 'NOT_RUN' },
      { id: 'civil-pipe-02', fromRef: 'civil-manhole-01', toRef: 'civil-outfall-01', diameterMm: 450, lengthM: 60, hydraulicStatus: 'NOT_RUN' },
    ],
    rainfallAuthorityStatus: 'NOT_RUN', outfallApprovalStatus: 'NOT_RUN',
  },
  earthwork: {
    existingSurfaceRef: 'civil-surface-existing', proposedSurfaceRef: 'civil-surface-proposed',
    calculationStatus: 'NOT_RUN', quantityStatus: 'NOT_RUN',
  },
  constructionStages: [
    { id: 'civil-stage-01', name: 'earthworks placeholder', dependsOn: [] as string[], objectRefs: ['civil-corridor-access'] },
    { id: 'civil-stage-02', name: 'drainage placeholder', dependsOn: ['civil-stage-01'], objectRefs: ['civil-pipe-01', 'civil-pipe-02'] },
  ],
  verificationStatus: {
    survey: 'NOT_RUN', tin: 'NOT_RUN', alignment: 'NOT_RUN', profile: 'NOT_RUN', corridor: 'NOT_RUN',
    drainageHydraulics: 'NOT_RUN', earthwork: 'NOT_RUN', landXmlRoundTrip: 'NOT_RUN',
    independentReview: 'NOT_RUN', pilot: 'NOT_RUN',
  },
  constructionApproval: { approved: false, basis: 'original synthetic fixture; no survey, datum, hydraulic, interoperability, field, or professional approval' },
} as const;

export type SmallSiteAccessRoadFixture = typeof smallSiteAccessRoadFixture;
