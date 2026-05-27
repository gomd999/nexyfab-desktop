import { describe, it, expect } from 'vitest';
import {
  extractMetadata,
  scoreExtraction,
  summarize,
} from './reportPdfMetadataExtractor';

describe('extractMetadata', () => {
  it('finds part number', () => {
    const r = extractMetadata('Part No: PN-12345\nOther text');
    expect(r.partNumber).toBe('PN-12345');
  });

  it('finds drawing number', () => {
    const r = extractMetadata('DWG: DWG-2024-001');
    expect(r.drawingNumber).toBe('DWG-2024-001');
  });

  it('finds revision', () => {
    const r = extractMetadata('REV B3');
    expect(r.revision).toBe('B3');
  });

  it('finds inspection date YYYY-MM-DD', () => {
    const r = extractMetadata('Inspection Date: 2026-05-19');
    expect(r.inspectionDate).toBe('2026-05-19');
  });

  it('finds DD/MM/YYYY date and ISO-normalizes', () => {
    const r = extractMetadata('Date: 19/05/2026');
    expect(r.inspectionDate).toBe('2026-05-19');
  });

  it('rejects malformed date', () => {
    const r = extractMetadata('Date: 99-99-9999');
    expect(r.inspectionDate).toBeUndefined();
    expect(r.warnings.some(w => w.includes('parsed'))).toBe(true);
  });

  it('finds inspector name', () => {
    const r = extractMetadata('Inspected by: John Doe');
    expect(r.inspector).toBe('John Doe');
  });

  it('detects PASS', () => {
    const r = extractMetadata('Final result: PASSED');
    expect(r.passFail).toBe('pass');
  });

  it('detects FAIL', () => {
    const r = extractMetadata('Final result: FAIL');
    expect(r.passFail).toBe('fail');
  });

  it('warns on missing part number', () => {
    const r = extractMetadata('No labels here');
    expect(r.warnings.some(w => w.includes('Part number'))).toBe(true);
  });

  it('extracts GD&T callout via FCF symbol', () => {
    const r = extractMetadata('Form: ⊥ 0.1 A | Other');
    expect(r.gdtCallouts.length).toBeGreaterThan(0);
  });

  it('confidence per field is recorded', () => {
    const r = extractMetadata('Part No: PN-1234\nREV A');
    expect(r.confidence['partNumber']).toBeGreaterThan(0);
    expect(r.confidence['revision']).toBeGreaterThan(0);
  });
});

describe('scoreExtraction', () => {
  it('mean confidence is average of fields', () => {
    const r = extractMetadata('Part No: PN-1234\nREV A');
    const score = scoreExtraction(r);
    expect(score.confidenceMean).toBeGreaterThan(0);
  });

  it('completeness counts non-null fields', () => {
    const r = extractMetadata('Part No: PN-1234');
    expect(scoreExtraction(r).completeness).toBe(1);
  });
});

describe('summarize', () => {
  it('reports completeness + confidence', () => {
    const r = extractMetadata('Part No: PN-1234\nREV A');
    const s = summarize(r);
    expect(s.completeness).toBeGreaterThan(0);
  });

  it('warningCount reported', () => {
    const s = summarize(extractMetadata('empty'));
    expect(s.warningCount).toBeGreaterThan(0);
  });
});
