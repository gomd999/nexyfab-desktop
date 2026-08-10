import { describe, expect, it } from 'vitest';
import { assertCadExportAllowed, cadExportBlockers } from './cad-release-status';

describe('CAD release status export policy', () => {
  it('allows only final approval for manufacturing or construction', () => {
    expect(cadExportBlockers('expert_approved', 'manufacturing_or_construction')).not.toEqual([]);
    expect(cadExportBlockers('manufacturing_or_construction_approved', 'manufacturing_or_construction')).toEqual([]);
  });

  it('allows a blocked design to export to no purpose', () => {
    expect(cadExportBlockers('blocked', 'design_review')).toEqual(['cad-release-status-blocked']);
    expect(() => assertCadExportAllowed('blocked', 'expert_review')).toThrow('CAD_EXPORT_BLOCKED');
  });

  it('keeps AI drafts out of every export lane', () => {
    expect(cadExportBlockers('ai_draft', 'design_review')).not.toEqual([]);
  });
});
