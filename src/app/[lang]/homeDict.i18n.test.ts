import { describe, expect, it } from 'vitest';
import { homeDict } from './homeDict';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u;

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

describe('home dictionary locale isolation', () => {
  it.each(['en', 'ja', 'cn', 'es', 'ar'] as const)('%s contains no leaked Korean copy', locale => {
    const leaked = collectStrings(homeDict[locale]).filter(value => HANGUL.test(value));
    expect(leaked).toEqual([]);
  });
});
