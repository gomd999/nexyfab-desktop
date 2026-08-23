import { describe, expect, it } from 'vitest';
import { NEXYFAB_RELEASE_CHANNELS, parseNexyfabReleaseChannel, releaseContractFor, releaseDomainsForChannel } from './releaseChannel';

describe('NexyFab product release channels', () => {
  it('defaults to the commercial mechanical product', () => {
    expect(parseNexyfabReleaseChannel(undefined)).toBe('mechanical-core');
    expect(releaseDomainsForChannel(undefined)).toEqual(['mechanical']);
  });

  it('keeps spatial labs and complex mechanical evidence independent', () => {
    expect(releaseContractFor('spatial-labs')).toMatchObject({
      domains: ['building', 'civil', 'landscape', 'interior'],
      complexFamilies: [],
      labsOnly: true,
      specialtyTrack: null,
    });
    expect(releaseContractFor('complex-mechanical').complexFamilies).toEqual([
      'robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'machine_skid', 'welded_enclosure',
    ]);
  });

  it('allows each Verified Systems family to graduate independently', () => {
    expect(releaseContractFor('verified-machine-skid')).toMatchObject({ domains: ['mechanical'], complexFamilies: ['machine_skid'], promotionFamily: 'machine_skid', requiresComplexProductScope: true, labsOnly: false, specialtyTrack: null });
    expect(releaseContractFor('verified-welded-enclosure').complexFamilies).toEqual(['welded_enclosure']);
  });

  it('allows each spatial discipline to graduate without borrowing sibling evidence', () => {
    expect(releaseContractFor('verified-building')).toMatchObject({ domains: ['building'], complexFamilies: [], requiresMechanicalProductScope: false, requiresComplexProductScope: false, labsOnly: false, specialtyTrack: null });
    expect(releaseDomainsForChannel('verified-interior')).toEqual(['interior']);
    expect(releaseDomainsForChannel('verified-civil')).toEqual(['civil']);
    expect(releaseDomainsForChannel('verified-landscape')).toEqual(['landscape']);
  });

  it('maps each specialty channel to one isolated specialty track', () => {
    const expected = {
      'verified-sheet-metal': 'sheet-metal',
      'verified-welded-fabrication': 'welded-fabrication',
      'verified-mold-tooling': 'mold-tooling',
      'verified-piping': 'piping',
      'verified-hvac': 'hvac',
      'verified-ecad-mcad': 'ecad-mcad',
    } as const;
    for (const [channel, specialtyTrack] of Object.entries(expected) as Array<[keyof typeof expected, (typeof expected)[keyof typeof expected]]>) {
      expect(NEXYFAB_RELEASE_CHANNELS).toContain(channel);
      expect(releaseContractFor(channel)).toEqual({
        channel,
        domains: [],
        complexFamilies: [],
        promotionFamily: null,
        requiresMechanicalProductScope: false,
        requiresComplexProductScope: false,
        labsOnly: false,
        specialtyTrack,
      });
      expect(releaseDomainsForChannel(channel)).toEqual([]);
    }
  });

  it('keeps every non-specialty contract unassigned to a specialty track', () => {
    for (const channel of NEXYFAB_RELEASE_CHANNELS) {
      const contract = releaseContractFor(channel);
      if (contract.channel.startsWith('verified-') && contract.specialtyTrack !== null) continue;
      expect(contract.specialtyTrack).toBeNull();
    }
  });

  it('rejects unknown channels instead of silently widening or weakening scope', () => {
    expect(() => parseNexyfabReleaseChannel('something-else')).toThrow(/Unsupported/);
  });
});
