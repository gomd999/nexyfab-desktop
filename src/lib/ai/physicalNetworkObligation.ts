import type { MepSystem } from './mepConnectionVerification';
import type { ProductRequirement } from './productDecomposition';

export interface PhysicalNetworkSystemObligation {
  id: 'sensor_signal' | 'electrical' | 'data' | 'fluid' | 'hot_water' | 'cold_water' | 'drain' | 'air';
  acceptableSystems: MepSystem[];
}

export interface PhysicalNetworkObligation {
  required: boolean;
  obligations: PhysicalNetworkSystemObligation[];
}

const signals: Array<{ obligation: PhysicalNetworkSystemObligation; pattern: RegExp }> = [
  { obligation: { id: 'sensor_signal', acceptableSystems: ['electrical', 'data'] }, pattern: /\b(?:pt[- ]?100|rtd|thermocouple|temperature sensor|sensor lead)\b|온도\s*센서|센서\s*(?:선|배선)|열전대/iu },
  { obligation: { id: 'electrical', acceptableSystems: ['electrical'] }, pattern: /\b(?:electrical|electric|power cable|power wiring|wire harness|wiring|cabling)\b|전기|전원|전선|배선|와이어\s*하네스|케이블/iu },
  { obligation: { id: 'data', acceptableSystems: ['data'] }, pattern: /\b(?:ethernet|data cable|signal cable|fieldbus|profinet|modbus|can bus)\b|통신\s*(?:선|케이블|배선)|데이터\s*케이블|신호\s*케이블/iu },
  { obligation: { id: 'hot_water', acceptableSystems: ['hot_water'] }, pattern: /\b(?:hot water|heated water)\b|온수/iu },
  { obligation: { id: 'cold_water', acceptableSystems: ['cold_water'] }, pattern: /\b(?:cold water|chilled water|coolant)\b|냉수|냉각수|쿨런트/iu },
  { obligation: { id: 'drain', acceptableSystems: ['drain'] }, pattern: /\b(?:drain|drainage|wastewater)\b|배수|드레인|폐수/iu },
  { obligation: { id: 'air', acceptableSystems: ['supply_air', 'return_air'] }, pattern: /\b(?:pneumatic|air line|air hose|air duct|supply air|return air|ductwork)\b|공압|에어\s*(?:라인|호스)|급기|환기|덕트/iu },
  { obligation: { id: 'fluid', acceptableSystems: ['cold_water', 'hot_water', 'drain'] }, pattern: /\b(?:piping|pipework|fluid line|hydraulic|water pipe|process pipe|hose route)\b|배관|유체\s*(?:라인|경로)|유압|파이프|호스\s*경로/iu },
];

/** Derives non-optional physical-service obligations from authoritative request text.
 * Plan declarations are deliberately not used as the only source, so an AI cannot
 * evade the gate by deleting a requirement or returning physicalNetworks=[]. */
export function derivePhysicalNetworkObligation(
  request: string,
  acceptedRequirements: ReadonlyArray<Pick<ProductRequirement, 'text' | 'category'>> = [],
): PhysicalNetworkObligation {
  const corpus = [request, ...acceptedRequirements.flatMap(requirement => [requirement.text, requirement.category])].join('\n');
  const byId = new Map<PhysicalNetworkSystemObligation['id'], PhysicalNetworkSystemObligation>();
  for (const signal of signals) if (signal.pattern.test(corpus)) byId.set(signal.obligation.id, signal.obligation);
  const obligations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { required: obligations.length > 0, obligations };
}

