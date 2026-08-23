import { describe, expect, it } from 'vitest';
import { mechanicalVocabularyPrompt, normalizeMechanicalVocabulary } from './mechanicalVocabulary';

describe('mechanical vocabulary normalization', () => {
  it('maps multilingual aliases to canonical CAD terms', () => {
    const result = normalizeMechanicalVocabulary('알루미늄 브라켓에 8mm 구멍 4개와 샤프트를 조립해줘');
    expect(result.hits.map(hit => hit.canonical)).toEqual(expect.arrayContaining(['bracket', 'hole', 'shaft']));
  });

  it('recognizes jet vocabulary and keeps ambiguous terms explicit', () => {
    const result = normalizeMechanicalVocabulary('annular combustor with casing and pipe');
    expect(result.hits.map(hit => hit.canonical)).toEqual(expect.arrayContaining(['annular_combustor', 'casing', 'tube']));
    expect(result.ambiguities.length).toBeGreaterThan(0);
  });

  it('normalizes Spanish, Japanese, Chinese and Arabic aliases', () => {
    const result = normalizeMechanicalVocabulary('brida con agujeros y eje; 法兰 孔 轴; شفة ثقب عمود');
    expect(result.hits.map(hit => hit.canonical)).toEqual(expect.arrayContaining(['flange', 'hole', 'shaft']));
  });

  it('adds a compact prompt hint only when terms are found', () => {
    expect(mechanicalVocabularyPrompt('make something')).toBe('');
    expect(mechanicalVocabularyPrompt('플랜지')).toContain('flange');
  });
});
