import { describe, it, expect } from 'vitest';
import { classifyCadImportError } from '@/app/[lang]/shape-generator/io/formatCadImportError';

describe('classifyCadImportError', () => {
  it('tags STEP parse failures', () => {
    const r = classifyCadImportError(new Error('STEP parsing failed: bad'), { filename: 'x.step' });
    expect(r.code).toBe('step_parse');
    expect(r.message).toContain('x.step');
  });
  it('tags WASM load', () => {
    const r = classifyCadImportError(new Error('Failed to load OCCT WASM'));
    expect(r.code).toBe('wasm_load');
  });
  it('tags unsupported format', () => {
    const r = classifyCadImportError(new Error('Unsupported format: .xyz'));
    expect(r.code).toBe('unsupported_format');
  });
});
