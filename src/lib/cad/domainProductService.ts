import { qualifyBuildingProduct } from '../../../domains/architecture/product/qualify';
import { qualifyCivilProduct } from '../../../domains/civil/product/qualify';
import { qualifyInteriorProduct } from '../../../domains/interior/product/qualify';
import { qualifyLandscapeProduct } from '../../../domains/landscape/product/qualify';
import { runMechanicalProductPipeline } from '../../../domains/mechanical/product/pipeline';

export const DOMAIN_PRODUCT_SERVICE_SCHEMA = 'nexyfab.domain-product-service-result.v1' as const;
export const DOMAIN_PRODUCT_SERVICE_DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'] as const;
export type DomainProductServiceDomain = typeof DOMAIN_PRODUCT_SERVICE_DOMAINS[number];

export type DomainProductServiceInput =
  | { domain: 'mechanical'; pipeline: Parameters<typeof runMechanicalProductPipeline>[0] }
  | { domain: Exclude<DomainProductServiceDomain, 'mechanical'>; contract: unknown; options?: unknown };

export interface DomainProductServiceResult {
  schema: typeof DOMAIN_PRODUCT_SERVICE_SCHEMA;
  domain: DomainProductServiceDomain | null;
  status: 'PASS' | 'HOLD' | 'FAIL';
  commercialReleaseReady: false;
  quoteOrRfqSideEffects: false;
  blockers: string[];
  result: unknown | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const safeError = (error: unknown): string => error instanceof Error && error.message.length <= 512 ? error.message : 'domain_product_evaluation_failed';
const failed = (domain: DomainProductServiceDomain | null, blockers: string[]): DomainProductServiceResult => ({
  schema: DOMAIN_PRODUCT_SERVICE_SCHEMA, domain, status: 'FAIL', commercialReleaseReady: false,
  quoteOrRfqSideEffects: false, blockers: [...new Set(blockers)], result: null,
});

/**
 * Pure, side-effect-free entry point used by the product API and future UI.
 * It never performs a governed release, quote, RFQ, or external approval.
 */
export function evaluateDomainProduct(input: unknown): DomainProductServiceResult {
  if (!isRecord(input) || typeof input.domain !== 'string' || !DOMAIN_PRODUCT_SERVICE_DOMAINS.includes(input.domain as DomainProductServiceDomain)) {
    return failed(null, ['domain_product_input_invalid']);
  }
  const domain = input.domain as DomainProductServiceDomain;
  const expected = domain === 'mechanical' ? ['domain', 'pipeline'] : input.options === undefined ? ['domain', 'contract'] : ['domain', 'contract', 'options'];
  if (!exactKeys(input, expected)) return failed(domain, ['domain_product_input_keys_invalid']);
  if (domain === 'mechanical' && !isRecord(input.pipeline)) return failed(domain, ['mechanical_pipeline_input_invalid']);
  if (domain !== 'mechanical' && input.options !== undefined && !isRecord(input.options)) return failed(domain, ['domain_product_options_invalid']);
  try {
    const result = domain === 'mechanical'
      ? runMechanicalProductPipeline(input.pipeline as Parameters<typeof runMechanicalProductPipeline>[0])
      : domain === 'building'
        ? qualifyBuildingProduct(input.contract, isRecord(input.options) ? input.options : {})
        : domain === 'interior'
          ? qualifyInteriorProduct(input.contract, isRecord(input.options) ? input.options : {})
          : domain === 'civil'
            ? qualifyCivilProduct(input.contract, isRecord(input.options) ? input.options : {})
            : qualifyLandscapeProduct(input.contract, isRecord(input.options) ? input.options : {});
    const status = isRecord(result) && ['PASS', 'HOLD', 'FAIL'].includes(String(result.status))
      ? result.status as 'PASS' | 'HOLD' | 'FAIL'
      : 'FAIL';
    const blockers = isRecord(result) && Array.isArray(result.blockers)
      ? result.blockers.filter((value): value is string => typeof value === 'string')
      : status === 'PASS' ? [] : ['domain_product_result_invalid'];
    return {
      schema: DOMAIN_PRODUCT_SERVICE_SCHEMA, domain, status, commercialReleaseReady: false,
      quoteOrRfqSideEffects: false, blockers: [...new Set(blockers)], result,
    };
  } catch (error) {
    return failed(domain, [safeError(error)]);
  }
}
