import { describe, expect, it } from 'vitest';
import { BIM_REGISTRY_SCHEMA, validateBimInformationRegistry, type BimInformationRegistry } from './informationRegistry';
import { LH_SITE_BEP_REQUIREMENTS, LH_SITE_BEP_SOURCE } from './lhSiteBepCatalog';

describe('LH site BEP section catalog', () => {
  it('forms a valid, source-traceable design and construction contract', () => {
    const registry: BimInformationRegistry = {
      schema: BIM_REGISTRY_SCHEMA,
      registryId: 'lh-site-bep-test',
      version: '2025.12',
      sourceReferences: [LH_SITE_BEP_SOURCE],
      units: [{ code: 'none', symbol: '-', dimension: 'none' }],
      classifications: [], properties: [], bepRequirements: [...LH_SITE_BEP_REQUIREMENTS],
    };
    expect(validateBimInformationRegistry(registry)).toEqual({ status: 'valid', issues: [] });
    expect(LH_SITE_BEP_REQUIREMENTS.map(item => item.key)).toEqual(expect.arrayContaining([
      'responsibilityMatrix', 'cdePlan', 'exchangeRequirements', 'qualityPlan', 'deliverablePlan', 'securityPlan',
    ]));
  });
});
