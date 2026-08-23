import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMechanicalCommercialEvidenceWorkbooks, main } from './scaffold-mechanical-commercial-evidence-v3';

describe('mechanical commercial evidence v3 scaffolder', () => {
  it('creates the exact 30 design and 20 blind challenge slots without claiming evidence', () => {
    const workbooks = buildMechanicalCommercialEvidenceWorkbooks('2026-08-11T00:00:00.000Z');
    expect(workbooks.design.cases).toHaveLength(30);
    expect(new Set(workbooks.design.cases.map(item => item.primaryFeature))).toHaveProperty('size', 30);
    expect(workbooks.design.cases.every(item => item.status === 'evidence_required' && item.releaseEligible === false)).toBe(true);
    expect(workbooks.blind.cases).toHaveLength(20);
    expect(workbooks.blind.cases.filter(item => item.risk === 'high')).toHaveLength(5);
    expect(workbooks.blind.cases.every(item => item.releaseEligible === false)).toBe(true);
  });

  it('writes outside the repository and refuses to overwrite either workbook', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-commercial-evidence-'));
    try {
      expect(main([`--root=${root}`])).toBe(0);
      expect(fs.existsSync(path.join(root, 'direct-design', 'mechanical-direct-design-workbook.json'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'blind-challenges', 'mechanical-blind-product-challenge-workbook.json'))).toBe(true);
      expect(() => main([`--root=${root}`])).toThrow('MECHANICAL_COMMERCIAL_EVIDENCE_WORKBOOK_ALREADY_EXISTS');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

