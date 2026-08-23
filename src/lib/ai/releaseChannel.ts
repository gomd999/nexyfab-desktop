import type { DomainAccuracyDomain } from './domainAccuracyProgram';
import { CORE_MECHANICAL_PRODUCT_FAMILIES, type ComplexBenchmarkFamily, type CoreMechanicalBenchmarkFamily } from './complexProductBenchmark';

export const NEXYFAB_RELEASE_CHANNELS = [
  'mechanical-core',
  'complex-mechanical',
  'verified-robot',
  'verified-gearbox',
  'verified-pressure-vessel',
  'verified-turbomachinery',
  'verified-factory-equipment',
  'verified-machine-skid',
  'verified-welded-enclosure',
  'verified-building',
  'verified-interior',
  'verified-civil',
  'verified-landscape',
  'verified-sheet-metal',
  'verified-welded-fabrication',
  'verified-mold-tooling',
  'verified-piping',
  'verified-hvac',
  'verified-ecad-mcad',
  'spatial-labs',
  'platform',
] as const;

export type NexyfabReleaseChannel = (typeof NEXYFAB_RELEASE_CHANNELS)[number];
export type MechanicalComplexFamily = CoreMechanicalBenchmarkFamily;
export type ComplexReleaseFamily = ComplexBenchmarkFamily;
export type SpecialtyReleaseTrack = 'sheet-metal' | 'welded-fabrication' | 'mold-tooling' | 'piping' | 'hvac' | 'ecad-mcad' | null;

export interface NexyfabReleaseContract {
  channel: NexyfabReleaseChannel;
  domains: readonly DomainAccuracyDomain[];
  complexFamilies: readonly ComplexReleaseFamily[];
  promotionFamily: MechanicalComplexFamily | null;
  requiresMechanicalProductScope: boolean;
  requiresComplexProductScope: boolean;
  labsOnly: boolean;
  specialtyTrack: SpecialtyReleaseTrack;
}

const MECHANICAL_DOMAINS = ['mechanical'] as const satisfies readonly DomainAccuracyDomain[];
const SPATIAL_DOMAINS = ['building', 'civil', 'landscape', 'interior'] as const satisfies readonly DomainAccuracyDomain[];
const verifiedFamily = (channel: NexyfabReleaseChannel, promotionFamily: MechanicalComplexFamily): NexyfabReleaseContract => ({ channel, domains: MECHANICAL_DOMAINS, complexFamilies: [promotionFamily], promotionFamily, requiresMechanicalProductScope: true, requiresComplexProductScope: true, labsOnly: false, specialtyTrack: null });
const verifiedSpatialDomain = (channel: NexyfabReleaseChannel, domain: DomainAccuracyDomain): NexyfabReleaseContract => ({ channel, domains: [domain], complexFamilies: [], promotionFamily: null, requiresMechanicalProductScope: false, requiresComplexProductScope: false, labsOnly: false, specialtyTrack: null });
const verifiedSpecialtyTrack = (channel: NexyfabReleaseChannel, specialtyTrack: Exclude<SpecialtyReleaseTrack, null>): NexyfabReleaseContract => ({ channel, domains: [], complexFamilies: [], promotionFamily: null, requiresMechanicalProductScope: false, requiresComplexProductScope: false, labsOnly: false, specialtyTrack });

const CONTRACTS: Record<NexyfabReleaseChannel, NexyfabReleaseContract> = {
  'mechanical-core': {
    channel: 'mechanical-core', domains: MECHANICAL_DOMAINS, complexFamilies: [], promotionFamily: null,
    requiresMechanicalProductScope: true, requiresComplexProductScope: false, labsOnly: false, specialtyTrack: null,
  },
  'complex-mechanical': {
    channel: 'complex-mechanical', domains: MECHANICAL_DOMAINS, complexFamilies: CORE_MECHANICAL_PRODUCT_FAMILIES, promotionFamily: null,
    requiresMechanicalProductScope: true, requiresComplexProductScope: true, labsOnly: false, specialtyTrack: null,
  },
  'verified-robot': verifiedFamily('verified-robot', 'robot'),
  'verified-gearbox': verifiedFamily('verified-gearbox', 'gearbox'),
  'verified-pressure-vessel': verifiedFamily('verified-pressure-vessel', 'pressure_vessel'),
  'verified-turbomachinery': verifiedFamily('verified-turbomachinery', 'turbomachinery'),
  'verified-factory-equipment': verifiedFamily('verified-factory-equipment', 'factory_equipment'),
  'verified-machine-skid': verifiedFamily('verified-machine-skid', 'machine_skid'),
  'verified-welded-enclosure': verifiedFamily('verified-welded-enclosure', 'welded_enclosure'),
  'verified-building': verifiedSpatialDomain('verified-building', 'building'),
  'verified-interior': verifiedSpatialDomain('verified-interior', 'interior'),
  'verified-civil': verifiedSpatialDomain('verified-civil', 'civil'),
  'verified-landscape': verifiedSpatialDomain('verified-landscape', 'landscape'),
  'verified-sheet-metal': verifiedSpecialtyTrack('verified-sheet-metal', 'sheet-metal'),
  'verified-welded-fabrication': verifiedSpecialtyTrack('verified-welded-fabrication', 'welded-fabrication'),
  'verified-mold-tooling': verifiedSpecialtyTrack('verified-mold-tooling', 'mold-tooling'),
  'verified-piping': verifiedSpecialtyTrack('verified-piping', 'piping'),
  'verified-hvac': verifiedSpecialtyTrack('verified-hvac', 'hvac'),
  'verified-ecad-mcad': verifiedSpecialtyTrack('verified-ecad-mcad', 'ecad-mcad'),
  'spatial-labs': {
    channel: 'spatial-labs', domains: SPATIAL_DOMAINS, complexFamilies: [], promotionFamily: null,
    requiresMechanicalProductScope: false, requiresComplexProductScope: false, labsOnly: true, specialtyTrack: null,
  },
  platform: {
    channel: 'platform', domains: [...MECHANICAL_DOMAINS, ...SPATIAL_DOMAINS], complexFamilies: [...CORE_MECHANICAL_PRODUCT_FAMILIES, 'interior'], promotionFamily: null,
    requiresMechanicalProductScope: true, requiresComplexProductScope: true, labsOnly: false, specialtyTrack: null,
  },
};

export function parseNexyfabReleaseChannel(value: string | undefined): NexyfabReleaseChannel {
  const candidate = value?.trim() || 'mechanical-core';
  if (!(NEXYFAB_RELEASE_CHANNELS as readonly string[]).includes(candidate)) {
    throw new TypeError(`Unsupported NEXYFAB_RELEASE_CHANNEL: ${candidate}`);
  }
  return candidate as NexyfabReleaseChannel;
}

export function releaseContractFor(channel: NexyfabReleaseChannel): NexyfabReleaseContract {
  return CONTRACTS[channel];
}

export function releaseDomainsForChannel(value: string | undefined): readonly DomainAccuracyDomain[] {
  return releaseContractFor(parseNexyfabReleaseChannel(value)).domains;
}
