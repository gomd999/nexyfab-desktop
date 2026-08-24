import { describe, expect, it } from 'vitest';
import { DOMAIN_PRODUCT_SERVICE_DOMAINS, evaluateDomainProduct } from './domainProductService';

describe('domain product service', () => {
  it('rejects unknown domains and unknown input keys', () => {
    expect(evaluateDomainProduct({ domain: 'unknown', contract: {} })).toMatchObject({ status: 'FAIL', commercialReleaseReady: false, blockers: ['domain_product_input_invalid'] });
    expect(evaluateDomainProduct({ domain: 'civil', contract: {}, injected: true })).toMatchObject({ status: 'FAIL', blockers: ['domain_product_input_keys_invalid'] });
    expect(evaluateDomainProduct({ domain: 'landscape', contract: {}, options: 'pass' })).toMatchObject({ status: 'FAIL', blockers: ['domain_product_options_invalid'] });
  });

  it('fails every malformed domain input without release or side effects', () => {
    for (const domain of DOMAIN_PRODUCT_SERVICE_DOMAINS) {
      const input = domain === 'mechanical' ? { domain, pipeline: {} } : { domain, contract: {} };
      const result = evaluateDomainProduct(input);
      expect(result.status, domain).toBe('FAIL');
      expect(result.commercialReleaseReady, domain).toBe(false);
      expect(result.quoteOrRfqSideEffects, domain).toBe(false);
      expect(result.blockers.length, domain).toBeGreaterThan(0);
    }
  });
});
