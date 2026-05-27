/**
 * featureExamples.ts — Sample input arguments per feature id, so the
 * catalog panel can run a "live demo" of a feature on click without a
 * per-feature input form.
 *
 * Demo data is a UI concern, kept OUT of the pure calculation modules —
 * each entry returns the argument list to spread into the module's
 * resolved entry function (see featureLauncher.runWithExample).
 *
 * Coverage is opt-in: features without an example simply don't offer the
 * "Run example" action. Start with the mounted inspection GD&T family.
 */

export type ExampleArgs = () => unknown[];

// ── small geometry helpers ──────────────────────────────────────────

function circleReadings(radius: number, n = 12) {
  return Array.from({ length: n }, (_, i) => ({ angleDeg: (i * 360) / n, radiusMm: radius }));
}

function cylinderPoints(radius: number, sections = 4, per = 12) {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let s = 0; s < sections; s++) {
    for (let a = 0; a < per; a++) {
      const t = (a * 2 * Math.PI) / per;
      pts.push({ x: radius * Math.cos(t), y: radius * Math.sin(t), z: s * 10 });
    }
  }
  return pts;
}

// ── inspection GD&T examples ────────────────────────────────────────

export const FEATURE_EXAMPLES: Record<string, ExampleArgs> = {
  'inspection.flatness-tolerance': () => [
    [
      { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 }, { x: 100, y: 100, z: 0.02 },
    ],
    { toleranceMm: 0.05 },
  ],
  'inspection.profile-of-line': () => [{
    nominal: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    measured: [{ x: 5, y: 0.02 }, { x: 8, y: -0.01 }],
    toleranceMm: 0.1,
    zoneType: 'bilateral',
  }],
  'inspection.profile-of-surface': () => [{
    nominalMesh: [
      { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 }, c: { x: 10, y: 10, z: 0 } },
      { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 10, z: 0 }, c: { x: 0, y: 10, z: 0 } },
    ],
    measured: [{ x: 5, y: 5, z: 0.03 }],
    toleranceMm: 0.2,
    zoneType: 'bilateral',
  }],
  'inspection.circular-runout': () => [{
    sections: [{ axialPositionMm: 0, readings: circleReadings(10) }],
    toleranceMm: 0.05,
  }],
  'inspection.total-runout': () => [{
    readings: (() => {
      const out: { axialPositionMm: number; angleDeg: number; valueMm: number }[] = [];
      for (let s = 0; s < 5; s++) for (let a = 0; a < 8; a++) {
        out.push({ axialPositionMm: s * 10, angleDeg: (a * 360) / 8, valueMm: 10 + 0.005 * s });
      }
      return out;
    })(),
    toleranceMm: 0.1,
  }],
  'inspection.cylindricity': () => [{ points: cylinderPoints(10), toleranceMm: 0.05 }],
  'inspection.straightness': () => [{
    points: [{ x: 0, y: 0 }, { x: 10, y: 0.01 }, { x: 20, y: -0.01 }, { x: 30, y: 0 }],
    toleranceMm: 0.1,
  }],
  'inspection.angularity': () => {
    const t = 30 * Math.PI / 180;
    const points = Array.from({ length: 9 }, (_, i) => {
      const x = (i % 3) * 10; const y = Math.floor(i / 3) * 10;
      return { x, y, z: y * Math.tan(t) };
    });
    return [{ points, datumNormal: { x: 0, y: 0, z: 1 }, basicAngleDeg: 30, rotationAxis: { x: 1, y: 0, z: 0 }, toleranceMm: 0.1 }];
  },
  'inspection.concentricity': () => [{
    pairs: Array.from({ length: 4 }, (_, s) => ({
      axialPositionMm: s * 10,
      pointA: { x: 10, y: 0, z: s * 10 },
      pointB: { x: -10, y: 0, z: s * 10 },
    })),
    toleranceMm: 0.05,
  }],
  'inspection.symmetry': () => [{
    pairs: Array.from({ length: 4 }, (_, i) => ({
      pointA: { x: 10, y: i * 10, z: 0 },
      pointB: { x: -10, y: i * 10, z: 0 },
    })),
    toleranceMm: 0.05,
  }],
  'inspection.parallelism': () => [{
    points: [{ x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 }, { x: 0, y: 10, z: 5.01 }, { x: 10, y: 10, z: 5 }],
    datumNormal: { x: 0, y: 0, z: 1 },
    toleranceMm: 0.05,
  }],
  // Resolved entry is evaluateSurface (first in candidate order), so the
  // example is a square wall ⟂ to the datum (XY) plane.
  'inspection.perpendicularity': () => [{
    points: [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 },
    ],
    datumNormal: { x: 0, y: 0, z: 1 },
    controlledNormal: { x: 0, y: 1, z: 0 },
    toleranceMm: 0.05,
  }],

  // ── estimation (cost) ─────────────────────────────────────────────
  'estimation.machining-cost': () => [{
    features: [
      { name: 'pocket', removedVolumeMm3: 60000, mrrMm3PerMin: 20000, toolChangeSec: 15 },
      { name: 'holes', removedVolumeMm3: 5000, mrrMm3PerMin: 10000, toolChangeSec: 15 },
    ],
    handlingTimeSec: 60, machineRatePerHour: 60, labourRatePerHour: 40,
    setupCost: 200, batchQuantity: 50, tools: [{ toolPrice: 80, toolLifeParts: 200 }],
  }],
  'estimation.molding-piece-cost': () => [{
    cycleTimeSec: 30, cavities: 4, machineRatePerHour: 60,
    partMassG: 25, runnerMassG: 20, materialPricePerKg: 2.5,
  }],
  'estimation.surface-treatment-cost': () => [{ process: 'zinc-plate', treatedAreaMm2: 50000 }],
  'estimation.casting-cost': () => [{ process: 'sand', partMassG: 2000, materialPricePerKg: 3 }],
  'estimation.laser-cut-cost': () => [{ cutLengthMm: 2000, pierceCount: 8, thicknessMm: 3, material: 'mild-steel', machineRatePerHour: 90 }],
  'estimation.forging-cost': () => [{ process: 'closed-die', partMassG: 1500, materialPricePerKg: 4, strokeTimeSec: 8, pressRatePerHour: 180 }],
  'estimation.extrusion-cost': () => [{ material: 'aluminium', crossSectionAreaMm2: 400, materialPricePerKg: 3, lineRatePerMin: 5, partLengthM: 2 }],

  // ── dynamics ──────────────────────────────────────────────────────
  'dynamics.flywheel-sizer': () => [{ energySwingJ: 5000, meanRpm: 300, coefficientOfFluctuation: 0.05, rimRadiusMm: 300 }],
  'dynamics.two-plane-balancing': () => [{
    v0: [{ magnitude: 10, phaseDeg: 0 }, { magnitude: 6, phaseDeg: 0 }],
    trial1: { massG: 1, angleDeg: 0, response: [{ magnitude: 11, phaseDeg: 0 }, { magnitude: 6.2, phaseDeg: 0 }] },
    trial2: { massG: 1, angleDeg: 0, response: [{ magnitude: 10.2, phaseDeg: 0 }, { magnitude: 7, phaseDeg: 0 }] },
  }],
  'dynamics.critical-speed': () => [{ shaftLengthMm: 600, youngMpa: 200000, shaftDiameterMm: 30, discs: [{ massKg: 20, positionMm: 300 }] }],
  'dynamics.gear-train': () => [{ stages: [{ driverTeeth: 20, drivenTeeth: 60 }, { driverTeeth: 15, drivenTeeth: 45 }], inputSpeedRpm: 1800, inputTorqueNm: 10 }],
  'dynamics.belt-drive': () => [{ driverDiameterMm: 100, drivenDiameterMm: 200, centreDistanceMm: 500, driverRpm: 1450, frictionCoefficient: 0.3, grooveAngleDeg: 38 }],
  'dynamics.cam-follower': () => [{ liftMm: 20, segmentAngleDeg: 90, camSpeedRpm: 300, law: 'cycloidal' }],
  'dynamics.vibration-isolator': () => [{ machineMassKg: 500, forcingFrequencyHz: 25, staticDeflectionMm: 10 }],
  'dynamics.shaft-coupling-alignment': () => [{ parallelOffsetMm: 0.03, angularMisalignmentDeg: 0.02, speedRpm: 1800, radialStiffnessNmm: 200 }],
  'dynamics.torsional-vibration': () => [{ shaft: { diameterMm: 40, lengthMm: 500, shearModulusGPa: 79 }, inertia1KgM2: 0.5 }],

  // ── routing (plant) ───────────────────────────────────────────────
  'routing.tube-bend-springback': () => [{ centerlineRadiusMm: 50, bendAngleDeg: 90, tubeODmm: 25, wallThicknessMm: 2, youngMpa: 200000, yieldMpa: 300 }],
  'routing.pipe-support-span': () => [{ outerDiameterMm: 60, wallThicknessMm: 3.9, pipeMaterialDensityKgM3: 7850, youngMpa: 200000, allowableStressMpa: 100 }],
  'routing.pipe-wall-thickness': () => [{ designPressureMpa: 5, outerDiameterMm: 168.3, allowableStressMpa: 138 }],
  'routing.thermal-expansion-loop': () => [{ runLengthMm: 30000, ctePerK: 12e-6, deltaTempC: 100, outerDiameterMm: 168.3, youngMpa: 200000, allowableStressMpa: 150 }],
  'routing.pump-npsh': () => [{ vapourPressurePa: 2339, fluidDensityKgM3: 998, staticHeadM: 2, frictionHeadM: 1, npshRequiredM: 3 }],
  'routing.orifice-plate': () => [{ pipeInnerDiameterMm: 100, boreDiameterMm: 50, differentialPressurePa: 20000, fluidDensityKgM3: 998 }],
  'wiring.conductor-ampacity': () => [{ designCurrentA: 40, runLengthM: 50, voltageV: 230 }],
  'routing.two-phase-flow': () => [{ pipeInnerDiameterMm: 100, gasFlowM3PerS: 0.0157, liquidFlowM3PerS: 0.00785 }],
  'routing.water-hammer': () => [{ flowVelocityMS: 2, pipeLengthMm: 200000, pipeInnerDiameterMm: 100, wallThicknessMm: 5, fluidDensityKgM3: 998, fluidBulkModulusPa: 2.2e9, pipeYoungPa: 200e9, closureTimeSec: 5 }],
  'routing.steam-trap': () => [{ heatDutyKW: 100, latentHeatKJkg: 2100, inletPressureBarG: 5 }],

  // ── hvac ──────────────────────────────────────────────────────────
  'hvac.duct-transition-loss': () => [{ upstreamAreaMm2: 40000, downstreamAreaMm2: 90000, flowRateM3PerS: 0.5, includedAngleDeg: 30 }],
  'hvac.damper-authority': () => [{ damperOpenDropPa: 100, seriesDropPa: 100, characteristic: 'linear' }],
  'hvac.fan-affinity': () => [{ base: { flowM3PerS: 2, pressurePa: 500, powerW: 1500, speedRpm: 1000, diameterMm: 400 }, driver: 'speed', newSpeedRpm: 1500 }],
  'hvac.diffuser-throw': () => [{ faceVelocityMS: 3, effectiveAreaMm2: 40000 }],
  'hvac.psychrometric-state': () => [{ dryBulbC: 25, relativeHumidity: 0.5 }],
  'hvac.coil-load': () => [{
    flowRateM3PerS: 1.0,
    entering: { dryBulbC: 27, humidityRatio: 0.012, enthalpyKJkg: 57.5 },
    leaving: { dryBulbC: 13, humidityRatio: 0.009, enthalpyKJkg: 36.0 },
  }],
  'hvac.fan-static-budget': () => [{
    components: [{ name: 'filter', dropPa: 120 }, { name: 'cooling-coil', dropPa: 250 }, { name: 'terminal', dropPa: 80 }],
    ductLengthM: 50, frictionRatePaPerM: 0.8, fittingLossesPa: 60, flowRateM3PerS: 2,
  }],
  'hvac.vav-box': () => [{ maxFlowM3PerS: 0.3, minFlowM3PerS: 0.09 }],
  'hvac.coil-rows': () => [{ airFlowM3PerS: 1.0, enteringAirC: 27, targetLeavingAirC: 13, enteringWaterC: 6, waterFlowKgS: 0.8, uaPerRowWperK: 800 }],
  'hvac.economizer': () => [{ outdoorDryBulbC: 12, returnDryBulbC: 24, supplySetpointC: 14, changeoverMode: 'dry-bulb' }],

  // ── welding ───────────────────────────────────────────────────────
  'welding.fillet-throat': () => [{ weldLengthMm: 100, appliedLoadN: 50000, allowableShearMpa: 95, thinnerPlateMm: 10, thickerPlateMm: 12, legSizeMm: 8 }],
  'welding.preheat-temp': () => [{ composition: { C: 0.15, Mn: 0.8 }, combinedThicknessMm: 12, hydrogen: 'low' }],
  'welding.electrode-consumption': () => [{
    jointAreaMm2: 32, weldLengthMm: 1000, process: 'GMAW',
    depositionRateKgH: 4, fillerPricePerKg: 3, labourRatePerHour: 50,
  }],

  // ── Batch 136 additions ───────────────────────────────────────────
  'estimation.stamping-cost': () => [{
    perimeterMm: 300, thicknessMm: 2, shearStrengthMpa: 350,
    partAreaMm2: 4000, partMassG: 63, stripPitchMm: 80, stripWidthMm: 70,
    materialPricePerKg: 1.2, strokesPerMin: 60, pressRatePerMin: 1.5,
  }],
  'routing.pump-system-curve': () => [{
    staticHeadM: 10, systemDutyFlowM3H: 50, systemDutyHeadM: 20,
    pumpShutoffHeadM: 40, pumpDutyFlowM3H: 60, pumpDutyHeadM: 22,
  }],
  'hvac.duct-leakage': () => [{ leakageClass: 6, surfaceAreaM2: 200, staticPressurePa: 500, systemFlowM3PerS: 5 }],

  // ── Batch 137 additions ───────────────────────────────────────────
  'estimation.heat-treat-cost': () => [{ process: 'through-harden', partMassKg: 2, partsPerBatch: 100, furnaceRatePerHour: 80, energyPricePerKWh: 0.15 }],
  'routing.pipe-insulation': () => [{
    pipeOuterDiameterMm: 60, pipeSurfaceTempC: 7, ambientTempC: 30,
    conductivityWmK: 0.035, surfaceFilmCoeffWm2K: 9, goal: 'condensation', dewPointC: 20,
  }],
  'hvac.air-mixing': () => [{
    stream1: { flowM3PerS: 3, dryBulbC: 24, humidityRatio: 0.010, enthalpyKJkg: 49 },
    stream2: { flowM3PerS: 1, dryBulbC: 5, humidityRatio: 0.004, enthalpyKJkg: 15 },
  }],
  'dynamics.cardan-joint': () => [{ jointAngleDeg: 20, inputSpeedRpm: 1000, inputTorqueNm: 50 }],

  // ── Batch 138 additions ───────────────────────────────────────────
  'estimation.assembly-labor': () => [{
    operations: [{ type: 'screw', count: 4 }, { type: 'insert', count: 6 }, { type: 'inspect', count: 1 }],
    labourRatePerHour: 45, batchQuantity: 100, learningRate: 0.9,
  }],
  'routing.control-valve-cv': () => [{
    flowM3H: 40, specificGravity: 1, inletPressureBar: 6, outletPressureBar: 4,
    ratedKv: 50, characteristic: 'equal-percentage', rangeability: 50,
  }],
  'hvac.cooling-tower': () => [{ waterInletC: 37, waterOutletC: 32, wetBulbC: 27, waterFlowM3H: 100, airMassFlowKgS: 25 }],
  'dynamics.campbell-diagram': () => [{
    modes: [{ id: 'mode1', baseFreqHz: 50 }, { id: 'mode2', baseFreqHz: 120 }],
    excitationOrders: [1, 2, 3], maxSpeedRpm: 6000, operatingRpm: 3300,
  }],

  // ── Batch 139 additions ───────────────────────────────────────────
  'estimation.mold-tooling-cost': () => [{
    cavities: 4, complexity: 3, partEnvelopeCm3: 200,
    shopRatePerHour: 80, designHours: 40, designRatePerHour: 70, expectedVolume: 100000,
  }],
  'routing.steam-pipe-sizing': () => [{ massFlowKgH: 1000, specificVolumeM3Kg: 0.19, service: 'saturated' }],
  'hvac.chiller-iplv': () => [{ unit: 'COP', full100: 5.5, part75: 6.2, part50: 6.8, part25: 5.0 }],
  'dynamics.gear-tooth-bending': () => [{
    torqueNm: 100, pitchDiameterMm: 80, moduleMm: 4, faceWidthMm: 40,
    toothCount: 20, rotationalSpeedRpm: 1000, allowableStressMpa: 200,
  }],

  // ── Batch 140 additions ───────────────────────────────────────────
  'estimation.machine-hour-rate': () => [{
    capitalCost: 300000, lifeYears: 10, connectedKW: 30, energyPricePerKWh: 0.15,
    operatorRatePerHour: 35, floorAreaM2: 20, spaceCostPerM2Yr: 200,
  }],
  'routing.flange-rating': () => [{ flangeClass: 300, materialGroup: '1.1-carbon', operatingTempC: 200, designPressureBar: 30 }],
  'hvac.humidifier-load': () => [{
    flowRateM3PerS: 2, supplyHumidityRatio: 0.004, targetHumidityRatio: 0.008, supplyTempC: 20, type: 'steam',
  }],
  'dynamics.unbalance-response': () => [{ rotorMassKg: 50, unbalanceKgMm: 2, naturalFrequencyHz: 50, dampingRatio: 0.05, operatingSpeedRpm: 1500 }],

  // ── Batch 141 additions ───────────────────────────────────────────
  'estimation.print-build-cost': () => [{
    process: 'FDM', partVolumeMm3: 50000, buildHeightMm: 80, layerHeightMm: 0.2,
    machineRatePerHour: 6, materialPricePerKg: 30,
  }],
  'routing.gravity-drain': () => [{ diameterMm: 200, slope: 0.01, manningN: 0.013 }],
  'hvac.duct-acoustics': () => [{
    sourcePWLdB: 85, ductWidthMm: 300, ductHeightMm: 300, linedLengthM: 3, liningThicknessMm: 25, linedElbows: 1,
  }],
  'dynamics.friction-clutch': () => [{
    frictionCoefficient: 0.3, clampForceN: 5000, outerRadiusMm: 120, innerRadiusMm: 80,
    inertia1KgM2: 2, inertia2KgM2: 2, speedDiffRadS: 100, discMassKg: 3,
  }],

  // ── Batch 142 additions ───────────────────────────────────────────
  'estimation.molding-cycle-time': () => [{ shotVolumeCm3: 60, injectionRateCm3PerSec: 40, wallThicknessMm: 2.5, cavities: 4 }],
  'routing.expansion-joint': () => [{
    runLengthMm: 20000, ctePerK: 12e-6, deltaTempC: 150,
    movementPerConvolutionMm: 3, axialStiffnessNmmPerConv: 600, effectiveAreaMm2: 8000, pressureBar: 10,
  }],
  'hvac.ventilation-rate': () => [{ category: 'office', floorAreaM2: 200, occupants: 10, supplyFlowLps: 500 }],
  'dynamics.geneva-mechanism': () => [{ slots: 4, drivePinRadiusMm: 30, driveSpeedRpm: 60 }],

  // ── Batch 143 additions ───────────────────────────────────────────
  'estimation.weld-joint-cost': () => [{
    jointType: 'single-V', thicknessMm: 10, lengthMm: 1000, legOrGapMm: 2,
    grooveAngleDeg: 60, travelSpeedMmMin: 250, fillerPricePerKg: 3, labourRatePerHour: 50,
  }],
  'routing.external-pressure-collapse': () => [{
    outerDiameterMm: 1000, wallThicknessMm: 6, lengthMm: 6000, youngMpa: 200000, externalPressureMpa: 0.1,
  }],
  'hvac.vrf-piping': () => [{ capacityKW: 14, actualLengthM: 40, indoorAboveOutdoorM: 10 }],
  'dynamics.planetary-gear': () => [{ sunTeeth: 24, ringTeeth: 72, planetCount: 3, config: 'ring-fixed', inputSpeedRpm: 1500, inputTorqueNm: 10 }],

  // ── Batch 144 additions ───────────────────────────────────────────
  'estimation.make-vs-buy': () => [{ makeFixedCost: 50000, makeVariableCost: 8, buyPerPartCost: 12, annualVolume: 5000 }],
  'routing.hazen-williams': () => [{ flowM3S: 0.02, innerDiameterMm: 100, lengthM: 100, cFactor: 130 }],
  'hvac.air-curtain': () => [{ doorWidthMm: 2000, doorHeightMm: 2500, nozzleWidthMm: 100, pressureDiffPa: 10, openDoorHeatLossKW: 50 }],
  'dynamics.flat-belt-slip': () => [{
    tightTensionN: 800, slackTensionN: 300, beltCrossSectionMm2: 100, beltModulusMpa: 300,
    driverDiameterMm: 100, drivenDiameterMm: 200, driverRpm: 1450, wrapAngleRad: Math.PI, frictionCoefficient: 0.3,
  }],

  // ── Batch 145 additions ───────────────────────────────────────────
  'estimation.freight-cost': () => [{ mode: 'air', actualWeightKg: 20, volumeCm3: 150000, insuranceValueAmount: 5000 }],
  'routing.pump-specific-speed': () => [{ flowM3S: 0.05, headM: 50, speedRpm: 2900 }],
  'hvac.fan-coil-unit': () => [{ sensibleLoadKW: 3.0, totalLoadKW: 4.0, supplyAirDeltaTC: 10, waterDeltaTC: 5 }],
  'dynamics.worm-gear': () => [{ wormStarts: 1, gearTeeth: 40, moduleMm: 3, wormPitchDiameterMm: 36, frictionCoefficient: 0.1 }],

  // ── Batch 146 additions ───────────────────────────────────────────
  'welding.heat-input': () => [{ process: 'GMAW', voltageV: 28, currentA: 250, travelSpeedMmPerMin: 400, plateThicknessMm: 12 }],
  'estimation.oee': () => [{ plannedProductionTimeMin: 480, downtimeMin: 60, idealCycleTimeSec: 1.0, totalCount: 20000, goodCount: 19500 }],
  'routing.gas-pipe-weymouth': () => [{ inletPressurePsia: 800, outletPressurePsia: 600, innerDiameterIn: 12, lengthMiles: 20, gasGravity: 0.6 }],
  'dynamics.bearing-defect-freq': () => [{ shaftRpm: 1800, elementCount: 9, elementDiameterMm: 7.94, pitchDiameterMm: 39, contactAngleDeg: 0 }],

  // ── Batch 147 additions ───────────────────────────────────────────
  'cam.tool-deflection': () => [{ toolDiameterMm: 10, stickoutMm: 30, cuttingForceN: 200, fluteCount: 4, material: 'carbide' }],
  'assembly.rivet-joint': () => [{ rivetDiameterMm: 10, plateThicknessMm: 8, pitchMm: 30, rivetCount: 1, shearType: 'single', allowableShearMPa: 80, allowableBearingMPa: 160, allowableTensionMPa: 100 }],
  'sheet-metal.deep-draw': () => [{ cupDiameterMm: 50, cupHeightMm: 30, thicknessMm: 1.0, ultimateTensileMPa: 350 }],
  'mold.cavity-count': () => [{ totalParts: 500_000, cycleTimeSec: 30, machineHourRate: 60, baseToolingCost: 20_000, extraCavityCost: 6_000, maxCavities: 64 }],

  // ── Batch 148 additions ───────────────────────────────────────────
  'cam.turning-surface-finish': () => [{ feedMmPerRev: 0.2, noseRadiusMm: 0.8, targetRaMicrometer: 3.2 }],
  'assembly.press-fit-torque': () => [{ interfacePressureMPa: 40, shaftDiameterMm: 30, engagementLengthMm: 40, frictionCoefficient: 0.15, appliedTorqueNm: 50 }],
  'sheet-metal.cone-development': () => [{ baseRadiusMm: 100, topRadiusMm: 50, heightMm: 120 }],
  'mold.injection-pressure': () => [{ polymer: 'PP', flowLengthMm: 150, wallThicknessMm: 2 }],
};

/** Does this feature have a runnable example? */
export function hasExample(id: string): boolean {
  return id in FEATURE_EXAMPLES;
}

/** Resolve the example argument list for a feature id (empty if none). */
export function exampleArgs(id: string): unknown[] {
  const fn = FEATURE_EXAMPLES[id];
  return fn ? fn() : [];
}
