import { buildComplexSystemGraphFixture } from '../../complexSystemGraph.testFixture';
import { verifyComplexSystemGraphBytes } from '../../complexSystemGraph';
import type { GearboxFamilyContract } from './gearboxContract';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export function buildGearboxFamilyContractFixture() {
  const base = buildComplexSystemGraphFixture(), graph = structuredClone(base.graph), sourceArtifactNames = ['system-source.json'];
  graph.nodes.find(node => node.id === 'part-made')!.attributes.role = 'gear';
  graph.nodes.find(node => node.id === 'part-buy')!.attributes.role = 'gear';
  const components = [['shaft-in', 'shaft'], ['shaft-out', 'shaft'], ['bearing-a', 'bearing'], ['bearing-b', 'bearing'], ['housing', 'housing'], ['seal', 'seal']] as const;
  for (const [id, role] of components) {
    graph.nodes.push({ id, kind: 'part', name: id, status: 'confirmed', sourceArtifactNames, attributes: { role } });
    graph.edges.push({ id: `contains-${id}`, kind: 'contains', from: 'assembly', to: id, status: 'confirmed', sourceArtifactNames }, { id: `supply-${id}`, kind: 'supplied_by', from: id, to: 'supplier', status: 'confirmed', sourceArtifactNames }, { id: `inspect-${id}`, kind: 'inspected_at', from: id, to: 'datum', status: 'confirmed', sourceArtifactNames }, { id: `accept-${id}`, kind: 'accepted_by', from: id, to: 'acceptance', status: 'confirmed', sourceArtifactNames });
  }
  graph.evidence[0]!.subjectNodeIds = graph.nodes.map(node => node.id); graph.evidence[0]!.supportingEdgeIds = graph.edges.map(edge => edge.id);
  const graphBytes = encode(graph), graphReport = verifyComplexSystemGraphBytes(graphBytes, base.artifacts);
  const contract: GearboxFamilyContract = {
    schema: 'nexyfab.gearbox-family-contract.v1', systemGraphHash: graphReport.graphHash!,
    target: { ratio: 4, ratioTolerance: 0.01, inputTorqueNm: 10, requiredOutputTorqueNm: 35, outputDirection: 'opposite', requiredLifeHours: 20_000, minimumGearBendingSafetyFactor: 1.5, minimumGearContactSafetyFactor: 1.25, minimumShaftSafetyFactor: 1.5, minimumBearingStaticSafetyFactor: 1.5 },
    gears: [{ nodeId: 'part-made', teeth: 20, moduleMm: 2, faceWidthMm: 20 }, { nodeId: 'part-buy', teeth: 80, moduleMm: 2, faceWidthMm: 20 }], stages: [{ id: 'stage-1', inputGearNodeId: 'part-made', outputGearNodeId: 'part-buy', mesh: 'external', efficiency: 0.95 }],
    gearStrength: [{ gearNodeId: 'part-made', bendingStressMpa: 100, allowableBendingStressMpa: 300, contactStressMpa: 400, allowableContactStressMpa: 1000 }, { gearNodeId: 'part-buy', bendingStressMpa: 120, allowableBendingStressMpa: 300, contactStressMpa: 450, allowableContactStressMpa: 1000 }],
    shafts: [{ nodeId: 'shaft-in', demandedTorqueNm: 10, allowableTorqueNm: 30 }, { nodeId: 'shaft-out', demandedTorqueNm: 38, allowableTorqueNm: 80 }], bearings: [{ nodeId: 'bearing-a', calculatedLifeHours: 30_000, staticSafetyFactor: 2 }, { nodeId: 'bearing-b', calculatedLifeHours: 25_000, staticSafetyFactor: 1.8 }],
    backlash: { predictedMm: 0.08, minimumMm: 0.04, maximumMm: 0.12 }, housing: { nodeId: 'housing', predictedDeflectionMm: 0.02, maximumDeflectionMm: 0.05 }, thermal: { predictedSteadyTemperatureC: 65, maximumTemperatureC: 80, totalLossW: 20 }, lubrication: { selected: true, viscosityAt40Cst: 220, minimumOperatingC: -10, maximumOperatingC: 100, materialCompatibilityConfirmed: true }, seals: [{ nodeId: 'seal', lubricantCompatible: true, temperatureCompatible: true, shaftSpeedCompatible: true }], evidenceArtifactNames: ['system-source.json'],
  };
  return { graph, graphBytes, artifacts: base.artifacts, contract, contractBytes: encode(contract) };
}
