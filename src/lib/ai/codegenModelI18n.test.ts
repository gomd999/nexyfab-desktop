import { describe, expect, it } from 'vitest';
import { CODEGEN_MODELS } from './codegenModels';
import { getCodegenModelNote } from './codegenModelI18n';

const LOCALES = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;

describe('codegen model catalog i18n', () => {
  it('provides a localized note for every selectable model and product locale', () => {
    for (const model of CODEGEN_MODELS) {
      for (const locale of LOCALES) expect(getCodegenModelNote(model, locale).trim()).not.toBe('');
    }
  });

  it('normalizes route aliases and keeps English as the unknown-locale fallback', () => {
    const model = CODEGEN_MODELS[0]!;
    expect(getCodegenModelNote(model, 'kr')).toBe(getCodegenModelNote(model, 'ko'));
    expect(getCodegenModelNote(model, 'cn')).toBe(getCodegenModelNote(model, 'zh'));
    expect(getCodegenModelNote(model, 'fr')).toBe(model.note);
  });
});
