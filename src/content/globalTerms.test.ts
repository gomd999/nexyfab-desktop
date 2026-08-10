import { describe, expect, it } from 'vitest';
import {
  GLOBAL_TERMS,
  GLOBAL_TERMS_EFFECTIVE_DATE,
  GLOBAL_TERMS_VERSION,
  resolveGlobalTerms,
} from './globalTerms';

const REQUIRED_SECTIONS = [
  'agreement',
  'content',
  'outputs',
  'ai-cad',
  'real-world-use',
  'acceptable-use',
  'notices',
  'privacy-security',
  'liability',
  'law-disputes',
  'term-changes',
] as const;

describe('global terms baseline', () => {
  it('has an immutable-looking version and effective date', () => {
    expect(GLOBAL_TERMS_VERSION).toMatch(/^GTS-\d+\.\d+-\d{4}-\d{2}-\d{2}$/);
    expect(GLOBAL_TERMS_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(Object.entries(GLOBAL_TERMS))('%s contains every release-critical section exactly once', (_locale, document) => {
    const ids = document.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of REQUIRED_SECTIONS) expect(ids).toContain(section);
  });

  it('preserves customer ownership and makes private training opt-in', () => {
    const content = GLOBAL_TERMS.en.sections.find((section) => section.id === 'content');
    const text = content?.paragraphs?.join(' ') ?? '';
    expect(text).toContain('retain your ownership');
    expect(text).toContain('not used to train');
    expect(text).toContain('explicit opt-in');
  });

  it('separates technical review, production readiness, and legal clearance', () => {
    const section = GLOBAL_TERMS.en.sections.find((item) => item.id === 'ai-cad');
    const text = section?.paragraphs?.join(' ') ?? '';
    expect(text).toContain('Expert technical review is not legal review');
    expect(text).toContain('verification status');
    expect(text).toContain('production-ready');
  });

  it('preserves mandatory consumer rights instead of using a blanket waiver', () => {
    const section = GLOBAL_TERMS.en.sections.find((item) => item.id === 'liability');
    const text = section?.paragraphs?.join(' ') ?? '';
    expect(text).toContain('cannot lawfully be excluded');
    expect(text).toContain('mandatory consumer law');
  });

  it('uses reviewed Korean/English text and explicit fallback notices for other routes', () => {
    expect(resolveGlobalTerms('kr').document).toBe(GLOBAL_TERMS.ko);
    expect(resolveGlobalTerms('en').document).toBe(GLOBAL_TERMS.en);
    expect(resolveGlobalTerms('ja').translationNotice).toBeTruthy();
    expect(resolveGlobalTerms('cn').translationNotice).toBeTruthy();
    expect(resolveGlobalTerms('es').translationNotice).toBeTruthy();
    expect(resolveGlobalTerms('ar').translationNotice).toBeTruthy();
    expect(resolveGlobalTerms('ar').direction).toBe('rtl');
  });
});
