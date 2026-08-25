import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPLEX_PRODUCT_COMMERCIAL_SCOPE, getComplexProductCommercialScopeCopy } from './complexProductCommercialScope';

describe('complex product commercial scope', () => {
  it('matches the generated fail-closed commercial assessment', () => {
    const assessment = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs/evidence/cad-independent/complex-product-scope-assessment.json'), 'utf8'));
    expect(COMPLEX_PRODUCT_COMMERCIAL_SCOPE).toMatchObject({
      channel: 'closed_beta',
      pilotEligible: assessment.decision.scopedClosedBetaPilotEligible,
      broadSelfService: assessment.decision.broadComplexProductSelfServiceEligible,
      manufacturingReleaseGuaranteed: assessment.decision.manufacturingReleaseGuaranteed,
    });
  });

  it('keeps the same four commercial gates visible in every locale', () => {
    for (const locale of ['ko', 'en', 'ja', 'zh', 'es', 'ar']) {
      const copy = getComplexProductCommercialScopeCopy(locale);
      expect(copy.badge.length).toBeGreaterThan(5);
      expect(copy.gates).toHaveLength(COMPLEX_PRODUCT_COMMERCIAL_SCOPE.requiredGates.length);
      expect(copy.boundary.length).toBeGreaterThan(20);
    }
  });
});
