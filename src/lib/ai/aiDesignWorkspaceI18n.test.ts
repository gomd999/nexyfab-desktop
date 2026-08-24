import { describe, expect, it } from 'vitest';
import { getAiDesignWorkspaceCopy, getAiDesignWorkspaceLocale } from './aiDesignWorkspaceI18n';

const LANGUAGES = [
  ['ko', '무엇을 설계할까요?'],
  ['en', 'What would you like to design?'],
  ['ja', '何を設計しますか？'],
  ['zh', '您想设计什么？'],
  ['es', '¿Qué le gustaría diseñar?'],
  ['ar', 'ما الذي تريد تصميمه؟'],
] as const;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('AI Design workspace six-language copy', () => {
  it.each(LANGUAGES)('provides complete, nonempty %s copy', (locale, title) => {
    const copy = getAiDesignWorkspaceCopy(locale);
    expect(copy.launcher.title).toBe(title);
    expect(strings(copy).length).toBeGreaterThan(70);
    expect(strings(copy).every(value => value.trim().length > 0)).toBe(true);
  });

  it('normalizes route aliases and fails unknown locales back to English', () => {
    expect(getAiDesignWorkspaceLocale('kr')).toBe('ko');
    expect(getAiDesignWorkspaceLocale('cn')).toBe('zh');
    expect(getAiDesignWorkspaceCopy('fr').launcher.title).toBe(LANGUAGES[1][1]);
  });
});
