import { describe, expect, it } from 'vitest';
import { buildMetadata } from './metaHelper';

describe('page metadata locale alternates', () => {
  it('keeps hreflang links on the same page for every locale', () => {
    const metadata = buildMetadata('kr', 'pricing');
    const languages = metadata.alternates?.languages as Record<string, string>;

    expect(languages.ko).toBe('https://nexyfab.com/kr/pricing');
    expect(languages.en).toBe('https://nexyfab.com/en/pricing');
    expect(languages.zh).toBe('https://nexyfab.com/cn/pricing');
    expect(languages['x-default']).toBe('https://nexyfab.com/en/pricing');
  });
});
