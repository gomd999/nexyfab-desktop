// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import FloatingAiPrompt from './FloatingAiPrompt';

const submit = async () => null;

describe('FloatingAiPrompt six-language and RTL surface', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('renders localized prompt copy for every supported language', async () => {
    const cases: Array<[string, RegExp]> = [
      ['kr', /mm/],
      ['en', /Make a 50mm cube/],
      ['ja', /50mm/],
      ['cn', /50mm/],
      ['es', /50 mm/],
      ['ar', /50/],
    ];
    const placeholders: string[] = [];

    for (const [lang, expected] of cases) {
      render(<FloatingAiPrompt lang={lang} onSubmit={submit} />);
      const input = await screen.findByRole('textbox');
      placeholders.push(input.getAttribute('placeholder') ?? '');
      expect(input.getAttribute('placeholder')).toMatch(expected);
      cleanup();
      localStorage.clear();
    }

    expect(new Set(placeholders).size).toBe(6);
  });

  it('uses RTL direction and logical edge placement for Arabic', async () => {
    render(<FloatingAiPrompt lang="ar" onSubmit={submit} />);
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(dialog.style.getPropertyValue('inset-inline-end')).toBe('24px');
    expect(dialog.style.direction).toBe('rtl');
  });
});
